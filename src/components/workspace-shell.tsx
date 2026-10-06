"use client";

import Link from "next/link";
import { ReactNode } from "react";
import {
  Archive,
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CreditCard,
  FileSearch,
  History,
  LayoutDashboard,
  Menu,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceNotice } from "@/components/workspace-notice";
import { useWorkspace } from "@/components/workspace-provider";
import { DEMO_CREDITS } from "@/lib/data/workspace-types";
import { getCopy, normalizeLocale } from "@/lib/i18n";
import { useParams } from "next/navigation";

type WorkspaceNavKey = "overview" | "reports" | "buyers" | "archive" | "history" | "team" | "billing" | "settings";

type WorkspaceShellProps = {
  children: ReactNode;
  active: WorkspaceNavKey;
};

const gradient = "linear-gradient(135deg, #6157F5 0%, #927BFF 100%)";

export function WorkspaceShell({ children, active }: WorkspaceShellProps) {
  const params = useParams<{ locale?: string }>();
  const locale = normalizeLocale(params?.locale);
  const t = getCopy(locale);
  const prefix = `/${locale}`;
  const workspace = useWorkspace();
  const account = workspace.account;
  const credits = account?.credits ?? DEMO_CREDITS;

  const primary: Array<{ key: WorkspaceNavKey; icon: typeof LayoutDashboard; href: string }> = [
    { key: "overview", icon: LayoutDashboard, href: prefix },
    { key: "reports", icon: FileSearch, href: `${prefix}/reports` },
    { key: "buyers", icon: Building2, href: `${prefix}/buyers` },
    { key: "archive", icon: Archive, href: `${prefix}/archive` },
    { key: "history", icon: History, href: `${prefix}/history` },
  ];
  const secondary: Array<{ key: WorkspaceNavKey; icon: typeof LayoutDashboard; href: string }> = [
    { key: "team", icon: Users, href: `${prefix}/team` },
    { key: "billing", icon: CreditCard, href: `${prefix}/billing` },
    { key: "settings", icon: Settings2, href: `${prefix}/settings` },
  ];

  const navItem = (item: { key: WorkspaceNavKey; icon: typeof LayoutDashboard; href: string }) => {
    const Icon = item.icon;
    const isActive = item.key === active;
    return (
      <Link
        key={item.key}
        href={item.href}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${isActive ? "bg-[#F0EEFF] text-[#5C52E8]" : "text-[#5F6472] hover:bg-[#F6F7FA] hover:text-[#242737]"}`}
      >
        <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
        <span className="flex-1">{t.nav[item.key]}</span>
        {item.key === "reports" ? <span className="rounded-full bg-[#E8E5FF] px-2 py-0.5 text-[10px] font-bold text-[#5C52E8]">3</span> : null}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-[#F6F7FA] text-[#232634]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-[#EAECF1] bg-white px-4 py-5 lg:flex">
        <Link href={prefix} className="mb-8 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-[0_8px_20px_rgba(98,83,238,0.25)]" style={{ background: gradient }}><Sparkles size={18} strokeWidth={2.4} /></div>
          <div><p className="text-[16px] font-bold tracking-[-0.03em] text-[#272A39]">Seekora</p><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#999EAC]">Company Intel</p></div>
        </Link>

        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A3A8B5]">{t.workspace}</div>
        <nav className="space-y-1">{primary.map(navItem)}</nav>
        <div className="mb-2 mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A3A8B5]">{locale === "vi" ? "Quản lý" : "Manage"}</div>
        <nav className="space-y-1">{secondary.map(navItem)}</nav>

        <div className="mt-auto rounded-2xl border border-[#E9E6FF] bg-[#FAF9FF] p-3.5">
          <div className="mb-2.5 flex items-center gap-2 text-[#5F55D8]"><ShieldCheck size={17} /><span className="text-[12px] font-bold">{locale === "vi" ? "Privacy by default" : "Privacy by default"}</span></div>
          <p className="text-[11px] leading-4 text-[#73708F]">{locale === "vi" ? "Raw sources tự xoá sau 30 ngày trên gói Starter." : "Raw sources are deleted after 30 days on the Starter plan."}</p>
          <Link href={`${prefix}/archive`} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#5C52E8] hover:text-[#4339C9]">{locale === "vi" ? "Xem kho lưu trữ" : "View archive"}<ChevronRight size={13} /></Link>
        </div>

        <div className="mt-4 flex items-center gap-2.5 rounded-xl px-2 py-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#DFF4F0] text-[11px] font-bold text-[#218A72]">{account?.initials ?? "AN"}</div><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold text-[#343747]">{account?.displayName ?? (locale === "vi" ? "Khách demo" : "Demo guest")}</p><p className="truncate text-[10px] text-[#8A90A0]">{account ? `${account.plan} · ${account.organizationName}` : t.starter}</p></div><ChevronDown size={15} className="text-[#989DAC]" /></div>
      </aside>

      <main className="min-h-screen lg:pl-[252px]">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-[#E9EBF0] bg-white/90 px-5 backdrop-blur-xl sm:px-7 lg:px-9">
          <div className="flex items-center gap-3"><button type="button" className="rounded-lg p-2 text-[#606576] hover:bg-[#F4F5F7] lg:hidden" aria-label="Menu"><Menu size={20} /></button><div><div className="flex items-center gap-1.5 text-[11px] font-medium text-[#969BA9]"><span>{t.workspace}</span><ChevronRight size={12} /><span className="text-[#525766]">{t.nav[active]}</span></div><p className="mt-0.5 text-[13px] font-semibold text-[#363A49]">Research workspace</p></div></div>
          <div className="flex items-center gap-2 sm:gap-3"><button type="button" className="hidden rounded-xl border border-[#E7E9EF] bg-white px-3 py-2 text-[12px] font-semibold text-[#5F6471] sm:inline-flex"><CircleHelp size={15} className="mr-1.5" />{t.help}</button><LanguageSwitcher /><button type="button" className="relative rounded-xl p-2.5 text-[#656B79] transition hover:bg-[#F3F4F7]" aria-label="Notifications"><Bell size={19} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#755EF7] ring-2 ring-white" /></button><Link href={`${prefix}/billing`} className="inline-flex items-center gap-2 rounded-xl border border-[#E8E5FF] bg-[#FAF9FF] px-3 py-2 text-[12px] font-bold text-[#5C52E8] transition hover:bg-[#F3F1FF]"><Sparkles size={15} fill="currentColor" /><span className="hidden sm:inline">{credits} credits</span><span className="sm:hidden">{credits}</span></Link><SignOutButton /></div>
        </header>
        {workspace.state === "live" ? null : (
          <div className="mx-auto max-w-[1460px] px-5 pt-5 sm:px-7 lg:px-9">
            <WorkspaceNotice />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
