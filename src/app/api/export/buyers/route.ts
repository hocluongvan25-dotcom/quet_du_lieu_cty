import { loadBuyerList } from "@/lib/data/buyers";
import { buildBuyerCsv, demoBuyerList, filterBuyerList } from "@/lib/data/buyer-view";

export const runtime = "nodejs";

/**
 * Xuất CSV danh sách buyer.
 *
 * Chỉ đọc qua view `outreach_ready_contacts` (đã áp policy) nên không cần lọc lại
 * ở đây: những dòng chưa kiểm mailbox, catch-all, hết hạn hoặc chưa xác nhận đều
 * không nằm trong view. RLS theo session quyết định tenant nào thấy dữ liệu nào.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country")?.trim() ?? "";
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const onlyWithPeople = url.searchParams.get("people") === "1";

  const { state, payload } = await loadBuyerList();
  const source = state === "live" ? payload : demoBuyerList();
  const filtered = filterBuyerList(source, { country, query, onlyWithPeople });

  const csv = buildBuyerCsv(filtered);
  const filename = `seekora-buyers-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-export-rows": String(filtered.contacts.length),
      "x-export-source": state,
    },
  });
}
