import { BuyersPage } from "@/components/buyers-page";
import { loadBuyerList } from "@/lib/data/buyers";
import { demoCustomsQueue } from "@/lib/data/buyer-view";
import { loadCustomsQueue } from "@/lib/data/customs";
import { normalizeLocale } from "@/lib/i18n";

export default async function BuyersRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = normalizeLocale(rawLocale);
  const { state, payload } = await loadBuyerList();
  // Chạy thật thì hàng đợi đọc từ view; chế độ mẫu dùng hai dòng ví dụ để thấy
  // luồng Resolve trông thế nào — có ghi chú rõ đây là dữ liệu mẫu.
  const queue = state === "live" ? await loadCustomsQueue() : demoCustomsQueue();

  return (
    <BuyersPage
      locale={locale}
      buyers={payload.buyers}
      contacts={payload.contacts}
      queue={queue}
      live={state === "live"}
    />
  );
}
