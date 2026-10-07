"use client";

import { useState } from "react";
import { AlertTriangle, LoaderCircle, Sparkles, WifiOff } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getCopy, normalizeLocale } from "@/lib/i18n";
import { useWorkspace } from "@/components/workspace-provider";

/**
 * Explains the current data source: demo data, a real Supabase workspace, an
 * unfinished onboarding step, or an unreachable project.
 */
export function WorkspaceNotice({ className = "" }: { className?: string }) {
  const params = useParams<{ locale?: string }>();
  const locale = normalizeLocale(params?.locale);
  const t = getCopy(locale);
  const { state } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (state === "live") return null;

  const tone =
    state === "unavailable"
      ? "border-[#F3D9C8] bg-[#FFF8F3] text-[#8A5220]"
      : state === "onboarding"
        ? "border-[#E3DEFB] bg-[#FAF9FF] text-[#4B428F]"
        : "border-[#E4E7EE] bg-white text-[#5F6472]";

  const createWorkspace = async () => {
    setBusy(true);
    setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error(t.auth.notConfigured);
      const { error: rpcError } = await supabase.rpc("bootstrap_workspace", { p_name: null });
      if (rpcError) throw rpcError;
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 text-[11px] font-medium ${tone} ${className}`}>
      <span className="inline-flex items-center gap-2 font-bold">
        {state === "unavailable" ? <WifiOff size={14} /> : state === "onboarding" ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
        {state === "unavailable" ? t.auth.offlineTitle : state === "onboarding" ? t.auth.onboardingTitle : t.auth.demoTitle}
      </span>
      <span className="text-[11px]">
        {state === "unavailable" ? t.auth.offlineHint : state === "onboarding" ? t.auth.onboardingHint : t.auth.demoHint}
      </span>
      {state === "onboarding" ? (
        <button
          type="button"
          onClick={createWorkspace}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#5D53E8] px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#4E44D7] disabled:opacity-60"
        >
          {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {t.auth.onboardingCta}
        </button>
      ) : null}
      {state === "demo" ? (
        <a href={`/${locale}/login`} className="rounded-lg bg-[#5D53E8] px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#4E44D7]">
          {t.auth.signIn}
        </a>
      ) : null}
      {error ? <span className="text-[11px] text-[#B4543F]">{error}</span> : null}
    </div>
  );
}
