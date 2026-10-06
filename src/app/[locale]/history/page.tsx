import { notFound } from "next/navigation";
import { HistoryPage } from "@/components/history-page";
import { loadReportChanges } from "@/lib/data/workspace";
import { isAppLocale } from "@/lib/i18n";

export default async function HistoryRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();

  const changes = await loadReportChanges(locale);

  return <HistoryPage locale={locale} changes={changes.data} live={changes.available} />;
}
