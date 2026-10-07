"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getCopy, normalizeLocale } from "@/lib/i18n";
import { useWorkspace } from "@/components/workspace-provider";

/** Signs the current session out and re-renders the server components. */
export function SignOutButton({ variant = "menu" }: { variant?: "menu" | "icon" }) {
  const params = useParams<{ locale?: string }>();
  const locale = normalizeLocale(params?.locale);
  const t = getCopy(locale);
  const { state } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (state !== "live" && state !== "onboarding") {
    return (
      <a
        href={`/${locale}/login`}
        className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[#5C52E8] transition hover:bg-[#F2F0FF]"
      >
        {t.auth.signIn}
      </a>
    );
  }

  const signOut = async () => {
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase?.auth.signOut();
      router.replace(`/${locale}/login`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        title={t.auth.signOut}
        aria-label={t.auth.signOut}
        className="rounded-lg p-1.5 text-[#8A90A0] transition hover:bg-[#F1F2F5] hover:text-[#4C5260] disabled:opacity-50"
      >
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <LogOut size={15} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-[#6C7280] transition hover:bg-[#F3F4F7] hover:text-[#3E4350] disabled:opacity-50"
    >
      {busy ? <LoaderCircle size={13} className="animate-spin" /> : <LogOut size={13} />}
      {t.auth.signOut}
    </button>
  );
}
