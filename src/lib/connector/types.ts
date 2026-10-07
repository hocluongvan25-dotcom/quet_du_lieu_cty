/**
 * Kiểu dữ liệu của connector. Chỉ có giá trị tìm được, nguồn, bằng chứng và
 * nhãn tin cậy — không có trường nào mang tính khuyên bảo (xem spec §10).
 */

export type Certainty = "confirmed" | "probable" | "inferred";
export type IdentityMatch = "person" | "department" | "company_general" | "unknown";
export type ChannelPolicy = "outreach_ready" | "needs_mailbox_check" | "manual_contact_only" | "requires_override";
export type ChannelType = "email" | "phone" | "linkedin" | "whatsapp" | "form" | "link";

/** Một kênh tìm thấy trên trang công khai, kèm đúng câu chữ đã thấy nó. */
export type FoundChannel = {
  type: ChannelType;
  value: string;
  label: string;
  identityMatch: IdentityMatch;
  certainty: Certainty;
  policy: ChannelPolicy;
  sourceUrl: string;
  evidenceSnippet: string;
  /**
   * Số điện thoại đã chuẩn hoá về E.164 — chỉ có khi biết quốc gia của công ty.
   * `value` vẫn giữ nguyên như đã công bố; đây là trường thứ hai, không thay thế.
   */
  e164?: string | null;
  /** Khi `e164` là null: vì sao chưa chuẩn hoá được (để người kiểm đọc, không hiện cho người dùng). */
  e164Reason?: string;
  /** Có khi giá trị được công bố ngay cạnh tên một người. */
  personName?: string;
  personTitle?: string;
};

export type FoundPerson = {
  id: string;
  name: string;
  title?: string;
  sourceUrl: string;
  evidenceSnippet: string;
  channelValues: string[];
};

import type { Requirement } from "@/lib/requirements";

export type ConnectorNote = {
  kind: "not_found" | "excluded" | "skipped";
  label: string;
  detail: string;
  sourceUrl?: string;
};

export type PageReport = {
  url: string;
  status: number | "blocked" | "error" | "skipped";
  reason?: string;
  channels: number;
  /** Trang HTML hay file PDF công khai (báo cáo, press release, catalogue…). */
  kind?: "html" | "pdf";
};

export type ConnectorResult = {
  seedUrl: string;
  domain: string;
  pages: PageReport[];
  channels: FoundChannel[];
  people: FoundPerson[];
  /** Yêu cầu/giấy tờ nhà nhập khẩu công bố đối với nhà cung cấp, kèm câu chữ gốc. */
  requirements: Requirement[];
  notes: ConnectorNote[];
  /** Số trang đã tải thực tế. */
  pagesFetched: number;
};

export type TargetFamily = "email" | "phone" | "whatsapp" | "linkedin" | "form";

export type PageExtraction = {
  channels: FoundChannel[];
  people: FoundPerson[];
  requirements: Requirement[];
  notes: ConnectorNote[];
};
