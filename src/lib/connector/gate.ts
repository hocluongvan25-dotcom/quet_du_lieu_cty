/**
 * Cổng quyết định có phải gọi nguồn cấp 2 hay không.
 *
 * Thiết kế nói: đọc nguồn cấp 2 **chỉ khi cần**. "Cần" phải là một điều kiện
 * kiểm được, không phải cảm giác — vì mỗi lượt gọi thêm là một lượt xin dữ liệu
 * của bên khác và một khoản chi phí.
 *
 * Định nghĩa dùng ở đây, và lý do:
 *
 *  - **Đủ rồi** khi đã có ít nhất một kênh thuộc nhóm mua hàng (procurement /
 *    purchasing / sourcing / supply chain). Đó chính là "đúng cửa" mà bước 1
 *    của thiết kế muốn tới. Có rồi thì không đi tiếp.
 *  - **Chưa đủ** trong mọi trường hợp còn lại — kể cả khi đã có email công ty
 *    (`info@…`) hay tổng đài. Kênh chung không phải cửa vào phòng mua hàng;
 *    nếu dừng ở đó thì báo cáo chỉ nhỉnh hơn một lần Google.
 *  - Người có tên nhưng chức danh không thuộc nhóm mua hàng (ví dụ giám đốc
 *    kinh doanh) **không** tính là đủ. Nhưng có tên người thì đáng thử nguồn
 *    cấp 2 hơn — vì có thể tra được chức danh thật của người đó.
 *
 * Hàm ở đây thuần (không I/O), nên kiểm được bằng test mà không cần mạng.
 */

import { classifyRole, isBuyingRole, type RoleKind } from "@/lib/roles";
import type { FoundChannel } from "./types";

export type Coverage = {
  /** Tổng số kênh tìm được ở nguồn cấp 1. */
  total: number;
  /** Số kênh thuộc nhóm mua hàng (title hoặc nhãn cho biết điều đó). */
  buying: number;
  /** Số kênh công bố cạnh tên một người. */
  named: number;
  /** Số kênh là hộp thư/đường dây của bộ phận. */
  department: number;
  /** Số kênh chung của công ty (info@, tổng đài, form liên hệ). */
  companyGeneral: number;
  /** Đã đủ chưa: có cửa vào nhóm mua hàng. */
  enough: boolean;
};

/**
 * Nhóm nghề của một kênh, đọc từ chính chữ đã công bố: chức danh đi kèm, nhãn
 * của kênh, và với email thì cả local part (`procurement@` là chữ công khai trên
 * trang, không phải suy đoán).
 */
export function channelRoles(channel: FoundChannel): RoleKind[] {
  const roles: RoleKind[] = [classifyRole(channel.personTitle, channel.label)];
  if (channel.type === "email") {
    const local = channel.value.split("@")[0];
    if (local) roles.push(classifyRole(local, ""));
  }
  return roles;
}

/** Đo mức phủ của nguồn cấp 1. Thuần, không gọi mạng. */
export function coverageOf(channels: FoundChannel[]): Coverage {
  let buying = 0;
  let named = 0;
  let department = 0;
  let companyGeneral = 0;

  for (const channel of channels) {
    if (channelRoles(channel).some(isBuyingRole)) buying += 1;
    if (channel.identityMatch === "person") named += 1;
    else if (channel.identityMatch === "department") department += 1;
    else if (channel.identityMatch === "company_general") companyGeneral += 1;
  }

  return { total: channels.length, buying, named, department, companyGeneral, enough: buying > 0 };
}

/** Lý do đi tiếp, viết cho người đọc nhật ký (không hiện cho người dùng cuối). */
export function secondaryReason(coverage: Coverage): string | undefined {
  if (coverage.enough) return undefined;
  if (coverage.total === 0) return "nguồn cấp 1 không tìm được kênh nào";
  if (coverage.department + coverage.named === 0) return "nguồn cấp 1 chỉ có kênh chung của công ty";
  return "nguồn cấp 1 chưa có kênh nào thuộc nhóm mua hàng";
}
