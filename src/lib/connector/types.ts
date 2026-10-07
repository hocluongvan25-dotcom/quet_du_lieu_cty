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
import type { RegistryFinding } from "./secondary";

export type { RegistryFinding };

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

/**
 * Báo cáo bước 3 — nguồn cấp 2. Ghi lại **có chạy hay không và vì sao**, để
 * người kiểm đọc được lý do mà không phải đoán. Không hiện cho người dùng cuối:
 * người dùng chỉ thấy thứ tìm được (spec §9).
 */
export type SecondaryReport = {
  /** Có gọi ra ngoài website công ty không. */
  ran: boolean;
  /** Vì sao chạy, hoặc vì sao không chạy. */
  reason: string;
  /** Có dùng search API không: tên nhà cung cấp, số truy vấn, số URL thu được. */
  search?: { provider: string; queries: number; urls: number; documents: number };
  /** Sổ đăng ký đã hỏi (kể cả khi không ra kết quả). */
  registriesQueried: string[];
  /** Vì sao sổ đăng ký không cho kết quả — nếu vậy. */
  registryReason?: string;
};

/**
 * Kênh "gần đúng": hộp thư theo bộ phận có tên gợi tới **thứ công ty mua vào**
 * (nguyên liệu, vật tư…) nhưng không thuộc nhóm mua hàng theo luật hiện tại.
 *
 * Là **dữ liệu để người xem lại**, không phải một kết luận và không phải một
 * gợi ý hành động. Hộp thư tên `ingredients@` không cho biết đó là bộ phận mua
 * hay bộ phận bán — vì vậy nó không được tính vào cổng quyết định (cổng vẫn
 * đóng, bước sau vẫn chạy), mà chỉ được nêu ra kèm lý do.
 */
export type NearMissDoor = {
  value: string;
  /** Từ khoá đã khớp, để người đọc biết vì sao dòng này được nêu. */
  matched: string;
  reason: string;
};

export type ConnectorResult = {
  seedUrl: string;
  domain: string;
  pages: PageReport[];
  channels: FoundChannel[];
  people: FoundPerson[];
  /** Yêu cầu/giấy tờ nhà nhập khẩu công bố đối với nhà cung cấp, kèm câu chữ gốc. */
  requirements: Requirement[];
  /** Sổ đăng ký doanh nghiệp đã đối chiếu — chỉ có khi tra được và có kết quả. */
  registry?: RegistryFinding;
  /** Nhật ký nguồn cấp 2: có chạy không, vì sao, đã hỏi những đâu. */
  secondary?: SecondaryReport;
  /**
   * Những hộp thư "gần đúng" — chỉ có khi **sau tất cả các bước** vẫn chưa tới
   * được cửa mua hàng. Có cửa thật rồi thì danh sách này rỗng: lúc đó nêu thêm
   * chỉ làm loãng thứ đã tìm được.
   */
  reviewHints: NearMissDoor[];
  notes: ConnectorNote[];
  /** Số trang đã tải thực tế. */
  pagesFetched: number;
  /**
   * Tên công ty (do người dùng nhập) có xuất hiện trên một trang đã đọc không.
   * Chỉ có khi lần chạy được đưa tên công ty. `false` = chưa xác nhận được danh
   * tính, **không** phải bằng chứng là sai website.
   */
  identityMatched?: boolean;
  /** Câu mô tả của website, kèm trang đã đọc nó — nội dung gốc, không diễn giải. */
  description?: { text: string; sourceUrl: string };
  /**
   * Lần chạy dừng sớm vì hết thời gian cho phép, và đã dừng ở đâu. Kết quả trả
   * về là phần đã đọc được — người dùng phải được biết nó chưa đầy đủ.
   */
  stoppedEarly?: string;
};

export type TargetFamily = "email" | "phone" | "whatsapp" | "linkedin" | "form";

export type PageExtraction = {
  channels: FoundChannel[];
  people: FoundPerson[];
  requirements: Requirement[];
  notes: ConnectorNote[];
  /** Câu mô tả của chính website (meta description / og:description), nguyên văn. */
  description?: string;
};
