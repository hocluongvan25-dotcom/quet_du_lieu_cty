import { notFound } from "next/navigation";
import { AuthPanel } from "@/components/auth-panel";
import { isAppLocale } from "@/lib/i18n";

export const metadata = {
  title: "Seekora — Sign in",
};

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  const { next, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F6F7FA] px-5 py-10">
      <AuthPanel locale={locale} next={next} initialError={error ?? ""} />
    </main>
  );
}
