/**
 * Connector: từ tên miền công ty → kênh liên hệ công khai, có nguồn.
 *
 * Chạy ở nơi có egress mạng (máy người dùng hoặc server production). Sandbox
 * không ra được internet nên phần này được kiểm bằng fixture HTML thật, xem
 * `npm run connector:test`.
 *
 * Cam kết của connector (được kiểm trong test):
 *  - chỉ đọc trang công khai, không đăng nhập, không giải CAPTCHA, không cookie;
 *  - tôn trọng robots.txt;
 *  - chỉ lấy giá trị có trên trang, không sinh email theo pattern;
 *  - mọi giá trị đều kèm câu chữ đã thấy nó và URL của trang;
 *  - thứ của bên thứ ba (tên miền khác) vào mục "đã loại trừ", không vào kênh;
 *  - đọc cả PDF cùng tên miền (báo cáo thường niên, press release, tài liệu nhà
 *    cung cấp) — nơi chứa những thứ trang HTML không có; PDF scan ảnh thì ghi
 *    "không đọc được", không đoán.
 */

import { extractFromLines, extractFromPage } from "./extract";
import { fetchPage } from "./fetch";
import { pdfToLines } from "./pdf";
import { planDiscovery, normalizeSeed, hostOf, type DiscoveryOptions } from "./discover";
import { registrableDomain } from "./html";
import type { ConnectorNote, ConnectorResult, FoundChannel, FoundPerson, PageReport, TargetFamily } from "./types";

export type RunConnectorOptions = DiscoveryOptions & {
  targets?: TargetFamily[];
  /** Nghỉ giữa các lần tải để không ép máy chủ của họ. */
  delayMs?: number;
  maxPages?: number;
};

const DEFAULT_TARGETS: TargetFamily[] = ["email", "phone", "whatsapp", "linkedin", "form"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runConnector(seedInput: string, options: RunConnectorOptions = {}): Promise<ConnectorResult> {
  const seedUrl = normalizeSeed(seedInput);
  const log = options.log ?? (() => {});
  const targets = options.targets ?? DEFAULT_TARGETS;
  const delayMs = options.delayMs ?? 300;

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

  plan.skipped.forEach((entry) => {
    pages.push({ url: entry.url, status: "skipped", reason: entry.reason, channels: 0 });
  });

  const urls = [...new Set(plan.urls)];
  log(`đọc ${urls.length} trang trên ${domain}`);

  let pagesFetched = 0;

  for (const url of urls) {
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
      continue;
    }

    const extracted = extractFromPage({ url: outcome.finalUrl, html: outcome.body, targets });

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

    notes.push(...extracted.notes);
    pages.push({ url: outcome.finalUrl, status: outcome.status, channels: extracted.channels.length, kind: "html" });

    if (delayMs > 0) await sleep(delayMs);
  }

  // ------------------------------------------------------------- tài liệu ---
  const documentUrls = [...new Set(plan.documents)].filter((url) => !urls.includes(url));
  if (documentUrls.length > 0) log(`đọc ${documentUrls.length} tài liệu PDF trên ${domain}`);

  for (const url of documentUrls) {
    pagesFetched += 1;
    const outcome = await fetchPage(url, { fetchImpl: options.fetchImpl, userAgent: options.userAgent, guard: options.guard });

    if (!outcome.ok) {
      pages.push({ url: outcome.finalUrl, status: outcome.blocked ? "blocked" : "error", reason: outcome.reason ?? "không tải được", channels: 0, kind: "pdf" });
      if (delayMs > 0) await sleep(delayMs);
      continue;
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
      if (delayMs > 0) await sleep(delayMs);
      continue;
    }

    const extracted = extractFromLines({ url: outcome.finalUrl, lines: pdf.lines, kind: "pdf", targets });

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

    notes.push(...extracted.notes);
    pages.push({ url: outcome.finalUrl, status: outcome.status, channels: extracted.channels.length, kind: "pdf" });

    if (delayMs > 0) await sleep(delayMs);
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
    notes: dedupedNotes,
    pagesFetched,
  };
}

export { normalizeSeed } from "./discover";
export type { ConnectorResult } from "./types";
