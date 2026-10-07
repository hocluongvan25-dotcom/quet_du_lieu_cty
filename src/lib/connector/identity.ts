/**
 * Đối chiếu **tên**: công ty mình đang đọc có đúng là công ty người dùng hỏi?
 *
 * Đây là câu hỏi quan trọng nhất của cả luồng. Mọi bước sau (đọc trang, trích
 * kênh, chấm điểm) đều đúng kỹ thuật kể cả khi mình đang đọc nhầm website — và
 * một report sai công ty nhưng trình bày gọn ghẽ là lỗi tệ nhất có thể có.
 *
 * Cách kiểm ở đây cố tình **dễ dãi và chỉ một chiều**: nó chỉ trả lời "tên có
 * xuất hiện trên trang không". Không xuất hiện **không** có nghĩa là sai công ty
 * (rất nhiều website không nhắc lại tên mình ở mọi trang), nên kết quả `false`
 * chỉ được dùng để **hạ nhãn tin cậy và ghi chú cho người xem lại** — không bao
 * giờ được dùng để khẳng định "sai website".
 */

/** Bỏ dấu tiếng Việt và mọi thứ không phải chữ-số, để so tên qua các cách viết. */
export function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Từ khoá tên công ty dùng để dò: "Sun-Maid Growers Of California" → "sunmaidgrowersofcalifornia". */
export function nameSlug(name: string): string {
  return foldName(name);
}

/**
 * Trang này có nhắc tới tên công ty không?
 *
 * So trên chuỗi đã bỏ dấu và bỏ hết ký tự phân cách, nên "Sun-Maid" khớp
 * "Sun Maid" và "SUNMAID". Bỏ qua tên quá ngắn (< 4 ký tự) vì những tên đó khớp
 * vu vơ ở mọi trang — thà không kết luận còn hơn kết luận sai.
 */
export function mentionsName(pageText: string, name: string): boolean {
  const slug = nameSlug(name);
  if (slug.length < 4) return false;
  const folded = foldName(pageText);
  if (folded.includes(slug)) return true;

  // Tên đầy đủ không có, nhưng **từ đầu** của tên thì có: "Sun-Maid Growers Of
  // California" hiếm khi xuất hiện nguyên văn, trong khi "Sun-Maid" thì có.
  // Chỉ nhận từ đầu **đủ dài** (≥ 6 ký tự): "Vina Ngoc Phat Foodstuff" có từ đầu
  // là "vina", và "vina" nằm trong "vinamilk" — nhận nó là nhận nhầm công ty.
  const firstToken = foldName(name.trim().split(/\s+/)[0] ?? "");
  return firstToken.length >= 6 && folded.includes(firstToken);
}

// --------------------------------------------------- hai tên miền một công ty ---

/**
 * Hai tên miền có phải **cùng một thương hiệu** không?
 *
 * Ca thật: công ty dùng `tysonfoods.com` cho trang doanh nghiệp và `tyson.com`
 * cho trang người tiêu dùng; hộp thư `InternationalInquiry@tyson.com` là của
 * chính công ty đó. So bằng nhau cứng thì hộp thư ấy bị đẩy vào "đã loại trừ",
 * tức là mất đúng cái kênh mà người dùng cần nhất — một lỗi tệ hơn cả việc để
 * lọt một hộp thư ngoài.
 *
 * Hàm này chỉ trả lời câu **hẹp**: hai nhãn tên miền có quan hệ thương hiệu
 * không (một nhãn là tiền tố của nhãn kia, hoặc chứa nhau, và phần chung đủ dài).
 * Nó **không** kết luận "cùng công ty" — kết luận đó phải do một lần đọc trang
 * thật trả lời (xem `siblingDomains` trong index.ts). Quan hệ tên chỉ dùng để
 * quyết định **có đáng bỏ một request ra kiểm không**.
 *
 * `apple.com` và `applebees.com` cũng lọt qua phép thử này — nên nó một mình
 * không bao giờ đủ để nhận một hộp thư.
 */
export function relatedBrand(a: string, b: string): boolean {
  const left = (a.split(".")[0] ?? "").toLowerCase();
  const right = (b.split(".")[0] ?? "").toLowerCase();
  if (!left || !right || left === right) return false;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 4) return false;
  return long.startsWith(short) || long.includes(short);
}

/**
 * Từ của tên công ty, đã bỏ hậu tố pháp lý và từ nối.
 *
 * "Tyson Foods, Inc." → [tyson, foods]. Bỏ "Inc" quan trọng vì hậu tố đó có mặt
 * trong gần như mọi tên miền doanh nghiệp nên nó không phân biệt được gì; còn
 * "foods" mới là chữ phân biệt `tysonfoods.com` với `tyson.com`.
 */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "ltd", "limited",
  "llc", "llp", "lp", "plc", "gmbh", "ag", "sa", "srl", "pvt", "pte", "bv", "nv", "ab", "oy",
  "aps", "spa", "sas", "sl", "kft", "doo", "zrt", "jsc", "pt", "tbk", "bhd", "sdn", "as",
]);

const NAME_STOPWORDS = new Set(["of", "the", "and", "for", "a", "an", "de", "del", "la", "da", "do", "e", "y", "und", "et"]);

export function nameTokens(name: string): string[] {
  const raw = name
    .split(/[\s,./()&]+/)
    .map((part) => foldName(part))
    .filter(Boolean);
  // Chỉ bỏ hậu tố pháp lý ở **cuối** tên: "Corp" ở giữa có thể là tên thật.
  let end = raw.length;
  while (end > 1 && LEGAL_SUFFIXES.has(raw[end - 1])) end -= 1;
  return raw.slice(0, end).filter((token) => token.length >= 2 && !NAME_STOPWORDS.has(token));
}

/**
 * Tên đã bỏ hậu tố pháp lý, **giữ nguyên cách viết gốc** — dùng cho câu truy vấn
 * tìm kiếm: `"Tyson Foods, Inc."` → `Tyson Foods`. Máy tìm kiếm trả kết quả tốt
 * hơn khi không có "Inc.", và trên giao diện thì người dùng vẫn thấy tên đầy đủ.
 */
export function stripLegalSuffix(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  let end = parts.length;
  while (end > 1 && LEGAL_SUFFIXES.has(foldName(parts[end - 1].replace(/[.,]/g, "")))) end -= 1;
  return parts.slice(0, end).join(" ").replace(/[,\s]+$/, "");
}
