"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { normalizeLocale } from "@/lib/i18n";

export function LocaleDocument() {
  const params = useParams<{ locale?: string }>();
  const locale = normalizeLocale(params?.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
