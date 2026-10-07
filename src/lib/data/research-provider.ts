/**
 * Provider của Company Report trong app — và **giá** của nó.
 *
 * Hiện tại app dùng **provider mẫu** (`createDemoReport`): nội dung là báo cáo
 * minh hoạ, không phải kết quả đọc nguồn công khai. Vì vậy:
 *
 *  - **không tính credits** cho nó — trừ tiền cho một báo cáo chưa research là
 *    nói dối bằng hoá đơn;
 *  - mọi report nó tạo ra mang `sampleData: true`, để UI hiện nhãn cho người đọc;
 *  - phản hồi API nói `dataSource: "demo"` — *lưu* ở đâu là chuyện khác với
 *    *nội dung* lấy từ đâu.
 *
 * Khi nối provider thật (connector + xếp hàng đợi), đổi hằng số dưới đây. Đó là
 * lý do hai thứ này nằm cùng một file, và là lý do `report:test` kiểm chúng: đổi
 * provider mà quên đổi giá thì test đỏ ngay, chứ không âm thầm thu tiền.
 */

export const RESEARCH_PROVIDER = "demo" as const;

/** Giá của một report theo provider. Provider mẫu: 0. */
export function researchCreditCost(provider: string, reportCost: number): number {
  return provider === "demo" ? 0 : reportCost;
}
