/**
 * In danh sách "gần đúng — người xem lại" cho CLI.
 *
 * Tách khỏi `run-connector.mjs` vì một lý do cụ thể: CLI **không chạy được** trong
 * môi trường không có mạng (lớp an toàn chặn ở bước phân giải DNS), nên nếu phần
 * chữ này nằm trong CLI thì nó là chỗ duy nhất không có test nào chạm tới — mà đây
 * lại đúng là phần người dùng đọc.
 *
 * Hàm thuần: nhận mảng `reviewHints`, trả về các dòng cần in. Rỗng thì trả về
 * mảng rỗng — không có gì để nói thì không in tiêu đề.
 */

export function formatReviewHints(hints) {
  if (!Array.isArray(hints) || hints.length === 0) return [];

  const lines = ["", "GẦN ĐÚNG — NGƯỜI XEM LẠI:"];
  for (const hint of hints) {
    const value = hint?.value ?? "(không rõ)";
    const reason = hint?.reason ?? "(không có lý do kèm theo)";
    lines.push(`  • ${value}`);
    lines.push(`      ${reason}`);
  }
  return lines;
}
