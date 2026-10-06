import { notFound } from "next/navigation";
import { LocaleDocument } from "@/components/locale-document";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { loadWorkspace } from "@/lib/data/workspace";
import { isAppLocale, locales } from "@/lib/i18n";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isAppLocale(locale)) notFound();

  // Loaded once per request and shared with every client component below.
  const workspace = await loadWorkspace(locale);

  return (
    <WorkspaceProvider value={workspace}>
      <LocaleDocument />
      {children}
    </WorkspaceProvider>
  );
}
