import { marianiReport } from "@/lib/demo-mariani";

export type ReportStatus = "ready" | "researching" | "needs_review";

export type Source = {
  label: string;
  url: string;
  kind: "website" | "directory" | "social" | "news";
  verified?: boolean;
};

/** How sure we are that a value is the real one (mirrors `channel_certainty`). */
export type Certainty = "confirmed" | "probable" | "inferred";

/** Whose address this is (mirrors `identity_match`). Delivery is a separate question. */
export type IdentityMatch = "person" | "department" | "company_general" | "unknown";

/** Whether a channel may be exported or used for outreach (mirrors `contact_export_policy`). */
export type ChannelPolicy = "outreach_ready" | "needs_mailbox_check" | "manual_contact_only" | "requires_override";

export type Contact = {
  label: string;
  value: string;
  type: "website" | "email" | "phone" | "linkedin" | "whatsapp";
  verified: boolean;
  source: string;
  /** Optional provenance fields: present on data that came through the pipeline. */
  certainty?: Certainty;
  identityMatch?: IdentityMatch;
  via?: string;
  sourceUrl?: string;
  policy?: ChannelPolicy;
};

export type PersonChannel = {
  type: "email" | "phone" | "linkedin";
  value: string;
  certainty: Certainty;
  policy: ChannelPolicy;
  note?: string;
};

/** A decision maker or department contact: the thing the seller actually needs. */
export type DecisionMaker = {
  id: string;
  name: string;
  title: string;
  department: string;
  previousRole?: string;
  /** 1 = most relevant for this search. */
  rank: number;
  relevance: string;
  identityMatch: IdentityMatch;
  certainty: Certainty;
  sourceLabel: string;
  sourceUrl: string;
  lastSeenAt: string;
  channels: PersonChannel[];
  caution?: string;
};

/** What we looked for and did not find, or found and deliberately excluded. */
export type IntelNote = {
  kind: "not_found" | "excluded";
  label: string;
  detail: string;
  sourceUrl?: string;
};

export type CompanyReport = {
  id: string;
  companyName: string;
  initials: string;
  accent: string;
  country: string;
  sourceInput?: string;
  status: ReportStatus;
  confidence: number;
  createdAt: string;
  expiresAt: string;
  daysLeft: number;
  industry: string;
  description: string;
  website?: string;
  /** Company facts the agreed output format calls for. */
  foundedYear?: number;
  headcount?: string;
  address?: string;
  lastUpdated: string;
  contacts: Contact[];
  sources: Source[];
  signals: string[];
  /**
   * What the seller is offering. The same company has different "right people"
   * depending on this: a raw-material supplier needs Procurement, a finished-goods
   * or private-label seller needs whoever owns the channel and the range.
   */
  sellerOffer?: "ingredients" | "packaging" | "finished_product";
  /** Decision makers / department routes, ranked for this search. */
  people?: DecisionMaker[];
  /** Not-found and excluded findings, so absence is visible instead of invented. */
  notes?: IntelNote[];
};

export const initialReports: CompanyReport[] = [marianiReport, 
  {
    id: "report-nova",
    companyName: "Nova Distribution Ltd.",
    initials: "ND",
    accent: "#7C6CFC",
    country: "Singapore",
    status: "ready",
    confidence: 94,
    createdAt: "Hôm nay, 09:42",
    expiresAt: "05/11/2026",
    daysLeft: 30,
    industry: "Phân phối & thương mại",
    description:
      "Nhà phân phối thiết bị tiêu dùng tại Đông Nam Á, có dấu hiệu hoạt động B2B rõ ràng và website chính thức đã được xác minh.",
    website: "novadistribution.example",
    lastUpdated: "09:42 hôm nay",
    contacts: [
      {
        label: "Website chính thức",
        value: "novadistribution.example",
        type: "website",
        verified: true,
        source: "Website công ty",
      },
      {
        label: "LinkedIn công ty",
        value: "linkedin.com/company/nova-distribution",
        type: "linkedin",
        verified: true,
        source: "Liên kết từ website",
      },
      {
        label: "Email kinh doanh",
        value: "sales@novadistribution.example",
        type: "email",
        verified: true,
        source: "Trang Contact",
      },
      {
        label: "Điện thoại văn phòng",
        value: "+65 6123 4820",
        type: "phone",
        verified: true,
        source: "Trang Contact",
      },
    ],
    sources: [
      {
        label: "Website chính thức",
        url: "https://novadistribution.example/about",
        kind: "website",
        verified: true,
      },
      {
        label: "Trang liên hệ",
        url: "https://novadistribution.example/contact",
        kind: "website",
        verified: true,
      },
      {
        label: "LinkedIn Company Page",
        url: "https://linkedin.com/company/nova-distribution",
        kind: "social",
      },
      {
        label: "Trade Directory",
        url: "https://directory.example/nova-distribution",
        kind: "directory",
      },
    ],
    signals: ["Website xác minh", "Có LinkedIn", "Contact B2B công khai"],
  },
  {
    id: "report-hoshi",
    companyName: "Hoshi Components Co.",
    initials: "HC",
    accent: "#F29E4C",
    country: "Japan",
    status: "ready",
    confidence: 89,
    createdAt: "Hôm qua, 16:18",
    expiresAt: "04/11/2026",
    daysLeft: 29,
    industry: "Linh kiện công nghiệp",
    description:
      "Doanh nghiệp sản xuất linh kiện công nghiệp với danh mục sản phẩm và kênh liên hệ B2B công khai.",
    website: "hoshi-components.example",
    lastUpdated: "Hôm qua, 16:18",
    contacts: [
      {
        label: "Website chính thức",
        value: "hoshi-components.example",
        type: "website",
        verified: true,
        source: "Website công ty",
      },
      {
        label: "Email kinh doanh",
        value: "export@hoshi-components.example",
        type: "email",
        verified: true,
        source: "Trang Contact",
      },
      {
        label: "Điện thoại văn phòng",
        value: "+81 3 6812 2040",
        type: "phone",
        verified: true,
        source: "Trang Contact",
      },
    ],
    sources: [
      {
        label: "Website chính thức",
        url: "https://hoshi-components.example",
        kind: "website",
        verified: true,
      },
      {
        label: "Product catalog",
        url: "https://hoshi-components.example/catalog",
        kind: "website",
      },
      {
        label: "Industry directory",
        url: "https://directory.example/hoshi-components",
        kind: "directory",
      },
    ],
    signals: ["Danh mục sản phẩm", "Kênh export", "Website xác minh"],
  },
  {
    id: "report-velar",
    companyName: "Velar Foods GmbH",
    initials: "VF",
    accent: "#28A88B",
    country: "Germany",
    status: "needs_review",
    confidence: 67,
    createdAt: "02/10/2026",
    expiresAt: "01/11/2026",
    daysLeft: 26,
    industry: "Thực phẩm & nguyên liệu",
    description:
      "Phát hiện hai hồ sơ doanh nghiệp có tên gần giống. Cần kiểm tra địa chỉ hoặc website trước khi dùng contact.",
    website: "velarfoods.example",
    lastUpdated: "02/10/2026",
    contacts: [
      {
        label: "Website có khả năng khớp",
        value: "velarfoods.example",
        type: "website",
        verified: false,
        source: "Search result",
      },
      {
        label: "LinkedIn công ty",
        value: "linkedin.com/company/velar-foods",
        type: "linkedin",
        verified: false,
        source: "LinkedIn",
      },
    ],
    sources: [
      {
        label: "Website ứng viên",
        url: "https://velarfoods.example",
        kind: "website",
      },
      {
        label: "Trade Directory",
        url: "https://directory.example/velar-foods",
        kind: "directory",
      },
    ],
    signals: ["Cần xác minh", "Hai entity tương tự"],
  },
];

function toSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Companies we have already researched from public sources. When someone
 * searches one of these, the demo returns the real report — with sources,
 * confidence labels and the not-found notes — instead of synthetic data.
 */
const KNOWN_FIXTURES: { match: RegExp; report: CompanyReport }[] = [
  { match: /mariani|mariani\.com/i, report: marianiReport },
];

export function createDemoReport(input: {
  companyName?: string;
  sourceUrl?: string;
  country?: string;
}): CompanyReport {
  const probe = `${input.companyName ?? ""} ${input.sourceUrl ?? ""}`;
  const known = KNOWN_FIXTURES.find((fixture) => fixture.match.test(probe));

  if (known) {
    const now = new Date();
    const stamped = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    return { ...known.report, id: `report-${Date.now()}`, createdAt: `Hôm nay, ${stamped}`, lastUpdated: `${stamped} hôm nay` };
  }

  const fromUrl = input.sourceUrl
    ?.replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(".")[0]
    .replace(/[-_]/g, " ");
  const rawName = input.companyName?.trim() || fromUrl || "Company research";
  const companyName = rawName
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  const initials = companyName
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  const slug = toSlug(companyName);
  const domain = input.sourceUrl
    ? input.sourceUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : `${slug || "company"}.example`;
  const sourceUrl = input.sourceUrl?.startsWith("http")
    ? input.sourceUrl
    : `https://${domain}`;
  const today = new Date();
  const expiry = new Date(today);
  expiry.setDate(today.getDate() + 30);
  const dateText = expiry.toLocaleDateString("vi-VN");

  return {
    id: `report-${Date.now()}`,
    companyName,
    initials: initials || "CR",
    accent: "#4F7CFF",
    country: input.country || "Chưa xác định",
    sourceInput: input.sourceUrl,
    status: "ready",
    confidence: input.sourceUrl ? 91 : 84,
    createdAt: "Vừa xong",
    expiresAt: dateText,
    daysLeft: 30,
    industry: "Đang chờ phân loại",
    description:
      "Đây là báo cáo minh hoạ trong chế độ demo. Khi kết nối nguồn dữ liệu và AI provider, hệ thống sẽ thay bằng kết quả research có bằng chứng thực tế.",
    website: domain,
    lastUpdated: "Vừa xong",
    contacts: [
      {
        label: "Website tham chiếu",
        value: domain,
        type: "website",
        verified: Boolean(input.sourceUrl),
        source: input.sourceUrl ? "Link người dùng cung cấp" : "Candidate discovery",
      },
      {
        label: "LinkedIn công ty",
        value: `linkedin.com/company/${slug || "company"}`,
        type: "linkedin",
        verified: false,
        source: "Candidate discovery",
      },
      {
        label: "Email kinh doanh",
        value: "Chưa xác minh",
        type: "email",
        verified: false,
        source: "Chưa có evidence",
      },
    ],
    sources: [
      {
        label: input.sourceUrl ? "Link bạn đã cung cấp" : "Candidate website",
        url: sourceUrl,
        kind: "website",
        verified: Boolean(input.sourceUrl),
      },
      {
        label: "Search discovery",
        url: `https://www.google.com/search?q=${encodeURIComponent(companyName)}`,
        kind: "directory",
      },
    ],
    signals: input.sourceUrl
      ? ["Có link tham chiếu", "Cần chạy connector thật để xác minh"]
      : ["Tìm bằng tên công ty", "Nên bổ sung quốc gia để tăng độ chính xác"],
  };
}
