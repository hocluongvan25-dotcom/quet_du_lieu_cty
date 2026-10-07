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

import { extractFromLines, extractFromPage } from "./extract";
import { fetchPage } from "./fetch";
import { pdfToLines } from "./pdf";
import { planDiscovery, normalizeSeed, hostOf, type DiscoveryOptions } from "./discover";
import { registrableDomain } from "./html";
import { isPathAllowed } from "./robots";
import { coverageOf, secondaryReason } from "./gate";
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
};

const DEFAULT_TARGETS: TargetFamily[] = ["email", "phone", "whatsapp", "linkedin", "form"];

/** Trần mặc định số trang đọc thêm ở bước 3. */
const DEFAULT_SECONDARY_URLS = 6;
/** Tài liệu nặng hơn trang HTML nên đọc ít hơn. */
const DEFAULT_SECONDARY_DOCUMENTS = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const htmlUrls = [...new Set(plan.urls)];
  log(`đọc ${htmlUrls.length} trang trên ${domain}${plan.sitemapFound ? " (có sitemap)" : ""}`);

  for (const url of htmlUrls) {
    await crawlPage(url);
    if (delayMs > 0) await sleep(delayMs);
  }

  const documentUrls = [...new Set(plan.documents)].filter((url) => !htmlUrls.includes(url));
  if (documentUrls.length > 0) log(`đọc ${documentUrls.length} tài liệu PDF trên ${domain}`);

  for (const url of documentUrls) {
    await crawlDocument(url);
    if (delayMs > 0) await sleep(delayMs);
  }

  // ---------------------------------------------------- bước 3: nguồn cấp 2 ---
  const coverage = coverageOf(channels);
  const runReason = secondaryReason(coverage);
  const secondaryReport: SecondaryReport = {
    ran: false,
    reason: runReason ?? "nguồn cấp 1 đã có kênh thuộc nhóm mua hàng",
    registriesQueried: [],
  };

  if (secondaryEnabled && runReason) {
    const searchApiKey = secondaryOptions.searchApiKey ?? process.env.SEARCH_API_KEY;
    const companiesHouseApiKey = secondaryOptions.companiesHouseApiKey ?? process.env.COMPANIES_HOUSE_API_KEY;
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
      const registryOutcome = await lookupRegistry(country, options.companyName.trim(), { companiesHouseApiKey, fetchImpl: options.fetchImpl, log });
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

    const nextPages = extraUrls.slice(0, maxExtra).filter(allowedExtra);
    const blocked = extraUrls.slice(0, maxExtra).filter((url) => !allowedExtra(url));
    blocked.forEach((url) => pages.push({ url, status: "skipped", reason: "robots.txt chặn", channels: 0 }));

    const nextDocuments = extraDocuments.slice(0, Math.min(maxExtra, DEFAULT_SECONDARY_DOCUMENTS)).filter(allowedExtra);

    for (const url of nextPages) {
      await crawlPage(url);
      if (delayMs > 0) await sleep(delayMs);
    }
    for (const url of nextDocuments) {
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

  return {
    seedUrl,
    domain,
    pages,
    channels,
    people: [...people.values()],
    requirements: sortRequirements(requirements),
    ...(registry ? { registry } : {}),
    secondary: secondaryReport,
    notes: dedupedNotes,
    pagesFetched,
  };
}

export { normalizeSeed } from "./discover";
export type { ConnectorResult, RegistryFinding, SecondaryReport } from "./types";
