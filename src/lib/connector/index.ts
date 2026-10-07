/**
 * Connector: từ tên miền công ty → kênh liên hệ công khai, có nguồn.
 *
 * Chạy ở nơi có egress mạng (máy người dùng hoặc server production). Sandbox
 * không ra được internet nên phần này được kiểm bằng fixture HTML thật, xem
 * `npm run connector:test`.
 *
 * ## Ba bước của quy trình (theo "Thiết kế Chuẩn" của người dùng)
 *
 *  - **Bước 1 — biết đang đọc website của ai.** Tên miền do người dùng đưa vào
 *    (lấy từ phiếu khai báo hải quan), không đoán, không tự tìm công ty khác.
 *  - **Bước 2 — đọc thẳng nguồn của công ty:** trang chủ, sitemap công ty tự
 *    công bố, các trang liên hệ / nhà cung cấp / mua hàng, và PDF cùng tên miền.
 *  - **Bước 3 — chỉ khi bước 2 còn mỏng (chưa có kênh nào thuộc nhóm mua hàng)
 *    mới đi nguồn cấp 2:** search API (chỉ để tìm URL trong chính tên miền đó) và
 *    sổ đăng ký doanh nghiệp (đối chiếu pháp nhân). Xem `gate.ts`, `secondary.ts`.
 *
 * Bước 4 (trích xuất có bằng chứng) và bước 5 (năm cổng) nằm ở `extract.ts`,
 * `roles.ts`, và các migration 007–009; riêng cổng gửi đi kiểm ở `reverify.ts`.
 *
 * ## Cam kết của connector (được kiểm trong test)
 *
 *  - chỉ đọc trang công khai, không đăng nhập, không giải CAPTCHA, không cookie;
 *  - tôn trọng robots.txt;
 *  - chỉ lấy giá trị có trên trang, không sinh email theo pattern;
 *  - mọi giá trị đều kèm câu chữ đã thấy nó và URL của trang;
 *  - thứ của bên thứ ba (tên miền khác) vào mục "đã loại trừ", không vào kênh;
 *  - đọc cả PDF cùng tên miền (báo cáo thường niên, press release, tài liệu nhà
 *    cung cấp) — nơi chứa những thứ trang HTML không có; PDF scan ảnh thì ghi
 *    "không đọc được", không đoán;
 *  - sổ đăng ký **không** tạo ra kênh liên hệ: sổ không có email/điện thoại, nên
 *    ở đây chỉ đối chiếu pháp nhân và ghi lại tên người đương nhiệm kèm nguồn.
 */

import { classifyEmailLocal, extractFromLines, extractFromPage } from "./extract";
import { mentionsName, nameTokens, relatedBrand, foldName } from "./identity";
import { fetchPage } from "./fetch";
import { pdfToLines } from "./pdf";
import { planDiscovery, normalizeSeed, hostOf, type DiscoveryOptions } from "./discover";
import { isNonProductionHost, registrableDomain } from "./html";
import { isPathAllowed } from "./robots";
import { coverageOf, nearMissBuyingDoors, secondaryReason } from "./gate";
import {
  harvestUrlsFromSearch,
  lookupRegistry,
  registriesForCountry,
  type RegistryFinding,
  type SearchProvider,
} from "./secondary";
import { mergeRequirements, sortRequirements, type Requirement } from "@/lib/requirements";
import type {
  ConnectorNote,
  ConnectorResult,
  FoundChannel,
  FoundPerson,
  ForeignEmail,
  PageExtraction,
  PageReport,
  SecondaryReport,
  TargetFamily,
} from "./types";

/** Cấu hình bước 3. Thiếu khoá thì bước đó đơn giản là không chạy — không lỗi. */
export type SecondaryOptions = {
  /** Khoá search API (Serper / Tavily / Brave). Không có thì bỏ qua phần search. */
  searchApiKey?: string;
  searchProvider?: SearchProvider;
  /** Khoá UK Companies House. Không có thì không tra được sổ Anh. */
  companiesHouseApiKey?: string;
  /** User-Agent cho SEC EDGAR — nên kèm email liên hệ (SEC chặn 403 nếu thiếu). */
  secUserAgent?: string;
  /** Trần số trang đọc thêm ở bước 3. */
  maxUrls?: number;
};

export type RunConnectorOptions = DiscoveryOptions & {
  targets?: TargetFamily[];
  /** Nghỉ giữa các lần tải để không ép máy chủ của họ. */
  delayMs?: number;
  maxPages?: number;
  /**
   * Quốc gia của công ty (mã ISO hoặc tên). Có thì số nội địa được chuẩn hoá
   * sang E.164; không có thì số giữ nguyên như đã công bố. Xem phone.ts.
   */
  country?: string | null;
  /** Tên pháp nhân để tra sổ đăng ký (lấy từ phiếu khai báo hải quan). */
  companyName?: string;
  /**
   * Bước 3 — nguồn cấp 2. Mặc định **bật ở chế độ tự động**: chỉ chạy khi bước 2
   * chưa tìm được kênh nào thuộc nhóm mua hàng. `false` để tắt hẳn.
   */
  secondary?: boolean | SecondaryOptions;
  /**
   * Hạn chót (epoch ms) cho cả lần chạy. Hết hạn thì dừng **giữa các trang** và
   * trả về phần đã đọc, kèm `stoppedEarly` — trên server có giới hạn thời gian
   * của nền tảng, và một kết quả nói rõ "chưa đọc hết" tốt hơn một request chết
   * không có gì. Không đặt thì chạy hết kế hoạch như trước.
   */
  deadlineAt?: number;
};

const DEFAULT_TARGETS: TargetFamily[] = ["email", "phone", "whatsapp", "linkedin", "form"];

/** Trần mặc định số trang đọc thêm ở bước 3. */
const DEFAULT_SECONDARY_URLS = 6;
/** Tài liệu nặng hơn trang HTML nên đọc ít hơn. */
const DEFAULT_SECONDARY_DOCUMENTS = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Biểu mẫu liên hệ là thuộc tính của **cả website**, không phải của từng trang.
 *
 * Một biểu mẫu ở chân trang xuất hiện trên mọi trang đã đọc: lần chạy thật trên
 * mariani.com cho ra **12 dòng "Biểu mẫu liên hệ"** giống hệt nhau, che mất những
 * kênh thật sự khác. Giữ lại **một** cửa vào — trang sát việc mua bán nhất —
 * và nói ra số trang đã gộp, để việc gộp không phải là giấu thông tin.
 */
export function collapseFormChannels(channels: FoundChannel[]): { channels: FoundChannel[]; collapsed: number } {
  const forms = channels.filter((channel) => channel.type === "form");
  if (forms.length <= 1) return { channels, collapsed: 0 };

  const rank = (url: string) => {
    if (/(sourcing|supplier|vendor|procure|purchas|nguon-hang|mua-hang)/i.test(url)) return 0;
    if (/(contact|enquir|inquiry|lien-he)/i.test(url)) return 1;
    if (/(b2b|partnership|partner|about|company)/i.test(url)) return 2;
    try {
      if (new URL(url).pathname === "/") return 3;
    } catch {
      // URL lạ thì coi như trang thường.
    }
    return 4;
  };

  const best = [...forms].sort((a, b) => rank(a.value) - rank(b.value) || a.value.length - b.value.length)[0];
  const kept = channels.filter((channel) => channel.type !== "form" || channel === best);
  return { channels: kept, collapsed: forms.length - 1 };
}

export type SiblingVerdict = {
  verified: boolean;
  status: number | "blocked" | "error";
  why: string;
};

/**
 * Đọc **một trang** của tên miền kia để trả lời: có căn cứ nào nói tên miền đó
 * thuộc cùng công ty không?
 *
 * Đây là chỗ sửa lỗi "so bằng nhau cứng": `tysonfoods.com` và `tyson.com` là hai
 * website của cùng một công ty, nên hộp thư `…@tyson.com` tìm thấy trên trang
 * doanh nghiệp là hộp thư của chính công ty đó, không phải của bên thứ ba. Nhưng
 * cũng không thể cứ thấy tên na ná nhau là nhận — `apple.com` và `applebees.com`
 * cũng na ná. Vì vậy câu trả lời đến từ **đọc trang**: chuyển hướng về tên miền
 * chính, hoặc nhắc đúng tên công ty, hoặc dẫn liên kết về tên miền chính.
 *
 * Một request, chỉ trang chủ, không đi tiếp vào tên miền đó. Không xác minh được
 * thì giữ nguyên việc loại trừ — và ghi lại **vì sao** để người kiểm đọc.
 */
export async function verifySiblingDomain(
  foreignDomain: string,
  input: {
    siteDomain: string;
    companyName: string;
    fetchImpl?: typeof fetch;
    userAgent?: string;
    guard?: RunConnectorOptions["guard"];
  },
): Promise<SiblingVerdict> {
  const url = `https://${foreignDomain}/`;
  const outcome = await fetchPage(url, { fetchImpl: input.fetchImpl, userAgent: input.userAgent, guard: input.guard });
  if (!outcome.ok) {
    return { verified: false, status: outcome.blocked ? "blocked" : "error", why: `không đọc được ${foreignDomain} (${outcome.reason ?? "lỗi"})` };
  }

  const finalDomain = registrableDomain(hostOf(outcome.finalUrl));
  if (finalDomain === input.siteDomain) {
    return { verified: true, status: outcome.status, why: `${foreignDomain} chuyển hướng về ${input.siteDomain}` };
  }

  const tokens = nameTokens(input.companyName);
  const folded = foldName(outcome.body);
  const matched = tokens.filter((token) => folded.includes(token));
  const needed = Math.min(tokens.length, 2);
  if (needed > 0 && matched.length >= needed) {
    return { verified: true, status: outcome.status, why: `${foreignDomain} nhắc đúng tên "${input.companyName}"` };
  }

  if (outcome.body.includes(input.siteDomain)) {
    return { verified: true, status: outcome.status, why: `${foreignDomain} dẫn liên kết về ${input.siteDomain}` };
  }

  return {
    verified: false,
    status: outcome.status,
    why: `trang ${foreignDomain} không nhắc tên công ty và không dẫn về ${input.siteDomain}`,
  };
}

export async function runConnector(seedInput: string, options: RunConnectorOptions = {}): Promise<ConnectorResult> {
  const seedUrl = normalizeSeed(seedInput);
  const log = options.log ?? (() => {});
  const targets = options.targets ?? DEFAULT_TARGETS;
  const delayMs = options.delayMs ?? 300;
  const country = options.country ?? null;
  const secondaryOptions: SecondaryOptions = typeof options.secondary === "object" && options.secondary !== null ? options.secondary : {};
  const secondaryEnabled = options.secondary !== false;

  if (!seedUrl) {
    throw new Error(`Không đọc được tên miền từ "${seedInput}"`);
  }

  const domain = registrableDomain(hostOf(seedUrl));
  const plan = await planDiscovery(seedUrl, { ...options, log });
  const pages: PageReport[] = [];
  const channels: FoundChannel[] = [];
  const people = new Map<string, FoundPerson>();
  const notes: ConnectorNote[] = [];
  const seenChannels = new Set<string>();
  const readUrls = new Set<string>();
  let requirements: Requirement[] = [];
  let pagesFetched = 0;
  let registry: RegistryFinding | undefined;
  const nameToConfirm = options.companyName?.trim() ?? "";
  let identityMatched: boolean | undefined = nameToConfirm ? false : undefined;
  let siteDescription: { text: string; sourceUrl: string } | undefined;
  let stoppedEarly: string | undefined;
  // Hộp thư trên tên miền khác — chờ xác minh ở cuối bước 2, trước khi chấm cổng.
  const foreignAll: ForeignEmail[] = [];
  const siblingDomains: { domain: string; verifiedBy: string }[] = [];

  const deadlineReached = () => options.deadlineAt !== undefined && Date.now() >= options.deadlineAt;
  const stopBecauseDeadline = (stage: string) => {
    if (stoppedEarly) return true;
    if (!deadlineReached()) return false;
    stoppedEarly = `hết thời gian cho phép khi đang ${stage}`;
    notes.push({
      kind: "skipped",
      label: stage,
      detail: `${stoppedEarly} — kết quả dưới đây là phần đã đọc được, chưa đầy đủ.`,
    });
    return true;
  };

  plan.skipped.forEach((entry) => {
    pages.push({ url: entry.url, status: "skipped", reason: entry.reason, channels: 0 });
  });

  const absorb = (extracted: PageExtraction) => {
    extracted.channels.forEach((channel) => {
      const key = `${channel.type}:${channel.value.toLowerCase()}`;
      if (seenChannels.has(key)) return;
      seenChannels.add(key);
      channels.push(channel);
    });

    extracted.people.forEach((person) => {
      const existing = people.get(person.name.toLowerCase());
      if (existing) {
        person.channelValues.forEach((value) => {
          if (!existing.channelValues.includes(value)) existing.channelValues.push(value);
        });
        if (!existing.title && person.title) existing.title = person.title;
        return;
      }
      people.set(person.name.toLowerCase(), person);
    });

    requirements = mergeRequirements(requirements, extracted.requirements);
    notes.push(...extracted.notes);
    extracted.foreignEmails?.forEach((email) => foreignAll.push(email));
  };

  const crawlPage = async (url: string) => {
    if (readUrls.has(url)) return;
    readUrls.add(url);
    pagesFetched += 1;

    const outcome = await fetchPage(url, { fetchImpl: options.fetchImpl, userAgent: options.userAgent, guard: options.guard });
    if (!outcome.ok) {
      pages.push({
        url: outcome.finalUrl,
        status: outcome.loginWall ? "blocked" : outcome.blocked ? "blocked" : "error",
        reason: outcome.reason ?? "không tải được",
        channels: 0,
      });
      if (outcome.loginWall) {
        notes.push({
          kind: "skipped",
          label: url,
          detail: "Trang yêu cầu đăng nhập — connector dừng lại, không vượt cổng đăng nhập.",
          sourceUrl: url,
        });
      }
      return;
    }

    const extracted = extractFromPage({ url: outcome.finalUrl, html: outcome.body, targets, country });
    absorb(extracted);
    if (identityMatched === false && mentionsName(outcome.body, nameToConfirm)) identityMatched = true;
    if (!siteDescription && extracted.description) siteDescription = { text: extracted.description, sourceUrl: outcome.finalUrl };
    pages.push({ url: outcome.finalUrl, status: outcome.status, channels: extracted.channels.length, kind: "html" });
  };

  const crawlDocument = async (url: string) => {
    if (readUrls.has(url)) return;
    readUrls.add(url);
    pagesFetched += 1;

    const outcome = await fetchPage(url, { fetchImpl: options.fetchImpl, userAgent: options.userAgent, guard: options.guard });
    if (!outcome.ok) {
      pages.push({
        url: outcome.finalUrl,
        status: outcome.blocked ? "blocked" : "error",
        reason: outcome.reason ?? "không tải được",
        channels: 0,
        kind: "pdf",
      });
      return;
    }

    const pdf = await pdfToLines(outcome.body);
    if (!pdf.ok) {
      // Không đọc được thì ghi lại lý do — tuyệt đối không đoán giá trị.
      pages.push({ url: outcome.finalUrl, status: outcome.status, reason: pdf.reason ?? "không đọc được PDF", channels: 0, kind: "pdf" });
      notes.push({
        kind: "skipped",
        label: url,
        detail: `Tài liệu PDF không đọc được: ${pdf.reason ?? "không rõ lý do"}. Không suy diễn giá trị từ file này.`,
        sourceUrl: url,
      });
      return;
    }

    const extracted = extractFromLines({ url: outcome.finalUrl, lines: pdf.lines, kind: "pdf", targets, country });
    absorb(extracted);
    pages.push({ url: outcome.finalUrl, status: outcome.status, channels: extracted.channels.length, kind: "pdf" });
  };

  // ---------------------------------------------------- bước 2: nguồn cấp 1 ---
  // URL người dùng dán thì luôn đọc (họ chủ động chọn nó); URL **mình tự tìm
  // được** mà nằm ở môi trường thử nghiệm thì bỏ, kèm lý do — đọc bản nháp rồi
  // ghi vào nguồn là làm report trông dày hơn thực tế.
  const keepDiscovered = (url: string) => normalizeSeed(url) === seedUrl || !isNonProductionHost(url);
  const droppedForStaging = [...new Set([...plan.urls, ...plan.documents])].filter((url) => !keepDiscovered(url));
  droppedForStaging.forEach((url) => pages.push({ url, status: "skipped", reason: "môi trường thử nghiệm (dev/staging), không dùng làm nguồn", channels: 0 }));

  const htmlUrls = [...new Set(plan.urls)].filter(keepDiscovered);
  log(`đọc ${htmlUrls.length} trang trên ${domain}${plan.sitemapFound ? " (có sitemap)" : ""}`);

  for (const url of htmlUrls) {
    if (stopBecauseDeadline("đọc các trang chính")) break;
    await crawlPage(url);
    if (delayMs > 0) await sleep(delayMs);
  }

  const documentUrls = [...new Set(plan.documents)].filter(keepDiscovered).filter((url) => !htmlUrls.includes(url));
  if (documentUrls.length > 0) log(`đọc ${documentUrls.length} tài liệu PDF trên ${domain}`);

  for (const url of documentUrls) {
    if (stopBecauseDeadline("đọc tài liệu PDF")) break;
    await crawlDocument(url);
    if (delayMs > 0) await sleep(delayMs);
  }

  // ------------------------------- xác minh tên miền khác của cùng công ty ---
  // Chỉ chạy khi có hộp thư nằm ngoài tên miền chính. Mỗi tên miền: một lần đọc
  // trang chủ. Quyết định ở đây — trước khi chấm cổng — để hộp thư của chính
  // công ty kịp tính vào coverage, còn hộp thư của bên thứ ba thì bị loại kèm lý do.
  if (foreignAll.length > 0) {
    const byDomain = new Map<string, ForeignEmail[]>();
    for (const email of foreignAll) {
      const list = byDomain.get(email.domain) ?? [];
      list.push(email);
      byDomain.set(email.domain, list);
    }

    /** Bỏ những số điện thoại đang chờ tên miền này, kèm lý do cụ thể cho người kiểm. */
    const dropDeferredPhones = (foreignDomain: string, why: string) => {
      for (let index = channels.length - 1; index >= 0; index -= 1) {
        const channel = channels[index];
        if (channel.deferredForeign?.domain !== foreignDomain) continue;
        notes.push({
          kind: "excluded",
          label: `${channel.deferredForeign.published ?? channel.value} · ${foreignDomain}`,
          detail: why,
          sourceUrl: channel.sourceUrl,
        });
        channels.splice(index, 1);
      }
    };

    for (const [foreignDomain, emails] of byDomain) {
      if (!relatedBrand(foreignDomain, domain)) {
        emails.forEach((email) => {
          notes.push({
            kind: "excluded",
            label: email.value,
            detail: `Email thuộc tên miền ${email.domain}, tên miền này không có quan hệ tên với ${domain} — không đủ căn cứ để ghi thành liên hệ của công ty.`,
            sourceUrl: email.sourceUrl,
          });
        });
        dropDeferredPhones(
          foreignDomain,
          `Số này nằm cùng khối với email trên tên miền ${foreignDomain}, mà tên miền đó không có quan hệ tên với ${domain} — nên không ghi thành liên hệ.`,
        );
        continue;
      }

      if (stopBecauseDeadline(`xác minh tên miền ${foreignDomain}`)) {
        emails.forEach((email) => {
          notes.push({
            kind: "excluded",
            label: email.value,
            detail: `Email thuộc tên miền ${email.domain}, chưa xác minh được quan hệ với ${domain} vì hết thời gian cho phép — để người xem lại.`,
            sourceUrl: email.sourceUrl,
          });
        });
        dropDeferredPhones(foreignDomain, `Số này nằm cùng khối với email trên tên miền ${foreignDomain} — chưa xác minh được vì hết thời gian cho phép, nên để người xem lại.`);
        continue;
      }

      const verdict = await verifySiblingDomain(foreignDomain, {
        siteDomain: domain,
        companyName: nameToConfirm,
        fetchImpl: options.fetchImpl,
        userAgent: options.userAgent,
        guard: options.guard,
      });
      pages.push({ url: `https://${foreignDomain}/`, status: verdict.status, reason: verdict.why, channels: 0, kind: "html", relationCheck: true });

      if (verdict.verified) {
        siblingDomains.push({ domain: foreignDomain, verifiedBy: verdict.why });
        emails.forEach((email) => {
          const key = `email:${email.value.toLowerCase()}`;
          if (seenChannels.has(key)) return;
          seenChannels.add(key);
          const local = email.value.split("@")[0] ?? "";
          channels.push({
            type: "email",
            value: email.value,
            label: `Email công bố (${foreignDomain} — cùng công ty)`,
            identityMatch: classifyEmailLocal(local),
            certainty: "confirmed",
            policy: "needs_mailbox_check",
            sourceUrl: email.sourceUrl,
            evidenceSnippet: email.evidenceSnippet,
            siblingDomain: { domain: foreignDomain, verifiedBy: verdict.why },
          });
        });
        // Số điện thoại nằm cùng khối với hộp thư đó: giờ đã biết là của công ty.
        channels.forEach((channel) => {
          if (channel.deferredForeign?.domain === foreignDomain) delete channel.deferredForeign;
        });
        log(`tên miền cùng công ty: ${foreignDomain} — ${verdict.why}; nhận ${emails.length} hộp thư của chính công ty`);
        continue;
      }

      // Không xác minh được: loại cả hộp thư lẫn số điện thoại cùng khối, kèm lý do.
      emails.forEach((email) => {
        notes.push({
          kind: "excluded",
          label: email.value,
          detail: `Email thuộc tên miền ${email.domain}, khác website của công ty. Đã đọc ${foreignDomain} để kiểm nhưng ${verdict.why} — chưa đủ căn cứ, nên để người xem lại thay vì ghi thành liên hệ của công ty.`,
          sourceUrl: email.sourceUrl,
        });
      });
      dropDeferredPhones(
        foreignDomain,
        `Số này nằm cùng khối với email trên tên miền ${foreignDomain}, mà tên miền đó chưa xác minh được là của công ty — nên không ghi thành liên hệ.`,
      );
      log(`tên miền khác: ${foreignDomain} — ${verdict.why}; loại ${emails.length} hộp thư khỏi kênh công ty`);
    }

    // Phòng xa: không còn kênh nào mang trạng thái chờ.
    for (let index = channels.length - 1; index >= 0; index -= 1) {
      if (!channels[index].deferredForeign) continue;
      const channel = channels[index];
      const pending = channel.deferredForeign;
      notes.push({
        kind: "excluded",
        label: `${pending?.published ?? channel.value}${pending ? ` · ${pending.domain}` : ""}`,
        detail: "Số này nằm cùng khối với một email chưa xác minh được là của công ty — không ghi thành liên hệ.",
        sourceUrl: channel.sourceUrl,
      });
      channels.splice(index, 1);
    }
  }

  // ---------------------------------------------------- bước 3: nguồn cấp 2 ---
  const coverage = coverageOf(channels);
  const runReason = secondaryReason(coverage);
  const secondaryReport: SecondaryReport = {
    ran: false,
    reason: runReason ?? "nguồn cấp 1 đã có kênh thuộc nhóm mua hàng",
    registriesQueried: [],
  };

  if (secondaryEnabled && runReason && !stopBecauseDeadline("bước nguồn cấp 2")) {
    const searchApiKey = secondaryOptions.searchApiKey ?? process.env.SEARCH_API_KEY;
    const companiesHouseApiKey = secondaryOptions.companiesHouseApiKey ?? process.env.COMPANIES_HOUSE_API_KEY;
    const secUserAgent = secondaryOptions.secUserAgent ?? process.env.SEC_USER_AGENT;
    const maxExtra = secondaryOptions.maxUrls ?? DEFAULT_SECONDARY_URLS;
    let extraUrls: string[] = [];
    let extraDocuments: string[] = [];
    let didSomething = false;

    // (1) Search API — chỉ để tìm URL trong chính tên miền của công ty.
    if (searchApiKey) {
      const harvest = await harvestUrlsFromSearch(domain, {
        apiKey: searchApiKey,
        provider: secondaryOptions.searchProvider,
        fetchImpl: options.fetchImpl,
        log,
        limit: maxExtra,
      });
      secondaryReport.search = {
        provider: harvest.provider ?? "",
        queries: harvest.queriesRun,
        urls: harvest.urls.length,
        documents: harvest.documents.length,
      };
      extraUrls = harvest.urls;
      extraDocuments = harvest.documents;
      didSomething = didSomething || harvest.queriesRun > 0;
    }

    // (2) Sổ đăng ký doanh nghiệp — đối chiếu pháp nhân, không tạo kênh liên hệ.
    if (options.companyName?.trim()) {
      const registryOutcome = await lookupRegistry(country, options.companyName.trim(), { companiesHouseApiKey, secUserAgent, fetchImpl: options.fetchImpl, log });
      secondaryReport.registriesQueried = registryOutcome.queried;
      if (registryOutcome.finding) registry = registryOutcome.finding;
      else secondaryReport.registryReason = registryOutcome.reason;
      didSomething = didSomething || registryOutcome.queried.length > 0;
    } else if (registriesForCountry(country).length > 0) {
      secondaryReport.registryReason = "chưa có tên pháp nhân để tra sổ";
    }

    // (3) Đọc thêm đúng những URL vừa tìm được — vẫn phải qua robots.txt.
    const robots = plan.robots;
    const allowedExtra = (url: string) => {
      try {
        return isPathAllowed(robots, new URL(url).pathname);
      } catch {
        return false;
      }
    };

    const nextPages = extraUrls.slice(0, maxExtra).filter(allowedExtra).filter(keepDiscovered);
    const blocked = extraUrls.slice(0, maxExtra).filter((url) => !allowedExtra(url));
    blocked.forEach((url) => pages.push({ url, status: "skipped", reason: "robots.txt chặn", channels: 0 }));

    const nextDocuments = extraDocuments.slice(0, Math.min(maxExtra, DEFAULT_SECONDARY_DOCUMENTS)).filter(allowedExtra).filter(keepDiscovered);

    for (const url of nextPages) {
      if (stopBecauseDeadline("đọc thêm nguồn cấp 2")) break;
      await crawlPage(url);
      if (delayMs > 0) await sleep(delayMs);
    }
    for (const url of nextDocuments) {
      if (stopBecauseDeadline("đọc thêm tài liệu nguồn cấp 2")) break;
      await crawlDocument(url);
      if (delayMs > 0) await sleep(delayMs);
    }

    didSomething = didSomething || nextPages.length > 0 || nextDocuments.length > 0;
    secondaryReport.ran = didSomething;
    if (!didSomething) {
      secondaryReport.reason = `${runReason} — nhưng chưa cấu hình nguồn cấp 2 (thiếu khoá search / khoá sổ đăng ký / tên pháp nhân)`;
    }
    log(`nguồn cấp 2: ${secondaryReport.reason}${didSomething ? ` (đọc thêm ${nextPages.length + nextDocuments.length} nguồn)` : ""}`);
  } else if (!secondaryEnabled) {
    secondaryReport.reason = "nguồn cấp 2 bị tắt cho lần chạy này";
  }

  // Ghi chú "chưa thấy" chỉ giữ khi thật sự không tìm được gì trong toàn bộ lần chạy,
  // và gộp theo nhãn để không lặp lại cho từng trang.
  const familyOfLabel = (label: string): TargetFamily | undefined => {
    const lower = label.toLowerCase();
    if (lower.includes("whatsapp")) return "whatsapp";
    if (lower.includes("linkedin")) return "linkedin";
    if (lower.includes("email")) return "email";
    if (lower.includes("phone") || lower.includes("điện thoại")) return "phone";
    if (lower.includes("biểu mẫu") || lower.includes("form")) return "form";
    return undefined;
  };
  const channelTypeOf: Record<TargetFamily, string> = {
    email: "email",
    phone: "phone",
    whatsapp: "whatsapp",
    linkedin: "linkedin",
    form: "form",
  };
  const stillMissing = (family: TargetFamily) =>
    targets.includes(family) && !channels.some((channel) => channel.type === channelTypeOf[family]);

  const formMerge = collapseFormChannels(channels);
  if (formMerge.collapsed > 0) {
    channels.length = 0;
    channels.push(...formMerge.channels);
    log(`biểu mẫu liên hệ: gộp ${formMerge.collapsed + 1} trang thành 1 cửa vào (giữ trang sát việc mua bán nhất)`);
  }

  const dedupedNotes: ConnectorNote[] = [];
  const noteKeys = new Set<string>();
  notes.forEach((note) => {
    if (note.kind === "not_found") {
      const family = familyOfLabel(note.label);
      if (!family || !stillMissing(family)) return;
    }
    const key = `${note.kind}:${note.label}:${note.detail}`;
    if (noteKeys.has(key)) return;
    noteKeys.add(key);
    dedupedNotes.push(note);
  });

  // Danh sách "gần đúng" tính **sau** bước 3, trên kênh cuối cùng: chỉ nêu khi
  // đã thử mọi bước mà vẫn chưa tới được cửa mua hàng. Có cửa thật rồi thì thôi —
  // lúc đó nêu thêm chỉ làm loãng thứ đã tìm được.
  // Lưu ý: hàm này **không** tham gia vào cổng quyết định; coverage phía trên
  // giữ nguyên, nên một dòng "gần đúng" không bao giờ chặn bước sau.
  const reviewHints = coverageOf(channels).enough ? [] : nearMissBuyingDoors(channels);
  if (reviewHints.length > 0) {
    log(`kênh gần đúng: ${reviewHints.length} hộp thư có tên gợi tới nguyên liệu/vật tư — để người xem lại, không tính vào cổng`);
  }

  return {
    seedUrl,
    domain,
    pages,
    channels,
    reviewHints,
    people: [...people.values()],
    requirements: sortRequirements(requirements),
    ...(registry ? { registry } : {}),
    secondary: secondaryReport,
    notes: dedupedNotes,
    pagesFetched,
    ...(identityMatched === undefined ? {} : { identityMatched }),
    ...(siblingDomains.length > 0 ? { siblingDomains } : {}),
    ...(siteDescription ? { description: siteDescription } : {}),
    ...(stoppedEarly ? { stoppedEarly } : {}),
  };
}

export { normalizeSeed } from "./discover";
export type { ConnectorResult, RegistryFinding, SecondaryReport } from "./types";
