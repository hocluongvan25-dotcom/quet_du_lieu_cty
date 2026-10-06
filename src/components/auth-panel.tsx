"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, KeyRound, LoaderCircle, LogIn, Sparkles, UserPlus } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getCopy, type AppLocale } from "@/lib/i18n";

type Mode = "signin" | "signup";

function offlineMessage(locale: AppLocale, raw: string) {
  const copy = getCopy(locale).auth;
  if (/fetch|network|load failed|failed to fetch|ECONNRESET/i.test(raw)) {
    return `${copy.offlineTitle}. ${copy.offlineHint}`;
  }
  return raw;
}

/** Best effort: create the workspace + starter credits on first sign-in. */
async function bootstrapWorkspace(supabase: SupabaseClient, name: string) {
  try {
    await supabase.rpc("bootstrap_workspace", { p_name: name.trim() || null });
  } catch {
    // The dashboard shows an onboarding banner and can retry.
  }
}

export function AuthPanel({
  locale,
  next,
  initialError = "",
}: {
  locale: AppLocale;
  next?: string;
  initialError?: string;
}) {
  const t = getCopy(locale).auth;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  const target = next && next.startsWith("/") ? next : `/${locale}`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError(t.notConfigured);
      return;
    }
    if (!email.includes("@")) {
      setError(t.emailRule);
      return;
    }
    if (password.length < 6) {
      setError(t.passwordRule);
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        await bootstrapWorkspace(supabase, workspaceName || fullName);
        router.replace(target);
        router.refresh();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() || undefined } },
      });
      if (signUpError) throw signUpError;

      if (!data.session) {
        setNotice(t.confirmEmail);
        return;
      }

      await bootstrapWorkspace(supabase, workspaceName || fullName);
      router.replace(target);
      router.refresh();
    } catch (caught) {
      setError(offlineMessage(locale, caught instanceof Error ? caught.message : String(caught)));
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async () => {
    setError("");
    setNotice("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !email.includes("@")) {
      setError(t.emailRule);
      return;
    }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/settings`,
    });
    if (resetError) setError(offlineMessage(locale, resetError.message));
    else setNotice(t.resetSent);
  };

  const isSignIn = mode === "signin";

  return (
    <div className="w-full max-w-[430px] rounded-[24px] border border-[#E8EAF1] bg-white p-6 shadow-[0_18px_50px_rgba(31,38,56,0.08)] sm:p-7">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-[0_8px_20px_rgba(98,83,238,0.25)]" style={{ background: "linear-gradient(135deg, #6157F5 0%, #927BFF 100%)" }}>
          <Sparkles size={18} strokeWidth={2.4} />
        </div>
        <div>
          <p className="text-[15px] font-bold tracking-[-0.03em] text-[#272A39]">Seekora</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#999EAC]">Company Intel</p>
        </div>
      </div>

      <h1 className="mt-6 text-[22px] font-bold tracking-[-0.04em] text-[#282B39]">{t.title}</h1>
      <p className="mt-1.5 text-[12px] text-[#787E8D]">{t.subtitle}</p>

      <div className="mt-5 inline-flex items-center gap-1 rounded-full border border-[#E9EBF2] bg-[#FAFBFC] p-1">
        {(["signin", "signup"] as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError("");
              setNotice("");
            }}
            className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold transition ${mode === value ? "bg-white text-[#5147DD] shadow-sm" : "text-[#858B99] hover:text-[#515665]"}`}
          >
            {value === "signin" ? t.signIn : t.signUp}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-3">
        {!isSignIn ? (
          <>
            <label className="block">
              <span className="text-[11px] font-bold text-[#5F6472]">{t.fullName}</span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder={t.fullNamePlaceholder}
                autoComplete="name"
                className="mt-1.5 h-11 w-full rounded-xl border border-[#E2E5EC] px-3.5 text-[13px] text-[#303342] outline-none transition placeholder:text-[#A9AEB9] focus:border-[#8A7FF0] focus:ring-4 focus:ring-[#EEEAFE]"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-[#5F6472]">{t.workspaceName}</span>
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder={t.workspacePlaceholder}
                className="mt-1.5 h-11 w-full rounded-xl border border-[#E2E5EC] px-3.5 text-[13px] text-[#303342] outline-none transition placeholder:text-[#A9AEB9] focus:border-[#8A7FF0] focus:ring-4 focus:ring-[#EEEAFE]"
              />
            </label>
          </>
        ) : null}

        <label className="block">
          <span className="text-[11px] font-bold text-[#5F6472]">{t.email}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t.emailPlaceholder}
            autoComplete="email"
            className="mt-1.5 h-11 w-full rounded-xl border border-[#E2E5EC] px-3.5 text-[13px] text-[#303342] outline-none transition placeholder:text-[#A9AEB9] focus:border-[#8A7FF0] focus:ring-4 focus:ring-[#EEEAFE]"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-bold text-[#5F6472]">{t.password}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t.passwordHint}
            autoComplete={isSignIn ? "current-password" : "new-password"}
            className="mt-1.5 h-11 w-full rounded-xl border border-[#E2E5EC] px-3.5 text-[13px] text-[#303342] outline-none transition placeholder:text-[#A9AEB9] focus:border-[#8A7FF0] focus:ring-4 focus:ring-[#EEEAFE]"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5D53E8] text-[13px] font-bold text-white shadow-[0_8px_17px_rgba(85,73,218,0.25)] transition hover:bg-[#4E44D7] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : isSignIn ? <LogIn size={16} /> : <UserPlus size={16} />}
          {busy ? t.working : isSignIn ? t.signIn : t.signUp}
        </button>
      </form>

      {error ? <p className="mt-3 rounded-xl bg-[#FFF4F1] px-3 py-2 text-[11px] leading-4 text-[#B4543F]">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-xl bg-[#F0FBF7] px-3 py-2 text-[11px] leading-4 text-[#1F7C61]">{notice}</p> : null}

      <div className="mt-4 flex items-center justify-between text-[11px]">
        <button type="button" onClick={requestReset} className="inline-flex items-center gap-1 font-bold text-[#6257E7] hover:text-[#4339C9]">
          <KeyRound size={12} /> {t.forgotPassword}
        </button>
        <Link href={`/${locale}`} className="inline-flex items-center gap-1 font-bold text-[#6C7280] hover:text-[#3E4350]">
          <ArrowLeft size={12} /> {t.backToDashboard}
        </Link>
      </div>
    </div>
  );
}
