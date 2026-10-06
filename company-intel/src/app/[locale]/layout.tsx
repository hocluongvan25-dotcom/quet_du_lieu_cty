import { notFound } from "next/navigation";
import { LocaleDocument } from "@/components/locale-document";
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

  return <><LocaleDocument />{children}</>;
}
