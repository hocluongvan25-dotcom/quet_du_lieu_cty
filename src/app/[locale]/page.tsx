import { IntelligenceDashboard } from "@/components/intelligence-dashboard";
import { loadWorkspace } from "@/lib/data/workspace";
import { isAppLocale } from "@/lib/i18n";

export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const workspace = await loadWorkspace(isAppLocale(locale) ? locale : "vi");

  return <IntelligenceDashboard workspace={workspace} />;
}
