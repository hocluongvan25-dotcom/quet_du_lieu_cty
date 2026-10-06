"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleCheckBig,
  Clock3,
  Copy,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  Globe2,
  History,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Mail,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { CompanyReport, Contact, initialReports } from "@/lib/demo-data";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceNotice } from "@/components/workspace-notice";
import { IntelNotesPanel, PeoplePanel, ProvenanceBadge } from "@/components/contact-intel";
import { TargetRolesPanel } from "@/components/target-roles-panel";
import { DEMO_CREDITS, REPORT_COST, type WorkspaceSnapshot } from "@/lib/data/workspace-types";
import { getCopy, normalizeLocale, type AppLocale } from "@/lib/i18n";

type SearchMode = "name" | "link";

type NavItemProps = {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  badge?: string;
  href?: string;
  onClick?: () => void;
};

const creditGradient = "linear-gradient(135deg, #6157F5 0%, #927BFF 100%)";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function reportSummaryForClipboard(report: CompanyReport, locale: AppLocale) {
  const isVietnamese = locale === "vi";
  const verifiedContacts = report.contacts.filter((contact) => contact.verified);
  const lines = [
    `${isVietnamese ? "CÔNG TY" : "COMPANY"}: ${report.companyName}`,
    `${isVietnamese ? "Quốc gia" : "Country"}: ${report.country}`,
    `${isVietnamese ? "Ngành" : "Industry"}: ${report.industry}`,
    `${isVietnamese ? "Độ tin cậy" : "Confidence"}: ${report.confidence}/100`,
    report.website ? `${isVietnamese ? "Website" : "Website"}: ${report.website}` : "",
    "",
    `${isVietnamese ? "KÊNH KINH DOANH ĐÃ XÁC MINH" : "VERIFIED BUSINESS CHANNELS"}:`,
    ...verifiedContacts.map((contact) => `• ${contact.label}: ${contact.value}`),
    "",
    ...(report.people?.length
      ? [
          "",
          `${isVietnamese ? "ĐẦU MỐI LIÊN HỆ" : "CONTACTS"}:`,
          ...report.people.map(
            (person) => `• #${person.rank} ${person.name} — ${person.title} · ${person.channels.map((channel) => channel.value).join(", ")}`,
          ),
        ]
      : []),
    ...(report.notes?.length ? ["", `${isVietnamese ? "GHI CHÚ" : "NOTES"}:`, ...report.notes.map((note) => `• ${note.label}`)] : []),
    "",
    `${isVietnamese ? "NGUỒN" : "SOURCES"}:`,
    ...report.sources.map((source) => `• ${source.label}: ${source.url}`),
    "",
    `${isVietnamese ? "Snapshot" : "Snapshot"}: ${report.lastUpdated} · ${isVietnamese ? "lưu đến" : "stored until"} ${report.expiresAt}`,
  ];

  return lines.filter(Boolean).join("\n");
}

function NavItem({ icon: Icon, label, active = false, badge, href, onClick }: NavItemProps) {
  const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
    active
      ? "bg-[#F0EEFF] text-[#5C52E8]"
      : "text-[#5F6472] hover:bg-[#F6F7FA] hover:text-[#242737]"
  }`;
  const content = <><Icon size={18} strokeWidth={active ? 2.2 : 1.8} /><span className="flex-1">{label}</span>{badge ? <span className="rounded-full bg-[#E8E5FF] px-2 py-0.5 text-[10px] font-bold text-[#5C52E8]">{badge}</span> : null}</>;

  if (href) return <Link href={href} className={className}>{content}</Link>;

  return <button type="button" onClick={onClick} className={className}>{content}</button>;
}

function Avatar({ report, size = "md" }: { report: CompanyReport; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "h-9 w-9 text-[11px]" : size === "lg" ? "h-12 w-12 text-sm" : "h-10 w-10 text-xs";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl font-bold tracking-tight ${sizeClass}`}
      style={{ backgroundColor: `${report.accent}18`, color: report.accent }}
    >
      {report.initials}
    </span>
  );
}

function StatusPill({ status, locale }: { status: CompanyReport["status"]; locale: AppLocale }) {
  const labels = getCopy(locale).status;
  if (status === "ready") {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EAF8F3] px-2.5 py-1 text-[11px] font-semibold text-[#168466]"><span className="h-1.5 w-1.5 rounded-full bg-[#22AD86]" /> {labels.ready}</span>;
  }

  if (status === "researching") {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[11px] font-semibold text-[#4B6DE3]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5D77E5]" /> {labels.researching}</span>;
  }

  return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF4E5] px-2.5 py-1 text-[11px] font-semibold text-[#C47A16]"><span className="h-1.5 w-1.5 rounded-full bg-[#E49B31]" /> {labels.review}</span>;
}

function ContactIcon({ type }: { type: Contact["type"] }) {
  const className = "text-[#737889]";
  if (type === "email") return <Mail size={17} className={className} />;
  if (type === "phone") return <Phone size={17} className={className} />;
  if (type === "linkedin") return <BriefcaseBusiness size={17} className={className} />;
  if (type === "whatsapp") return <MessageCircle size={17} className={className} />;
  return <Globe2 size={17} className={className} />;
}

export function IntelligenceDashboard({ workspace }: { workspace: WorkspaceSnapshot }) {
  const params = useParams<{ locale?: string }>();
  const locale = normalizeLocale(params?.locale);
  const t = getCopy(locale);
  const prefix = `/${locale}`;
  const router = useRouter();
  const isLive = workspace.state === "live" && workspace.account !== null;
  const account = workspace.account;
  const displayName = account?.displayName ?? (locale === "vi" ? "bạn" : "there");
  // The server snapshot is the source of truth; local state only holds what
  // this session created or spent before the router refresh lands.
  const [createdReports, setCreatedReports] = useState<CompanyReport[]>([]);
  const [demoCreditsUsed, setDemoCreditsUsed] = useState(0);
  const baseReports = isLive ? workspace.reports : initialReports;
  const baseCredits = account?.credits ?? DEMO_CREDITS;
  const credits = isLive ? baseCredits : Math.max(0, baseCredits - demoCreditsUsed);
  const reports = useMemo(() => {
    const known = new Set(baseReports.map((report) => report.id));
    return [...createdReports.filter((report) => !known.has(report.id)), ...baseReports];
  }, [baseReports, createdReports]);
  const [mode, setMode] = useState<SearchMode>("name");
  const [companyName, setCompanyName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [country, setCountry] = useState("global");
  const [selectedReport, setSelectedReport] = useState<CompanyReport | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showWallet, setShowWallet] = useState(false);
  const [toast, setToast] = useState("");
  const [formError, setFormError] = useState("");

  const readyCount = useMemo(() => reports.filter((report) => report.status === "ready").length, [reports]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await writeToClipboard(value);
      notify(`${t.common.copied}: ${label}`);
    } catch {
      notify(locale === "vi" ? "Không thể sao chép vào clipboard. Hãy thử lại." : "Could not copy to your clipboard. Please try again.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hasInput = mode === "name" ? Boolean(companyName.trim()) : Boolean(sourceUrl.trim());

    if (!hasInput) {
      setFormError(mode === "name" ? t.dashboard.notFoundName : t.dashboard.notFoundLink);
      return;
    }

    if (credits < REPORT_COST) {
      setFormError(t.dashboard.insufficientCredits);
      return;
    }

    setFormError("");
    setIsResearching(true);
    setProgress(12);

    try {
      const responsePromise = fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: mode === "name" ? companyName : "",
          sourceUrl: mode === "link" ? sourceUrl : "",
          country: country === "global" ? "" : country,
          locale,
        }),
      });

      await sleep(450);
      setProgress(36);
      await sleep(500);
      setProgress(68);

      const response = await responsePromise;
      const result = (await response.json()) as {
        report?: CompanyReport;
        error?: string;
        creditsCharged?: number;
        creditsRemaining?: number;
      };

      if (!response.ok || !result.report) throw new Error(result.error || "Không thể tạo report lúc này.");

      await sleep(450);
      setProgress(91);
      await sleep(350);
      setCreatedReports((current) => [result.report as CompanyReport, ...current]);
      setSelectedReport(result.report);
      setCompanyName("");
      setSourceUrl("");
      notify(t.dashboard.completed);
      if (isLive) {
        // Re-read the workspace so credits, report ids and evidence are the
        // stored rows instead of the optimistic client state.
        router.refresh();
      } else {
        setDemoCreditsUsed((current) => current + (result.creditsCharged ?? REPORT_COST));
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Đã có lỗi xảy ra. Hãy thử lại.");
    } finally {
      setIsResearching(false);
      setProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7FA] text-[#232634]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-[#EAECF1] bg-white px-4 py-5 lg:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-[0_8px_20px_rgba(98,83,238,0.25)]" style={{ background: creditGradient }}>
            <Sparkles size={18} strokeWidth={2.4} />
          </div>
          <div>
            <p className="text-[16px] font-bold tracking-[-0.03em] text-[#272A39]">Seekora</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#999EAC]">Company Intel</p>
          </div>
        </div>

        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A3A8B5]">{t.workspace}</div>
        <nav className="space-y-1">
          <NavItem icon={LayoutDashboard} label={t.nav.overview} active href={prefix} />
          <NavItem icon={FileSearch} label={t.nav.reports} badge={String(readyCount)} href={`${prefix}/reports`} />
          <NavItem icon={Archive} label={t.nav.archive} href={`${prefix}/archive`} />
          <NavItem icon={History} label={t.nav.history} href={`${prefix}/history`} />
        </nav>

        <div className="mb-2 mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A3A8B5]">{locale === "vi" ? "Quản lý" : "Manage"}</div>
        <nav className="space-y-1">
          <NavItem icon={Users} label={t.nav.team} href={`${prefix}/team`} />
          <NavItem icon={CreditCard} label={t.nav.billing} href={`${prefix}/billing`} />
          <NavItem icon={Settings2} label={t.nav.settings} href={`${prefix}/settings`} />
        </nav>

        <div className="mt-auto rounded-2xl border border-[#E9E6FF] bg-[#FAF9FF] p-3.5">
          <div className="mb-2.5 flex items-center gap-2 text-[#5F55D8]">
            <ShieldCheck size={17} />
            <span className="text-[12px] font-bold">Privacy by default</span>
          </div>
          <p className="text-[11px] leading-4 text-[#73708F]">{locale === "vi" ? "Raw sources tự xoá sau 30 ngày trên gói Starter." : "Raw sources are removed after 30 days on the Starter plan."}</p>
          <Link href={`${prefix}/archive`} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#5C52E8] hover:text-[#4339C9]">
            {locale === "vi" ? "Xem kho lưu trữ" : "View archive"} <ArrowUpRight size={13} />
          </Link>
        </div>

        <div className="mt-4 flex items-center gap-2.5 rounded-xl px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#DFF4F0] text-[11px] font-bold text-[#218A72]">{account?.initials ?? "AN"}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold text-[#343747]">{account?.displayName ?? (locale === "vi" ? "Khách demo" : "Demo guest")}</p>
            <p className="truncate text-[10px] text-[#8A90A0]">{account ? `${account.plan} · ${account.organizationName}` : t.starter}</p>
          </div>
          <SignOutButton variant="icon" />
        </div>
      </aside>

      <main className="min-h-screen lg:pl-[252px]">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-[#E9EBF0] bg-white/90 px-5 backdrop-blur-xl sm:px-7 lg:px-9">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-lg p-2 text-[#606576] hover:bg-[#F4F5F7] lg:hidden" onClick={() => notify("Menu đầy đủ hiển thị trên màn hình lớn.")}>
              <Menu size={20} />
            </button>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#969BA9]">
                <span>{t.workspace}</span>
                <ChevronRight size={12} />
                <span className="text-[#525766]">{t.nav.overview}</span>
              </div>
              <p className="mt-0.5 text-[13px] font-semibold text-[#363A49]">Research workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" className="hidden rounded-xl border border-[#E7E9EF] bg-white px-3 py-2 text-[12px] font-semibold text-[#5F6471] transition hover:border-[#D7DAE3] hover:bg-[#FAFBFC] sm:inline-flex" onClick={() => notify(locale === "vi" ? "Trung tâm trợ giúp sẽ sớm có mặt." : "The help centre is coming soon.")}>
              <CircleHelp size={15} className="mr-1.5" /> {t.help}
            </button>
            <LanguageSwitcher />
            <SignOutButton />
            <button type="button" className="relative rounded-xl p-2.5 text-[#656B79] transition hover:bg-[#F3F4F7]" onClick={() => notify("Bạn đang không có thông báo mới.")} aria-label="Thông báo">
              <Bell size={19} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#755EF7] ring-2 ring-white" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowWallet((visible) => !visible)}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E8E5FF] bg-[#FAF9FF] px-3 py-2 text-[12px] font-bold text-[#5C52E8] transition hover:bg-[#F3F1FF]"
              >
                <Sparkles size={15} fill="currentColor" />
                <span className="hidden sm:inline">{credits} credits</span>
                <span className="sm:hidden">{credits}</span>
              </button>
              {showWallet ? (
                <div className="absolute right-0 top-[46px] z-40 w-64 rounded-2xl border border-[#E8EAF0] bg-white p-4 shadow-[0_16px_45px_rgba(26,31,45,0.14)]">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-semibold text-[#8B90A0]">{t.dashboard.credits}</p>
                      <p className="mt-1 text-2xl font-bold tracking-[-0.04em] text-[#282B3A]">{credits} <span className="text-sm font-semibold">credits</span></p>
                    </div>
                    <div className="rounded-lg bg-[#F0EEFF] p-2 text-[#6558E8]"><Sparkles size={16} /></div>
                  </div>
                  <div className="mt-3 rounded-xl bg-[#F8F9FB] px-3 py-2 text-[11px] leading-4 text-[#777D8D]">{locale === "vi" ? `1 Company Report tiêu chuẩn sử dụng ${REPORT_COST} credits.` : `One standard Company Report uses ${REPORT_COST} credits.`}</div>
                  <button type="button" onClick={() => { setShowWallet(false); notify(locale === "vi" ? "Trang nạp credits sẽ sớm có mặt." : "Credit top-up will be available soon."); }} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#5E54E8] px-3 py-2.5 text-[12px] font-bold text-white hover:bg-[#5147D9]">
                    <Plus size={14} /> {locale === "vi" ? "Nạp credits" : "Add credits"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1460px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9">
          <WorkspaceNotice className="mb-5" />

          <section className="mb-7 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#ECEAFF] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6257E7]">{t.dashboard.eyebrow}</span>
                <span className="text-[11px] font-medium text-[#8B90A0]">{t.dashboard.dataClear}</span>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isLive ? "bg-[#EAF8F3] text-[#168466]" : "bg-[#F1F2F5] text-[#6C7280]"}`}>
                  {isLive ? t.dashboard.liveData : t.dashboard.demoFallback}
                </span>
              </div>
              <h1 className="text-[25px] font-bold tracking-[-0.045em] text-[#252837] sm:text-[30px]">{t.dashboard.greeting.replace("{name}", displayName)}</h1>
              <p className="mt-1.5 text-[13px] text-[#747A8A]">{t.dashboard.subtitle}</p>
            </div>
            <button type="button" onClick={() => notify(locale === "vi" ? "Bạn có thể nhập tên công ty hoặc dán một link ở ô bên dưới." : "Enter a company name or paste a public company link below.")} className="inline-flex w-fit items-center gap-2 text-[12px] font-semibold text-[#5C52E8] hover:text-[#4438D4]">
              {t.dashboard.howItWorks} <CircleHelp size={15} />
            </button>
          </section>

          <section className="relative overflow-hidden rounded-[22px] border border-[#E8E6FA] bg-white p-5 shadow-[0_13px_35px_rgba(38,36,87,0.045)] sm:p-6">
            <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-[#F0EDFF] blur-3xl" />
            <div className="relative">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F0EEFF] text-[#6257EA]"><Sparkles size={15} /></div>
                    <h2 className="text-[15px] font-bold text-[#303342]">{t.dashboard.createReport}</h2>
                  </div>
                  <p className="mt-1.5 text-[12px] text-[#7D8291]">{t.dashboard.createDescription}</p>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full border border-[#E9EBF2] bg-[#FAFBFC] p-1">
                  <button type="button" onClick={() => { setMode("name"); setFormError(""); }} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${mode === "name" ? "bg-white text-[#5147DD] shadow-sm" : "text-[#858B99] hover:text-[#515665]"}`}>
                    {t.dashboard.byName}
                  </button>
                  <button type="button" onClick={() => { setMode("link"); setFormError(""); }} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${mode === "link" ? "bg-white text-[#5147DD] shadow-sm" : "text-[#858B99] hover:text-[#515665]"}`}>
                    {t.dashboard.byLink}
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                <div className="relative">
                  {mode === "name" ? <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9DA2AF]" /> : <Link2 size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9DA2AF]" />}
                  <input
                    value={mode === "name" ? companyName : sourceUrl}
                    onChange={(event) => mode === "name" ? setCompanyName(event.target.value) : setSourceUrl(event.target.value)}
                    placeholder={mode === "name" ? t.dashboard.companyPlaceholder : t.dashboard.linkPlaceholder}
                    className="h-12 w-full rounded-xl border border-[#E2E5EC] bg-white pl-11 pr-4 text-[13px] font-medium text-[#303342] outline-none transition placeholder:text-[#A9AEB9] focus:border-[#8A7FF0] focus:ring-4 focus:ring-[#EEEAFE]"
                  />
                </div>
                <div className="relative">
                  <Globe2 size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#969CAA]" />
                  <select value={country} onChange={(event) => setCountry(event.target.value)} className="h-12 w-full appearance-none rounded-xl border border-[#E2E5EC] bg-white pl-9 pr-8 text-[12px] font-semibold text-[#5F6471] outline-none transition focus:border-[#8A7FF0] focus:ring-4 focus:ring-[#EEEAFE]">
                    <option value="global">{t.dashboard.global}</option>
                    <option value="Vietnam">{locale === "vi" ? "Việt Nam" : "Vietnam"}</option>
                    <option value="China">{locale === "vi" ? "Trung Quốc" : "China"}</option>
                    <option value="United States">{locale === "vi" ? "Hoa Kỳ" : "United States"}</option>
                    <option value="Europe">{locale === "vi" ? "Châu Âu" : "Europe"}</option>
                    <option value="Other">{locale === "vi" ? "Khác" : "Other"}</option>
                  </select>
                  <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#969CAA]" />
                </div>
                <button disabled={isResearching} type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#5D53E8] px-5 text-[13px] font-bold text-white shadow-[0_8px_17px_rgba(85,73,218,0.25)] transition hover:bg-[#4E44D7] disabled:cursor-not-allowed disabled:opacity-70">
                  {isResearching ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={16} />}
                  {isResearching ? t.dashboard.researching : t.dashboard.research}
                </button>
              </form>
              {formError ? <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#C45B4D]"><AlertCircle size={13} /> {formError}</p> : <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[#8A90A0]"><ShieldCheck size={13} className="text-[#46A98A]" /> {t.dashboard.publicOnly}</p>}
            </div>
          </section>

          <section className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_328px]">
            <div className="rounded-[21px] border border-[#EAECF1] bg-white p-4 shadow-[0_8px_28px_rgba(31,38,56,0.025)] sm:p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-bold text-[#303342]">{t.dashboard.recent}</h2>
                  <p className="mt-1 text-[11px] text-[#888E9D]">{t.dashboard.recentDescription}</p>
                </div>
                <Link href={`${prefix}/reports`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[#6257E7] hover:bg-[#F5F3FF]">{t.dashboard.allReports} <ChevronRight size={14} /></Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[690px] border-separate border-spacing-0 text-left">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#A0A5B2]">
                      <th className="border-b border-[#EDF0F4] pb-3 pl-2">{t.dashboard.company}</th>
                      <th className="border-b border-[#EDF0F4] pb-3">{t.dashboard.status}</th>
                      <th className="border-b border-[#EDF0F4] pb-3">{t.dashboard.confidence}</th>
                      <th className="border-b border-[#EDF0F4] pb-3">{t.dashboard.keptUntil}</th>
                      <th className="border-b border-[#EDF0F4] pb-3 pr-2 text-right">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.slice(0, 4).map((report) => (
                      <tr key={report.id} className="group transition hover:bg-[#FAFBFD]">
                        <td className="border-b border-[#F0F1F4] py-3.5 pl-2">
                          <button type="button" onClick={() => setSelectedReport(report)} className="flex items-center gap-3 text-left">
                            <Avatar report={report} size="sm" />
                            <span>
                              <span className="block max-w-[220px] truncate text-[12px] font-bold text-[#353947] group-hover:text-[#5E53E8]">{report.companyName}</span>
                              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[#9095A3]"><Globe2 size={11} /> {report.country} · {report.createdAt}</span>
                            </span>
                          </button>
                        </td>
                        <td className="border-b border-[#F0F1F4] py-3.5"><StatusPill status={report.status} locale={locale} /></td>
                        <td className="border-b border-[#F0F1F4] py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[#EEF0F4]"><div className={`h-full rounded-full ${report.confidence >= 80 ? "bg-[#34AA87]" : "bg-[#E5A449]"}`} style={{ width: `${report.confidence}%` }} /></div>
                            <span className="text-[11px] font-bold text-[#626878]">{report.confidence}%</span>
                          </div>
                        </td>
                        <td className="border-b border-[#F0F1F4] py-3.5"><span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#777D8D]"><Clock3 size={13} /> {report.daysLeft} {t.common.days}</span></td>
                        <td className="border-b border-[#F0F1F4] py-3.5 pr-2 text-right"><button type="button" onClick={() => setSelectedReport(report)} className="rounded-lg p-1.5 text-[#969CAA] hover:bg-[#EEF0F5] hover:text-[#555C6B]" aria-label={`Mở ${report.companyName}`}><MoreHorizontal size={18} /></button></td>
                      </tr>
                    ))}
                    {reports.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-[12px] text-[#8B90A0]">{t.dashboard.emptyReports}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-5">
              <TargetRolesPanel locale={locale} />

              <section className="rounded-[21px] border border-[#E9E8F5] bg-white p-5 shadow-[0_8px_28px_rgba(31,38,56,0.025)]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9B9FAE]">{t.dashboard.retention}</p>
                    <h2 className="mt-1.5 text-[16px] font-bold text-[#303342]">{t.dashboard.default30}</h2>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "conic-gradient(#7566F7 0deg 258deg, #EEEFFC 258deg 360deg)" }}>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#6057DF]">30d</div>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-5 text-[#7A8090]">{t.dashboard.retentionText}</p>
                <div className="mt-4 border-t border-[#EEF0F4] pt-3.5">
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#767C8B]">Report sắp hết hạn</span><span className="font-bold text-[#343847]">02</span></div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EFF0F5]"><div className="h-full w-[27%] rounded-full bg-[#F2AB46]" /></div>
                </div>
                <Link href={`${prefix}/archive`} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#DDD9FF] bg-[#FAF9FF] px-3 py-2.5 text-[11px] font-bold text-[#5D53E8] hover:bg-[#F4F2FF]">
                  <Archive size={14} /> {t.dashboard.archive12}
                </Link>
              </section>

              <section className="rounded-[21px] bg-[#2E2B47] p-5 text-white shadow-[0_14px_30px_rgba(40,36,78,0.14)]">
                <div className="flex items-center justify-between"><div className="rounded-xl bg-white/10 p-2.5"><Database size={18} /></div><span className="rounded-full bg-[#9B8CFF]/20 px-2 py-1 text-[10px] font-bold text-[#CDC6FF]">STARTER</span></div>
                <p className="mt-4 text-[11px] font-medium text-[#C8C5DC]">{t.dashboard.credits}</p>
                <p className="mt-1 text-[28px] font-bold tracking-[-0.05em]">{credits}<span className="ml-1 text-sm font-semibold text-[#B7B2D4]">{t.common.credits}</span></p>
                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[10px] text-[#C7C3D9]"><span>{t.dashboard.enoughFor}</span><span className="font-bold text-white">{Math.floor(credits / 5)} {t.dashboard.reports}</span></div>
              </section>
            </div>
          </section>

          <section className="mt-5 grid gap-4 sm:grid-cols-3">
            {[
              { icon: FileSearch, title: t.dashboard.sourceClear, text: t.dashboard.sourceClearText },
              { icon: ShieldCheck, title: t.dashboard.purpose, text: t.dashboard.purposeText },
              { icon: UploadCloud, title: t.dashboard.exportReady, text: t.dashboard.exportReadyText }, 
            ].map((item) => (
              <div key={item.title} className="flex gap-3 rounded-2xl border border-[#EAECF1] bg-white p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F4F3FF] text-[#655AE8]"><item.icon size={17} /></div>
                <div><p className="text-[12px] font-bold text-[#3C4050]">{item.title}</p><p className="mt-1 text-[10px] leading-4 text-[#878D9C]">{item.text}</p></div>
              </div>
            ))}
          </section>
        </div>
      </main>

      {isResearching ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E2031]/35 p-5 backdrop-blur-[2px]">
          <div className="w-full max-w-[410px] rounded-[25px] border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(18,18,43,0.24)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[0_10px_24px_rgba(90,78,222,0.3)]" style={{ background: creditGradient }}><Sparkles size={21} /></div>
            <div className="mt-4 text-center"><h3 className="text-[18px] font-bold tracking-[-0.03em] text-[#2B2D3C]">{t.dashboard.newReport}</h3><p className="mt-1.5 text-[12px] leading-5 text-[#7A7F8E]">{t.dashboard.newReportText}</p></div>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-[#EFF0F5]"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: creditGradient }} /></div>
            <div className="mt-3 flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5 font-medium text-[#777D8D]"><LoaderCircle size={13} className="animate-spin text-[#655AE8]" /> {t.dashboard.researching}</span><span className="font-bold text-[#5D53E8]">{progress}%</span></div>
            <div className="mt-6 space-y-2 rounded-xl bg-[#F8F9FC] p-3 text-[11px] text-[#7D8391]"><p className="flex items-center gap-2"><Check size={13} className="text-[#36A77F]" /> Chuẩn bị truy vấn theo ngữ cảnh</p><p className="flex items-center gap-2"><LoaderCircle size={13} className="animate-spin text-[#6C61EE]" /> Đang kiểm tra website và company signals</p><p className="flex items-center gap-2 text-[#B0B4BF]"><span className="ml-[2px] h-2 w-2 rounded-full border border-[#B4B8C3]" /> Chuẩn hoá evidence thành report</p></div>
          </div>
        </div>
      ) : null}

      {selectedReport ? <ReportDrawer locale={locale} report={selectedReport} onClose={() => setSelectedReport(null)} onCopy={handleCopy} onRefresh={() => notify(locale === "vi" ? "Làm mới report sẽ sử dụng 1 credit trong phiên bản production." : "Refreshing a report uses 1 credit in production.")} onArchive={() => notify(locale === "vi" ? "Kho lưu trữ 12 tháng đã được thêm vào danh sách quan tâm." : "The 12-month archive has been added to your interest list.")} /> : null}

      {toast ? <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-[#E6E4F9] bg-[#2E2B47] px-4 py-3 text-[12px] font-medium text-white shadow-[0_12px_35px_rgba(21,20,45,0.24)]">{toast}</div> : null}
    </div>
  );
}

function ReportDrawer({ locale, report, onClose, onCopy, onRefresh, onArchive }: { locale: AppLocale; report: CompanyReport; onClose: () => void; onCopy: (value: string, label: string) => void; onRefresh: () => void; onArchive: () => void }) {
  const t = getCopy(locale);
  const confidenceTone = report.confidence >= 80 ? "text-[#168466] bg-[#EAF8F3]" : "text-[#C37B18] bg-[#FFF4E5]";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#202233]/35 backdrop-blur-[1.5px]">
      <button type="button" onClick={onClose} className="hidden flex-1 cursor-default lg:block" aria-label="Đóng report" />
      <aside className="flex h-full w-full max-w-[660px] flex-col bg-[#FAFBFC] shadow-[-18px_0_50px_rgba(27,30,45,0.18)]">
        <header className="flex items-center justify-between border-b border-[#E9EBF1] bg-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#858B99]"><FileSearch size={15} className="text-[#675DEB]" /> {t.drawer.report} <ChevronRight size={13} /> <span className="max-w-[170px] truncate text-[#555B6A]">{report.companyName}</span></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#737987] transition hover:bg-[#F1F2F5]" aria-label="Đóng"><X size={19} /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="flex items-start gap-3.5">
            <Avatar report={report} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-[20px] font-bold tracking-[-0.04em] text-[#2D3040]">{report.companyName}</h2><StatusPill status={report.status} locale={locale} /></div>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[#7C8290]"><Globe2 size={13} /> {report.country} <span className="text-[#CFD1D8]">•</span> {report.industry}</p>
              {report.foundedYear || report.headcount || report.address ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#8A90A0]">
                  {report.foundedYear ? <span>{locale === "vi" ? "Thành lập" : "Founded"} {report.foundedYear}</span> : null}
                  {report.headcount ? <span>{report.headcount}</span> : null}
                  {report.address ? <span className="inline-flex items-center gap-1"><Users size={12} /> {report.address}</span> : null}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-[#E8EAF0] bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9BA0AF]">{t.drawer.confidence}</p><p className="mt-1 text-[25px] font-bold tracking-[-0.05em] text-[#343746]">{report.confidence}<span className="text-sm text-[#858B99]">/100</span></p></div>
              <span className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${confidenceTone}`}>{report.confidence >= 80 ? t.drawer.verified : t.drawer.review}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EDF0F3]"><div className={`h-full rounded-full ${report.confidence >= 80 ? "bg-[#32AD83]" : "bg-[#E9A143]"}`} style={{ width: `${report.confidence}%` }} /></div>
            <p className="mt-3 text-[11px] leading-5 text-[#757B8A]">{report.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{report.signals.map((signal) => <span key={signal} className="rounded-full bg-[#F4F5F8] px-2 py-1 text-[10px] font-semibold text-[#6C7280]">{signal}</span>)}</div>
          </div>

          {report.people && report.people.length > 0 ? <PeoplePanel locale={locale} people={report.people} offer={report.sellerOffer} onCopy={onCopy} /> : null}

          <div className="mt-6 flex items-center justify-between"><div><h3 className="text-[14px] font-bold text-[#333747]">{t.drawer.channels}</h3><p className="mt-1 text-[11px] text-[#8A90A0]">{t.drawer.channelsText}</p></div><span className="text-[11px] font-semibold text-[#6D63E8]">{report.contacts.length} fields</span></div>
          <div className="mt-3 space-y-2">
            {report.contacts.map((contact) => {
              const canCopy = contact.value !== "Chưa xác minh" && contact.value !== "Not verified";
              return (
                <div key={`${contact.label}-${contact.value}`} className="flex items-center gap-3 rounded-xl border border-[#E9EBF0] bg-white px-3.5 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F5F6F9]"><ContactIcon type={contact.type} /></div>
                  <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-[#9297A4]">{contact.label}</p><p className="mt-0.5 truncate text-[12px] font-bold text-[#3B3F4F]">{contact.value}</p>{contact.via ? <p className="mt-0.5 truncate text-[9px] text-[#A1A5B1]">{contact.via}</p> : null}<div className="mt-1"><ProvenanceBadge locale={locale} certainty={contact.certainty} identityMatch={contact.identityMatch} policy={contact.policy} /></div></div>
                  <div className="flex shrink-0 items-center gap-2"><div className="hidden text-right sm:block"><span className={`inline-flex items-center gap-1 text-[10px] font-bold ${contact.verified ? "text-[#209170]" : "text-[#A0A5B1]"}`}>{contact.verified ? <CircleCheckBig size={12} /> : <AlertCircle size={12} />}{contact.verified ? t.drawer.verifiedLabel : t.drawer.unverifiedLabel}</span><p className="mt-1 max-w-[108px] truncate text-[9px] text-[#A1A5B1]">{contact.source}</p></div><button type="button" disabled={!canCopy} onClick={() => onCopy(contact.value, contact.label)} title={t.common.copy} aria-label={`${t.common.copy} ${contact.label}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E3E6EC] text-[#6257E7] transition hover:border-[#D7D1FF] hover:bg-[#F6F4FF] disabled:cursor-not-allowed disabled:opacity-35"><Copy size={15} /></button></div>
                </div>
              );
            })}
          </div>

          {report.notes && report.notes.length > 0 ? <IntelNotesPanel locale={locale} notes={report.notes} /> : null}

          <div className="mt-6 flex items-center justify-between"><div><h3 className="text-[14px] font-bold text-[#333747]">{t.drawer.sources}</h3><p className="mt-1 text-[11px] text-[#8A90A0]">{t.drawer.sourcesText}</p></div><span className="rounded-full bg-[#F0EEFF] px-2 py-1 text-[10px] font-bold text-[#6257E7]">{report.sources.length} sources</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.sources.map((source) => (
              <div key={source.url} className="group rounded-xl border border-[#E9EBF0] bg-white p-3 transition hover:border-[#D8D3FC] hover:bg-[#FCFBFF]">
                <a href={source.url} target="_blank" rel="noreferrer" className="block">
                  <div className="flex items-start justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#6A7080]">{source.kind === "social" ? <BriefcaseBusiness size={13} className="text-[#5C70CC]" /> : source.kind === "news" ? <FileSearch size={13} className="text-[#E89C43]" /> : <Globe2 size={13} className="text-[#6C63E9]" />}{source.label}</span><ExternalLink size={13} className="text-[#A1A6B2] group-hover:text-[#655BE7]" /></div>
                  <p className="mt-2 truncate text-[10px] text-[#9095A3]">{source.url.replace(/^https?:\/\//, "")}</p>
                </a>
                <div className="mt-2 flex items-center justify-between gap-2">{source.verified ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#209170]"><Check size={11} /> Evidence verified</span> : <span />}<button type="button" onClick={() => onCopy(source.url, source.label)} title={t.common.copy} aria-label={`${t.common.copy} ${source.label}`} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-bold text-[#6257E7] hover:bg-[#F2F0FF]"><Copy size={12} />{t.common.copy}</button></div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-[#E5E1FE] bg-[#F9F8FF] p-4">
            <div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#655BE8] shadow-sm"><Clock3 size={17} /></div><div><p className="text-[12px] font-bold text-[#484064]">{t.drawer.snapshot} {report.daysLeft} {t.common.days}</p><p className="mt-1 text-[10px] leading-4 text-[#77738D]">{locale === "vi" ? `Lưu đến ${report.expiresAt}. ` : `Stored until ${report.expiresAt}. `}{t.drawer.snapshotText}</p></div></div>
            <button type="button" onClick={onArchive} className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#5E53E8] hover:text-[#4035CA]"><Archive size={14} /> {t.drawer.archive}</button>
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-[#E9EBF1] bg-white px-5 py-4 sm:gap-3 sm:px-7">
          <button type="button" onClick={() => onCopy(reportSummaryForClipboard(report, locale), t.common.copySummary)} title={t.common.copySummary} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#DDD9FF] bg-[#FAF9FF] px-3 text-[12px] font-bold text-[#5D53E8] transition hover:bg-[#F4F2FF]"><Copy size={16} /> <span className="hidden md:inline">{t.common.copySummary}</span></button>
          <button type="button" onClick={() => window.print()} title={t.drawer.export} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#E1E4EA] px-3 text-[12px] font-bold text-[#5D6371] transition hover:bg-[#F7F8FA]"><Download size={16} /> <span className="hidden sm:inline">{t.drawer.export}</span></button>
          <button type="button" onClick={onRefresh} className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[#5D53E8] px-3 text-[12px] font-bold text-white shadow-[0_7px_15px_rgba(85,73,218,0.2)] transition hover:bg-[#4E44D7] sm:px-4"><Sparkles size={15} /> <span className="truncate">{t.drawer.refresh}</span> <span className="hidden text-white/70 sm:inline">· 1 credit</span></button>
        </footer>
      </aside>
    </div>
  );
}
