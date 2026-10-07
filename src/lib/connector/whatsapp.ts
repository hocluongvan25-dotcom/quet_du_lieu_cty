import { isE164 } from "./phone";

/**
 * Kiểm một số điện thoại có tài khoản WhatsApp — bằng chính WhatsApp Business
 * của mình, không qua dịch vụ thứ ba.
 *
 * Vì sao chỗ này lại là một câu hỏi mở: On-Premises API từng có `/contacts` để
 * kiểm trước khi gửi; Cloud API bỏ endpoint đó khỏi tài liệu. Báo cáo cộng đồng
 * (02/2026) nói endpoint vẫn trả lời trên Cloud API với `force_check`, nhưng
 * **không có tài liệu chính thức** để dựa vào. Vì vậy module này không tự nhận
 * là biết: nó dựng đúng request để người dùng thử bằng tài khoản thật của họ,
 * và đọc kết quả ở **cả ba** dạng có thể xảy ra.
 *
 * Ba trạng thái, không có trạng thái thứ tư — khớp cột `has_whatsapp` ba giá trị
 * trong database:
 * - `valid`   — Meta trả `status: "valid"` kèm `wa_id`: số có WhatsApp.
 * - `invalid` — Meta trả `status: "invalid"`: đã kiểm và không có.
 * - `unknown` — Meta không kết luận (thiếu trường, trạng thái lạ, endpoint
 *   không trả danh sách). `unknown` **không** được ghi thành `false`:
 *   "chưa kiểm" khác "đã kiểm và không có".
 *
 * Không hàm nào ở đây gửi tin nhắn. Cả hai request đều là câu hỏi.
 */

export const WHATSAPP_GRAPH_VERSION = "v26.0";

export type WhatsappNumberVerdict = "valid" | "invalid" | "unknown";

export type WhatsappNumberCheck = {
  input: string;
  verdict: WhatsappNumberVerdict;
  waId: string | null;
};

export type WhatsappAccount = {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

export type BuiltRequest = { url: string; init: RequestInit };

function assertCredentials(phoneNumberId: string, accessToken: string): void {
  if (!phoneNumberId.trim()) throw new Error("thiếu Phone Number ID");
  if (!accessToken.trim()) throw new Error("thiếu access token");
}

/**
 * Đọc tài khoản đang gọi: số nào, tên gì. Gọi trước khi kiểm để người dùng thấy
 * **đang thử trên số nào** — thử trên số test của Meta khác hẳn thử trên số thật,
 * và nhầm hai thứ đó là cách nhanh nhất để ra kết luận sai.
 */
export function buildWhatsappAccountRequest(
  phoneNumberId: string,
  accessToken: string,
  version: string = WHATSAPP_GRAPH_VERSION,
): BuiltRequest {
  assertCredentials(phoneNumberId, accessToken);
  const fields = "display_phone_number,verified_name";
  return {
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}?fields=${fields}`,
    init: { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
  };
}

export function parseWhatsappAccount(payload: unknown): WhatsappAccount | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const display = body.display_phone_number;
  const name = body.verified_name;
  if (typeof display !== "string" && typeof name !== "string") return null;
  return {
    displayPhoneNumber: typeof display === "string" ? display : null,
    verifiedName: typeof name === "string" ? name : null,
  };
}

/**
 * Dựng request kiểm số. Số phải đã ở dạng E.164 (`+` + mã quốc gia) — hàm này
 * **từ chối** thay vì tự thêm mã quốc gia, vì một mã quốc gia đoán sai không chỉ
 * là dữ liệu xấu: nó hỏi về một người lạ. Chuẩn hoá là việc của `toE164`, có
 * quốc gia của công ty làm căn cứ.
 */
export function buildWhatsappCheckRequest(
  phoneNumberId: string,
  accessToken: string,
  numbers: string[],
  version: string = WHATSAPP_GRAPH_VERSION,
): BuiltRequest {
  assertCredentials(phoneNumberId, accessToken);
  if (numbers.length === 0) throw new Error("không có số nào để kiểm");

  for (const value of numbers) {
    if (!isE164(value)) throw new Error(`không phải số E.164 (cần dạng +84912345678): ${value}`);
  }

  return {
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/contacts`,
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ blocking: "wait", force_check: true, contacts: numbers }),
    },
  };
}

/**
 * Đọc kết quả. Không có danh sách `contacts` trong payload (endpoint không tồn
 * tại, hoặc trả về hình dạng khác) thì trả mảng rỗng — người gọi in ra "không
 * kết luận được", **không** suy thành "không có WhatsApp".
 */
export function parseWhatsappCheck(payload: unknown): WhatsappNumberCheck[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { contacts?: unknown }).contacts;
  if (!Array.isArray(rows)) return [];

  const checks: WhatsappNumberCheck[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const input = typeof item.input === "string" ? item.input : "";
    if (!input) continue;
    const status = typeof item.status === "string" ? item.status : "";
    const waId = typeof item.wa_id === "string" || typeof item.wa_id === "number" ? String(item.wa_id) : null;
    checks.push({
      input,
      verdict: status === "valid" ? "valid" : status === "invalid" ? "invalid" : "unknown",
      waId: status === "valid" ? waId : null,
    });
  }
  return checks;
}

/** Câu mô tả một dòng kết quả, dùng chung cho script kiểm và log của connector. */
export function describeWhatsappCheck(check: WhatsappNumberCheck): string {
  if (check.verdict === "valid") return `${check.input} — có WhatsApp${check.waId ? ` (wa_id ${check.waId})` : ""}`;
  if (check.verdict === "invalid") return `${check.input} — không có tài khoản WhatsApp`;
  return `${check.input} — Meta không kết luận (chưa kiểm được, không phải "không có")`;
}
