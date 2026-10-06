"use client";

import Link from "next/link";
import { Languages } from "lucide-react";
import { useParams, usePathname } from "next/navigation";
import { getCopy, normalizeLocale, type AppLocale } from "@/lib/i18n";

function localePath(pathname: string, target: AppLocale) {
  const pathWithoutLocale = pathname.replace(/^\/(vi|en)(?=\/|$)/, "");
  return `/${target}${pathWithoutLocale || ""}`;
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname() || "/vi";
  const locale = normalizeLocale(params?.locale);
  const t = getCopy(locale);

  return (
    <div className={`inline-flex items-center gap-1 rounded-xl border border-[#E7E9EF] bg-white p-1 ${compact ? "" : "shadow-[0_1px_2px_rgba(20,24,40,0.02)]"}`} aria-label={t.language}>
      {!compact ? <span className="pl-1.5 text-[#7A8090]"><Languages size={15} /></span> : null}
      <Link
        href={localePath(pathname, "vi")}
        aria-label="Tiếng Việt"
        className={`rounded-lg px-2 py-1.5 text-[10px] font-bold transition ${locale === "vi" ? "bg-[#F0EEFF] text-[#5D53E8]" : "text-[#868C9A] hover:bg-[#F5F6F8]"}`}
      >
        VI
      </Link>
      <Link
        href={localePath(pathname, "en")}
        aria-label="English"
        className={`rounded-lg px-2 py-1.5 text-[10px] font-bold transition ${locale === "en" ? "bg-[#F0EEFF] text-[#5D53E8]" : "text-[#868C9A] hover:bg-[#F5F6F8]"}`}
      >
        EN
      </Link>
    </div>
  );
}
