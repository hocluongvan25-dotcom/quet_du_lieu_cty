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
