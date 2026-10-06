/**
 * Từ khoá chức danh để TÌM người liên quan, theo ngành của khách hàng.
 *
 * Đây là dữ liệu đầu vào cho connector (dùng để tra cứu), không phải nội dung
 * hiển thị. Hệ thống chỉ tìm và ghi nguồn; việc chọn ai và liên hệ thế nào là
 * việc của người dùng.
 */

export type SectorKey = "agri" | "processed_food" | "textile";

/** Chức danh phía người mua, theo thứ tự ưu tiên tìm kiếm chung. */
export const BUYER_ROLE_TERMS: Record<SectorKey, string[]> = {
  agri: ["procurement", "purchasing", "sourcing", "commodity buyer", "quality assurance", "food safety", "import manager"],
  processed_food: ["purchasing", "buying", "category manager", "product development", "quality assurance", "supply chain", "import"],
  textile: ["sourcing", "vendor management", "merchandising", "production", "compliance", "quality assurance", "material sourcing"],
};

/** Chức danh riêng của người bán (để loại khỏi kết quả khi người dùng cần đầu mối mua). */
export const SELLER_SIDE_ROLE_TERMS = ["sales", "account executive", "business development", "marketing", "customer service"];

export const SECTORS: { key: SectorKey; label: string }[] = [
  { key: "agri", label: "Nông sản" },
  { key: "processed_food", label: "Thực phẩm chế biến" },
  { key: "textile", label: "Dệt may" },
];

export function roleTermsFor(sector: SectorKey): string[] {
  return BUYER_ROLE_TERMS[sector] ?? [];
}
