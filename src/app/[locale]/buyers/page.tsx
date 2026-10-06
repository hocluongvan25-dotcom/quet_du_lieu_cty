import { BuyersPage } from "@/components/buyers-page";
import { loadBuyerList } from "@/lib/data/buyers";
import { normalizeLocale } from "@/lib/i18n";

export default async function BuyersRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = normalizeLocale(rawLocale);
  const { state, payload } = await loadBuyerList();

  return <BuyersPage locale={locale} buyers={payload.buyers} contacts={payload.contacts} live={state === "live"} />;
}
