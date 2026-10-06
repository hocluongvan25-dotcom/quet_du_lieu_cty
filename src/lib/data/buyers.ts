import { cache } from "react";

import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchWorkspaceAccount } from "./workspace";
import {
  BUYER_CONTACT_COLUMNS,
  BUYER_SUMMARY_COLUMNS,
  demoBuyerList,
  toBuyerList,
  type BuyerContactDbRow,
  type BuyerListPayload,
  type BuyerSummaryDbRow,
} from "./buyer-view";

export type {
  BuyerContactDbRow,
  BuyerContactRow,
  BuyerFilters,
  BuyerListPayload,
  BuyerListRow,
  BuyerSummaryDbRow,
} from "./buyer-view";
export { buildBuyerCsv, csvCell, CSV_COLUMNS, demoBuyerList, filterBuyerList, toBuyerList } from "./buyer-view";

/**
 * Loader phía server cho danh sách buyer.
 *
 * Đọc qua session của người dùng nên RLS quyết định dữ liệu nào hiện ra. Thiếu
 * cấu hình hoặc không gọi được project thì rơi về dữ liệu mẫu, không làm vỡ trang.
 */

export type BuyerListResult = {
  state: "live" | "demo" | "empty";
  payload: BuyerListPayload;
};

export const loadBuyerList = cache(async (): Promise<BuyerListResult> => {
  if (!getSupabasePublicConfig()) return { state: "demo", payload: demoBuyerList() };

  const supabase = await getSupabaseServerClient();
  if (!supabase) return { state: "demo", payload: demoBuyerList() };

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return { state: "demo", payload: demoBuyerList() };

    const account = await fetchWorkspaceAccount(supabase, userData.user);
    if (!account) return { state: "demo", payload: demoBuyerList() };

    const { data: summaryData, error: summaryError } = await supabase
      .from("buyer_outreach_summary")
      .select(BUYER_SUMMARY_COLUMNS)
      .order("last_signal_at", { ascending: false, nullsFirst: false })
      .limit(500);

    if (summaryError) throw new Error(summaryError.message);

    const summaryRows = (summaryData ?? []) as unknown as BuyerSummaryDbRow[];
    if (summaryRows.length === 0) return { state: "empty", payload: { buyers: [], contacts: [] } };

    const { data: contactData, error: contactError } = await supabase
      .from("outreach_ready_contacts")
      .select(BUYER_CONTACT_COLUMNS)
      .limit(2000);

    if (contactError) throw new Error(contactError.message);

    const { data: withheldData, error: withheldError } = await supabase
      .from("contact_export_policy")
      .select("buyer_profile_id")
      .eq("exportable", false)
      .limit(2000);

    if (withheldError) throw new Error(withheldError.message);

    const withheldByBuyer = new Map<string, number>();
    ((withheldData ?? []) as unknown as { buyer_profile_id: string }[]).forEach((row) => {
      withheldByBuyer.set(row.buyer_profile_id, (withheldByBuyer.get(row.buyer_profile_id) ?? 0) + 1);
    });

    return {
      state: "live",
      payload: toBuyerList(summaryRows, (contactData ?? []) as unknown as BuyerContactDbRow[], withheldByBuyer),
    };
  } catch {
    return { state: "demo", payload: demoBuyerList() };
  }
});
