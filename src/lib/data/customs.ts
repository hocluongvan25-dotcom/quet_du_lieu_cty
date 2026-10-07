import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  CUSTOMS_QUEUE_COLUMNS,
  CUSTOMS_ROLE_COLUMNS,
  CUSTOMS_SUMMARY_COLUMNS,
  toBuyerCustomsByBuyer,
  toCustomsQueueItem,
  type BuyerCustomsRow,
  type CustomsQueueItem,
  type CustomsRoleDbRow,
  type CustomsSummaryDbRow,
} from "@/lib/customs/view";
import type { CustomsQueueRow } from "@/lib/customs/types";

/**
 * Đọc dữ liệu hải quan cho giao diện.
 *
 * Cả hai view đều `security_invoker`, nên RLS của workspace quyết định dữ liệu
 * nào hiện ra — lớp này không tự lọc thay DB. Chưa chạy migration 012 thì truy
 * vấn trả lỗi và hai hàm dưới trả rỗng: trang vẫn chạy như trước, chỉ thiếu khối
 * hải quan.
 */

export async function loadBuyerCustoms(): Promise<Map<string, BuyerCustomsRow>> {
  if (!getSupabasePublicConfig()) return new Map();
  const supabase = await getSupabaseServerClient();
  if (!supabase) return new Map();

  try {
    const { data: summaryData, error } = await supabase.from("buyer_customs_summary").select(CUSTOMS_SUMMARY_COLUMNS).limit(2000);
    if (error) return new Map();
    const { data: roleData } = await supabase.from("buyer_customs_roles").select(CUSTOMS_ROLE_COLUMNS).limit(2000);
    return toBuyerCustomsByBuyer(
      (summaryData ?? []) as unknown as CustomsSummaryDbRow[],
      (roleData ?? []) as unknown as CustomsRoleDbRow[],
    );
  } catch {
    return new Map();
  }
}

/**
 * Hàng đợi xem xét: các bên nhận hàng trên tờ khai chưa nối với hồ sơ khách hàng
 * nào. Đây là chỗ bước 2 của luồng Resolve bắt đầu.
 */
export async function loadCustomsQueue(limit = 50): Promise<CustomsQueueItem[]> {
  if (!getSupabasePublicConfig()) return [];
  const supabase = await getSupabaseServerClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from("customs_resolution_queue")
      .select(CUSTOMS_QUEUE_COLUMNS)
      .order("shipment_date", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as unknown as CustomsQueueRow[]).map(toCustomsQueueItem);
  } catch {
    return [];
  }
}
