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
import type { FoundChannel, NearMissDoor } from "./types";

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

/**
 * Từ khoá "gần đúng": tên hộp thư gợi tới **thứ công ty mua vào**.
 *
 * Cố ý giữ ngắn, và chỉ ở một chỗ. Mỗi từ thêm vào là một lần hệ thống tự cho
 * mình quyền đoán thêm — mà đoán sai ở đây thì đắt: nó biến hộp thư của bộ phận
 * khác thành "cửa vào phòng mua hàng" trong mắt người đọc.
 */
export const NEAR_MISS_WORDS = ["ingredient", "rawmaterial", "raw material", "materials", "nguyen lieu", "nguyenlieu"] as const;

function normalizeMailbox(localPart: string): string {
  return localPart
    .toLowerCase()
    .replace(/[._\-+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tìm những hộp thư "gần đúng" — để **người xem lại**, không phải để mở cổng.
 *
 * Vì sao cần: một báo cáo nói "chưa có kênh nào thuộc nhóm mua hàng" trong khi
 * trên trang có `ingredients@` là một câu đúng nhưng vô dụng. Hộp thư đó có thể
 * là cửa vào bộ phận thu mua, cũng có thể là bộ phận bán nguyên liệu — **tên hộp
 * thư không cho biết**, nên hệ thống không tự quyết: nó nêu ra kèm lý do, người
 * đọc quyết trong một giây.
 *
 * Ba hàng rào, để danh sách này không phình thành nhiễu:
 *  - chỉ xét **email** (số điện thoại và biểu mẫu không có tên hộp thư để đọc);
 *  - bỏ qua kênh gắn với **một người** (đã có tên để tra, không cần "gần đúng");
 *  - bỏ qua kênh **đã thuộc nhóm mua hàng** (đó là cửa thật, không phải gần đúng).
 *
 * Hàm thuần (không I/O) nên kiểm được bằng test, và **không** tham gia vào
 * `coverageOf` — cổng quyết định giữ nguyên như trước.
 */
export function nearMissBuyingDoors(channels: FoundChannel[]): NearMissDoor[] {
  const hints: NearMissDoor[] = [];

  for (const channel of channels) {
    if (channel.type !== "email") continue;
    if (channel.identityMatch === "person") continue;
    if (channelRoles(channel).some(isBuyingRole)) continue;

    const local = normalizeMailbox(channel.value.split("@")[0] ?? "");
    const matched = [...NEAR_MISS_WORDS].filter((word) => local.includes(word)).sort((a, b) => b.length - a.length)[0];
    if (!matched) continue;

    const where = channel.identityMatch === "department" ? "Hộp thư theo bộ phận" : "Hộp thư chung của công ty";
    hints.push({
      value: channel.value,
      matched,
      reason: `${where}, tên chứa "${matched}" — gợi tới nguyên liệu/vật tư, nhưng tên hộp thư không cho biết đó là bộ phận mua hay bộ phận bán. Luật hiện tại không tính là kênh mua hàng, nên để người xem lại.`,
    });
  }

  return hints;
}

/** Lý do đi tiếp, viết cho người đọc nhật ký (không hiện cho người dùng cuối). */
export function secondaryReason(coverage: Coverage): string | undefined {
  if (coverage.enough) return undefined;
  if (coverage.total === 0) return "nguồn cấp 1 không tìm được kênh nào";
  if (coverage.department + coverage.named === 0) return "nguồn cấp 1 chỉ có kênh chung của công ty";
  return "nguồn cấp 1 chưa có kênh nào thuộc nhóm mua hàng";
}
