/**
 * Tách kênh liên hệ từ một trang công khai.
 *
 * Nguyên tắc bất di bất dịch: **chỉ lấy thứ có trên trang.** Hàm này không sinh
 * giá trị, không đoán pattern, không suy từ tổng đài ra số di động. Mọi giá trị
 * trả về đều kèm đúng câu chữ đã thấy nó (`evidenceSnippet`) và URL của trang.
 */

import { decodeEntities, htmlToLines, registrableDomain } from "./html";
import { findRequirements } from "@/lib/requirements";
import type { Certainty, ChannelPolicy, ConnectorNote, FoundChannel, FoundPerson, IdentityMatch, PageExtraction, TargetFamily } from "./types";

const EMAIL_RE = /[A-Za-z0-9._%+'\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Dãy số có phân cách, bắt buộc bắt đầu và kết thúc bằng chữ số. Việc kiểm tra
 * "có phải số điện thoại không" nằm ở số chữ số và ngữ cảnh của dòng, không nằm
 * ở hình dạng — vì mỗi nước viết một kiểu.
 */
const PHONE_RE = /(?:\+|00)?\d[\d\s().\-]{6,20}\d/g;

/** Local part của email bộ phận — không phải của một cá nhân. */
const DEPARTMENT_LOCALS = new Set([
  "info", "hello", "contact", "contactus", "sales", "support", "service", "customerservice", "cs", "help",
  "orders", "order", "admin", "office", "hr", "jobs", "careers", "marketing", "press", "media", "pr",
  "procurement", "purchasing", "sourcing", "suppliers", "vendor", "vendors", "ingredients", "export",
  "exports", "import", "imports", "wholesale", "b2b", "accounts", "accounting", "billing", "finance",
  "enquiries", "enquiry", "inquiries", "inquiry", "general", "team", "mail", "shop", "store",
]);

/** Giá trị trông giống email nhưng là tên file hoặc email hệ thống. */
const ASSET_EMAIL_RE = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf)$/i;
const JUNK_DOMAINS = ["example.com", "domain.com", "yourdomain.com", "email.com", "sentry.io", "wixpress.com", "sentry-next.wixpress.com"];

const CHAT_WIDGETS: { pattern: RegExp; name: string }[] = [
  { pattern: /gorgias/i, name: "Gorgias" },
  { pattern: /zendesk/i, name: "Zendesk" },
  { pattern: /intercom/i, name: "Intercom" },
  { pattern: /crisp\.chat|livechat|tawk\.to|drift\.com|tidio|freshchat|hubspot.*conversations/i, name: "chat trực tuyến" },
];

const LOGIN_HINTS = /\/(login|signin|sign-in|auth|account|dang-nhap)(\/|$|\?)/i;

const TITLE_WORDS = "Sales Contact|Contact|Buyer|Purchasing Manager|Procurement Manager|Category Manager|Sales Manager|Export Manager|Director|Manager|Coordinator|Specialist|Executive|President|Owner|Founder";
const NAME_PATTERN = "[A-Z][A-Za-z'’.-]+(?:\\s+[A-Z][A-Za-z'’.-]+){1,2}";

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, max = 220): string {
  const text = clean(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[()\s.]/g, "").replace(/-/g, "");
  const hadPlus = stripped.startsWith("+") || raw.trim().startsWith("+") || raw.trim().startsWith("00");
  let digits = stripped.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  digits = digits.replace(/\+/g, "");
  if (!digits) return "";
  return hadPlus ? `+${digits}` : digits;
}

function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/** Bộ phận hay cá nhân? Chỉ dựa vào chính local part, không phán bừa. */
export function classifyEmailLocal(local: string): IdentityMatch {
  const key = local.toLowerCase().replace(/[._-]/g, "");
  if (DEPARTMENT_LOCALS.has(key)) return "department";
  if (DEPARTMENT_LOCALS.has(local.toLowerCase())) return "department";
  return "company_general";
}

function isAssetEmail(value: string): boolean {
  if (ASSET_EMAIL_RE.test(value)) return true;
  const [local, domain] = value.toLowerCase().split("@");
  if (!domain) return true;
  if (JUNK_DOMAINS.includes(domain)) return true;
  // "hero@2x.png" bị regex bắt vì có @ — loại theo dấu hiệu tên file ảnh.
  if (/^[a-z0-9-]+$/.test(local) && /2x$|@2x|\.(png|jpg|jpeg|webp)$/.test(value.toLowerCase())) return true;
  if (local.length > 40) return true;
  return false;
}

/** Tên người công bố ngay cạnh giá trị, ví dụ "Sales Contact – Steve Sousa". */
export function findAdjacentPerson(window: string): { name: string; title?: string } | undefined {
  const before = new RegExp(`(${TITLE_WORDS})\\s*[–—-]\\s*(${NAME_PATTERN})`, "g");
  const after = new RegExp(`(${NAME_PATTERN})\\s*[–—-]\\s*(${TITLE_WORDS})`, "g");

  let match = before.exec(window);
  if (match) {
    const all = window.match(before) ?? [];
    const last = all[all.length - 1] ?? match[0];
    const parsed = new RegExp(`(${TITLE_WORDS})\\s*[–—-]\\s*(${NAME_PATTERN})`).exec(last);
    if (parsed) return { name: clean(parsed[2]), title: clean(parsed[1]) };
  }

  match = after.exec(window);
  if (match) {
    const parsed = new RegExp(`(${NAME_PATTERN})\\s*[–—-]\\s*(${TITLE_WORDS})`).exec(match[0]);
    if (parsed) return { name: clean(parsed[1]), title: clean(parsed[2]) };
  }

  return undefined;
}

export type ExtractInput = {
  url: string;
  html: string;
  targets?: TargetFamily[];
};

export type ExtractLinesInput = {
  url: string;
  lines: string[];
  /** Nguồn của các dòng: trang HTML hay file PDF công khai. */
  kind?: "html" | "pdf";
  /** Chỉ dùng cho HTML: mailto:, link mạng xã hội, `<form>`, widget chat. */
  html?: string;
  targets?: TargetFamily[];
};

/**
 * Tách dữ liệu từ những dòng chữ đã có sẵn — dùng chung cho HTML và PDF.
 * Phần chỉ có ở HTML (mailto:, link mạng xã hội, `<form>`, widget chat) tự bỏ qua
 * khi nguồn là PDF.
 */
export function extractFromLines({ url, lines, kind = "html", html: rawHtml = "", targets = ["email", "phone", "whatsapp", "linkedin", "form"] }: ExtractLinesInput): PageExtraction {
  const html = kind === "html" ? rawHtml : "";
  const text = lines.join(" | ");
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const siteDomain = registrableDomain(host);

  const channels: FoundChannel[] = [];
  const notes: ConnectorNote[] = [];
  const people: FoundPerson[] = [];
  const requirements = findRequirements({ url, lines, kind });
  const seen = new Set<string>();

  const push = (channel: FoundChannel) => {
    const key = `${channel.type}:${channel.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    channels.push(channel);
  };

  // ---------------------------------------------------------------- emails ---
  const emailMatches: { value: string; index: number; line: string }[] = [];
  lines.forEach((line, lineIndex) => {
    const found = line.match(EMAIL_RE) ?? [];
    found.forEach((value) => emailMatches.push({ value, index: lineIndex, line }));
  });
  // mailto: trong href, kể cả khi chữ trên trang bị cắt. PDF không có href.
  const mailtoMatches = kind === "html" ? html.match(/mailto:([^"'>?\s]+)/gi) ?? [] : [];
  mailtoMatches.forEach((raw) => {
    const value = decodeEntities(raw.replace(/^mailto:/i, "").trim());
    if (!value) return;
    const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(value.toLowerCase()));
    emailMatches.push({ value, index: lineIndex === -1 ? 0 : lineIndex, line: lines[lineIndex === -1 ? 0 : lineIndex] ?? value });
  });

  const uniqueEmails = new Map<string, { value: string; index: number }>();
  emailMatches.forEach((match) => {
    if (isAssetEmail(match.value)) return;
    const key = match.value.toLowerCase();
    if (!uniqueEmails.has(key)) uniqueEmails.set(key, match);
  });

  const foreignEmails: { value: string; domain: string; line: number }[] = [];
  const ownEmailLines: number[] = [];

  uniqueEmails.forEach((match) => {
    const [local, domain] = match.value.split("@");
    if (!domain) return;
    const emailDomain = registrableDomain(domain);

    if (emailDomain !== siteDomain) {
      // Không thuộc website này: ghi vào "đã loại trừ" kèm lý do, không đưa vào kênh.
      foreignEmails.push({ value: match.value, domain: emailDomain, line: match.index });
      return;
    }

    if (emailDomain === siteDomain) ownEmailLines.push(match.index);

    const window = lines.slice(Math.max(0, match.index - 2), Math.min(lines.length, match.index + 2)).join(" | ");
    const adjacent = findAdjacentPerson(window);
    const identity = adjacent ? "person" : classifyEmailLocal(local);

    push({
      type: "email",
      value: match.value,
      label: adjacent ? `Email công bố — ${adjacent.name}` : identity === "department" ? "Email bộ phận" : "Email chung",
      identityMatch: identity,
      certainty: "confirmed",
      policy: "needs_mailbox_check",
      sourceUrl: url,
      evidenceSnippet: clip(lines[match.index] ?? match.value),
      personName: adjacent?.name,
      personTitle: adjacent?.title,
    });

    if (adjacent) {
      people.push({
        id: `person-${adjacent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: adjacent.name,
        title: adjacent.title,
        sourceUrl: url,
        evidenceSnippet: clip(lines[match.index] ?? match.value),
        channelValues: [match.value],
      });
    }
  });

  // ---------------------------------------------------------------- phones ---
  const phoneMatches: { value: string; line: number; raw: string }[] = [];
  lines.forEach((line, lineIndex) => {
    // Số điện thoại phải xuất hiện ở dòng có dấu hiệu liên hệ, để không bắt nhầm mã số.
    const hasContext = /phone|tel|call|điện thoại|hotline|fax|contact|liên hệ|\+\d/i.test(line);
    const found = line.match(PHONE_RE) ?? [];
    found.forEach((raw) => {
      const digits = digitCount(raw);
      if (digits < 9 || digits > 15) return;
      const explicitCountry = raw.trim().startsWith("+") || raw.trim().startsWith("00");
      if (!hasContext && !explicitCountry) return;
      // Mã số, mã đơn hàng, mã số thuế: chuỗi số thuần không phân cách, không phải điện thoại.
      if (!explicitCountry && !/[\s().\-]/.test(raw)) return;
      const value = normalizePhone(raw);
      if (!value) return;
      phoneMatches.push({ value, line: lineIndex, raw });
    });
  });

  const seenPhones = new Set<string>();
  phoneMatches.forEach((match) => {
    if (seenPhones.has(match.value)) return;
    seenPhones.add(match.value);

    // Điện thoại nằm cùng khối với email của bên thứ ba: không nhận là số của công ty.
    // Nhưng nếu email của chính công ty cũng ở ngay đó thì đây là số của công ty —
    // trường hợp này xảy ra khi trang liệt kê cả liên hệ của đơn vị vận hành web store.
    const nearbyForeign = foreignEmails.find((email) => Math.abs(email.line - match.line) <= 2);
    const nearbyOwn = ownEmailLines.some((line) => Math.abs(line - match.line) <= 2);
    if (nearbyForeign && !nearbyOwn) {
      notes.push({
        kind: "excluded",
        label: `${match.raw} · ${nearbyForeign.value}`,
        detail: `Số này nằm cùng khối với email của bên thứ ba (${nearbyForeign.domain}) nên không được ghi thành liên hệ của công ty.`,
        sourceUrl: url,
      });
      return;
    }

    const isFax = /fax/i.test(lines[match.line] ?? "");
    push({
      type: "phone",
      value: match.value,
      // Fax là dữ liệu thật trên trang, nhưng không phải kênh để liên hệ.
      label: isFax ? "Fax công bố" : "Điện thoại công bố",
      identityMatch: "company_general",
      certainty: "confirmed",
      policy: isFax ? "manual_contact_only" : "outreach_ready",
      sourceUrl: url,
      evidenceSnippet: clip(lines[match.line] ?? match.raw),
    });
  });

  // ------------------------------------------------------- social / links ---
  const linkMatches = kind === "html" ? html.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [] : [];
  const hrefs = linkMatches.map((raw) => decodeEntities(raw.replace(/[.,)]+$/, "")));

  hrefs.forEach((href) => {
    let target: FoundChannel | undefined;
    try {
      const parsed = new URL(href);
      const cleanHref = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}${parsed.search}`;

      if (/linkedin\.com$/i.test(parsed.hostname.replace(/^www\./, ""))) {
        const isProfile = /^\/in\//i.test(parsed.pathname);
        if (!isProfile && !/^\/company\//i.test(parsed.pathname)) return;
        target = {
          type: "linkedin",
          value: cleanHref.replace(/\/$/, ""),
          label: isProfile ? "Hồ sơ LinkedIn công khai" : "LinkedIn công ty",
          identityMatch: isProfile ? "person" : "company_general",
          certainty: "confirmed",
          policy: "manual_contact_only",
          sourceUrl: url,
          evidenceSnippet: `Liên kết trên ${host}`,
        };
      } else if (/wa\.me$/i.test(parsed.hostname) || /whatsapp\.com$/i.test(parsed.hostname)) {
        const digits = (parsed.pathname.match(/\d{6,}/) ?? parsed.search.match(/phone=(\d{6,})/) ?? [])[0];
        if (!digits) return;
        target = {
          type: "whatsapp",
          value: cleanHref.replace(/\/$/, ""),
          label: "WhatsApp công bố",
          identityMatch: "company_general",
          certainty: "confirmed",
          policy: "outreach_ready",
          sourceUrl: url,
          evidenceSnippet: `Liên kết WhatsApp trên ${host}`,
        };
      }
    } catch {
      return;
    }
    if (target) push(target);
  });

  // Biểu mẫu liên hệ / đăng ký nhà cung cấp: dấu hiệu bằng chữ trên trang.
  const formMatch = kind === "html" && /<form\b[^>]*>/gi.test(html) && /contact|enquir|inquir|supplier|vendor|register|liên hệ/i.test(text);
  if (formMatch && targets.includes("form")) {
    const line = lines.find((item) => /contact|enquir|inquir|supplier|vendor|register|liên hệ/i.test(item)) ?? "";
    push({
      type: "form",
      value: url,
      label: "Biểu mẫu liên hệ trên website",
      identityMatch: "company_general",
      certainty: "confirmed",
      policy: "manual_contact_only",
      sourceUrl: url,
      evidenceSnippet: clip(line),
    });
  }

  // ------------------------------------------------- ghi chú loại trừ --------
  foreignEmails.forEach((email) => {
    notes.push({
      kind: "excluded",
      label: email.value,
      detail: `Email thuộc tên miền ${email.domain}, khác website của công ty — có thể của đơn vị vận hành web store hoặc bên thứ ba, nên không ghi thành liên hệ của công ty.`,
      sourceUrl: url,
    });
  });

  // ------------------------------------------------- ghi chú chưa thấy ------
  if (kind === "html" && targets.includes("whatsapp") && !channels.some((channel) => channel.type === "whatsapp")) {
    const widget = CHAT_WIDGETS.find((item) => item.pattern.test(html));
    notes.push({
      kind: "not_found",
      label: "WhatsApp chính thức",
      detail: widget
        ? `Không có liên kết wa.me hay số WhatsApp nào được công bố trên trang này; trang chỉ có ${widget.name} (chat trên website). Không suy diễn từ số tổng đài.`
        : "Không có liên kết wa.me hay số WhatsApp nào được công bố trên trang này. Không suy diễn từ số tổng đài.",
      sourceUrl: url,
    });
  }

  if (kind === "html" && targets.includes("linkedin") && !channels.some((channel) => channel.type === "linkedin" && channel.identityMatch === "company_general")) {
    notes.push({
      kind: "not_found",
      label: "LinkedIn công ty",
      detail: "Không thấy liên kết LinkedIn nào trên trang này.",
      sourceUrl: url,
    });
  }

  return { channels, people, requirements, notes };
}

export function extractFromPage({ url, html, targets = ["email", "phone", "whatsapp", "linkedin", "form"] }: ExtractInput): PageExtraction {
  return extractFromLines({ url, lines: htmlToLines(html), kind: "html", html, targets });
}

export function isLoginWall(url: string): boolean {
  return LOGIN_HINTS.test(url);
}

/** Nhãn tin cậy mặc định cho giá trị đọc được từ chính trang công bố. */
export const FROM_PAGE_CERTAINTY: Certainty = "confirmed";
export const FROM_PAGE_POLICY: ChannelPolicy = "outreach_ready";
