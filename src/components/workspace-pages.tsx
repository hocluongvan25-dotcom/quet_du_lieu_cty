"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Archive,
  ArrowUpRight,
  BellRing,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  Database,
  Download,
  FileSearch,
  Filter,
  Globe2,
  History,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { initialReports } from "@/lib/demo-data";
import { getCopy, normalizeLocale } from "@/lib/i18n";
import { WorkspaceShell } from "@/components/workspace-shell";

function useWorkspaceCopy() {
  const params = useParams<{ locale?: string }>();
  const locale = normalizeLocale(params?.locale);
  return { locale, t: getCopy(locale), prefix: `/${locale}` };
}

function PageIntro({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-[27px] font-bold tracking-[-0.045em] text-[#282B39] sm:text-[31px]">{title}</h1><p className="mt-1.5 text-[13px] text-[#777D8C]">{subtitle}</p></div>
      {action}
    </div>
  );
}

function ReportAvatar({ initials, accent }: { initials: string; accent: string }) {
  return <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[11px] font-bold" style={{ background: `${accent}18`, color: accent }}>{initials}</span>;
}

function Status({ status, locale }: { status: string; locale: "vi" | "en" }) {
  const isReady = status === "ready";
  const label = isReady ? (locale === "vi" ? "Sẵn sàng" : "Ready") : (locale === "vi" ? "Cần xem lại" : "Needs review");
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${isReady ? "bg-[#EAF8F3] text-[#168466]" : "bg-[#FFF4E5] text-[#C47A16]"}`}><span className={`h-1.5 w-1.5 rounded-full ${isReady ? "bg-[#22AD86]" : "bg-[#E49B31]"}`} />{label}</span>;
}

export function ReportsPage() {
  const { locale, t, prefix } = useWorkspaceCopy();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => initialReports.filter((report) => report.companyName.toLowerCase().includes(query.toLowerCase()) || report.country.toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <WorkspaceShell active="reports">
      <div className="mx-auto max-w-[1460px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9">
        <PageIntro title={t.pages.reports.title} subtitle={t.pages.reports.subtitle} action={<Link href={prefix} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#5D53E8] px-4 text-[12px] font-bold text-white shadow-[0_7px_15px_rgba(85,73,218,0.2)] hover:bg-[#4E44D7]"><Plus size={15} />{t.pages.reports.action}</Link>} />
        <section className="rounded-[21px] border border-[#EAECF1] bg-white p-4 shadow-[0_8px_28px_rgba(31,38,56,0.025)] sm:p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="relative max-w-[370px] flex-1"><Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9DA2AF]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.common.searchReports} className="h-10 w-full rounded-xl border border-[#E3E6ED] bg-[#FAFBFC] pl-9 pr-3 text-[12px] outline-none focus:border-[#9187EE] focus:bg-white" /></div><div className="flex items-center gap-2"><button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E4E6EC] px-3 text-[11px] font-bold text-[#646A79] hover:bg-[#FAFBFC]"><Filter size={14} />{t.common.filter}<ChevronDown size={13} /></button><button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E4E6EC] px-3 text-[11px] font-bold text-[#646A79] hover:bg-[#FAFBFC]"><Download size={14} />CSV</button></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-separate border-spacing-0 text-left"><thead><tr className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#A0A5B2]"><th className="border-b border-[#EDF0F4] pb-3 pl-2">{t.dashboard.company}</th><th className="border-b border-[#EDF0F4] pb-3">{t.dashboard.status}</th><th className="border-b border-[#EDF0F4] pb-3">{t.dashboard.confidence}</th><th className="border-b border-[#EDF0F4] pb-3">{t.common.source}</th><th className="border-b border-[#EDF0F4] pb-3">{t.dashboard.keptUntil}</th><th className="border-b border-[#EDF0F4] pb-3" /></tr></thead><tbody>{filtered.map((report) => <tr key={report.id} className="group hover:bg-[#FAFBFD]"><td className="border-b border-[#F0F1F4] py-3.5 pl-2"><div className="flex items-center gap-3"><ReportAvatar initials={report.initials} accent={report.accent} /><div><p className="text-[12px] font-bold text-[#363947]">{report.companyName}</p><p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#9095A3]"><Globe2 size={11} />{report.country} · {report.industry}</p></div></div></td><td className="border-b border-[#F0F1F4] py-3.5"><Status status={report.status} locale={locale} /></td><td className="border-b border-[#F0F1F4] py-3.5"><div className="flex items-center gap-2"><span className="h-1.5 w-14 overflow-hidden rounded-full bg-[#EEF0F4]"><span className="block h-full rounded-full bg-[#36AA87]" style={{ width: `${report.confidence}%` }} /></span><span className="text-[11px] font-bold text-[#626878]">{report.confidence}%</span></div></td><td className="border-b border-[#F0F1F4] py-3.5"><span className="inline-flex items-center gap-1 text-[11px] text-[#737987]"><FileSearch size={13} />{report.sources.length} sources</span></td><td className="border-b border-[#F0F1F4] py-3.5"><span className="inline-flex items-center gap-1 text-[11px] text-[#737987]"><Clock3 size={13} />{report.daysLeft} {t.common.days}</span></td><td className="border-b border-[#F0F1F4] py-3.5 text-right"><Link href={prefix} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-[#655BE7] hover:bg-[#F2F0FF]">{t.common.view}<ArrowUpRight size={13} /></Link></td></tr>)}</tbody></table></div>
          {filtered.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B90A0]">{locale === "vi" ? "Không tìm thấy report phù hợp." : "No matching reports found."}</div> : null}
        </section>
      </div>
    </WorkspaceShell>
  );
}

export function ArchivePage() {
  const { locale, t } = useWorkspaceCopy();
  return (
    <WorkspaceShell active="archive">
      <div className="mx-auto max-w-[1200px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9">
        <PageIntro title={t.pages.archive.title} subtitle={t.pages.archive.subtitle} action={<button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#DDD9FF] bg-[#FAF9FF] px-4 text-[12px] font-bold text-[#5D53E8]"><Archive size={15} />{t.common.upgrade}</button>} />
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[22px] border border-[#E8E6FA] bg-white p-6 shadow-[0_8px_28px_rgba(31,38,56,0.025)]"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9B9FAE]">{t.dashboard.retention}</p><h2 className="mt-1.5 text-[23px] font-bold tracking-[-0.04em] text-[#333646]">{t.dashboard.default30}</h2><p className="mt-2 max-w-md text-[12px] leading-5 text-[#7B8190]">{t.dashboard.retentionText}</p></div><div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "conic-gradient(#7566F7 0deg 258deg, #EEEFFC 258deg 360deg)" }}><div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[11px] font-bold text-[#6057DF]">30d</div></div></div><div className="mt-6 grid grid-cols-3 gap-2 border-t border-[#EEF0F4] pt-4"><div><p className="text-[10px] text-[#9196A4]">{locale === "vi" ? "Đang lưu" : "Active"}</p><p className="mt-1 text-[17px] font-bold text-[#343746]">03</p></div><div><p className="text-[10px] text-[#9196A4]">{locale === "vi" ? "Sắp hết hạn" : "Expiring"}</p><p className="mt-1 text-[17px] font-bold text-[#D78927]">02</p></div><div><p className="text-[10px] text-[#9196A4]">{locale === "vi" ? "Đã archive" : "Archived"}</p><p className="mt-1 text-[17px] font-bold text-[#5D53E8]">00</p></div></div></section>
          <section className="rounded-[22px] bg-[#2E2B47] p-6 text-white shadow-[0_14px_30px_rgba(40,36,78,0.14)]"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><History size={18} /></div><h2 className="mt-4 text-[17px] font-bold">{locale === "vi" ? "Đừng chỉ lưu, hãy theo dõi thay đổi." : "Don’t just store it. Monitor change."}</h2><p className="mt-2 text-[11px] leading-5 text-[#CAC6DE]">{locale === "vi" ? "Gói Pro lưu snapshot 12 tháng, đối chiếu contact và website qua từng lần refresh." : "Pro keeps 12-month snapshots and compares contacts and websites on every refresh."}</p><button type="button" className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#D8D1FF]">{t.dashboard.archive12}<ArrowUpRight size={13} /></button></section>
        </div>
        <section className="mt-5 rounded-[21px] border border-[#EAECF1] bg-white p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[14px] font-bold text-[#353847]">{locale === "vi" ? "Snapshot sắp hết hạn" : "Snapshots expiring soon"}</h2><p className="mt-1 text-[11px] text-[#898F9E]">{locale === "vi" ? "Export, refresh hoặc archive trước khi các raw artifacts bị xoá." : "Export, refresh, or archive before raw artifacts are removed."}</p></div><BellRing size={18} className="text-[#F0A646]" /></div><div className="space-y-2">{initialReports.slice(1).map((report) => <div key={report.id} className="flex items-center gap-3 rounded-xl bg-[#FAFBFC] px-3.5 py-3"><ReportAvatar initials={report.initials} accent={report.accent} /><div className="min-w-0 flex-1"><p className="text-[12px] font-bold text-[#3A3D4C]">{report.companyName}</p><p className="mt-0.5 text-[10px] text-[#8D93A0]">{locale === "vi" ? "Snapshot sẽ hết hạn" : "Snapshot expires"} · {report.expiresAt}</p></div><button type="button" className="rounded-lg border border-[#E4E1FD] bg-white px-2.5 py-1.5 text-[10px] font-bold text-[#6257E7]">{locale === "vi" ? "Archive" : "Archive"}</button></div>)}</div></section>
      </div>
    </WorkspaceShell>
  );
}

export function HistoryPage() {
  const { locale, t } = useWorkspaceCopy();
  const events = locale === "vi"
    ? [
        ["Hôm nay, 09:42", "Nova Distribution Ltd.", "Đã phát hiện email kinh doanh mới", "sales@novadistribution.example đã được xác minh từ trang Contact."],
        ["02/10/2026", "Velar Foods GmbH", "Confidence giảm từ 82 xuống 67", "Phát hiện hai company profiles có tên và quốc gia gần giống nhau."],
        ["28/09/2026", "Hoshi Components Co.", "Website catalog được cập nhật", "Đã thay đổi URL catalogue sản phẩm và giữ snapshot trước đó."],
      ]
    : [
        ["Today, 09:42", "Nova Distribution Ltd.", "New business email detected", "sales@novadistribution.example was verified from the Contact page."],
        ["02 Oct 2026", "Velar Foods GmbH", "Confidence changed from 82 to 67", "Two company profiles with similar names and countries were discovered."],
        ["28 Sep 2026", "Hoshi Components Co.", "Website catalogue updated", "The product catalogue URL changed and the previous snapshot was retained."],
      ];
  return (
    <WorkspaceShell active="history"><div className="mx-auto max-w-[1000px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9"><PageIntro title={t.pages.history.title} subtitle={t.pages.history.subtitle} /><section className="rounded-[21px] border border-[#EAECF1] bg-white p-5 sm:p-6"><div className="mb-6 flex items-center gap-2"><div className="rounded-lg bg-[#F0EEFF] p-2 text-[#6359E8]"><History size={17} /></div><div><p className="text-[13px] font-bold text-[#343747]">{locale === "vi" ? "Dòng thời gian evidence" : "Evidence timeline"}</p><p className="mt-0.5 text-[10px] text-[#8C92A0]">{locale === "vi" ? "Các thay đổi được gắn với report snapshot tương ứng." : "Every change is linked to its matching report snapshot."}</p></div></div><div className="relative ml-3 border-l border-[#E4E6EF] pl-6">{events.map((event, index) => <article key={event[0]} className="relative pb-7 last:pb-0"><span className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-[3px] border-white ${index === 0 ? "bg-[#665BE8] shadow-[0_0_0_1px_#dcd8ff]" : "bg-[#B8BDC8]"}`} /><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold text-[#999FAD]">{event[0]}</span><span className="rounded-full bg-[#F3F4F7] px-2 py-0.5 text-[9px] font-bold text-[#6F7584]">{event[1]}</span></div><h3 className="mt-2 text-[13px] font-bold text-[#383B4A]">{event[2]}</h3><p className="mt-1 max-w-[650px] text-[11px] leading-5 text-[#7B8190]">{event[3]}</p><button type="button" className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#6257E7]">{locale === "vi" ? "Mở snapshot" : "Open snapshot"}<ArrowUpRight size={12} /></button></article>)}</div></section></div></WorkspaceShell>
  );
}

export function TeamPage() {
  const { locale, t } = useWorkspaceCopy();
  const [notice, setNotice] = useState("");
  const members = [
    { initials: "AN", name: "Anh Nguyen", email: "anh@seekora.demo", role: locale === "vi" ? "Owner" : "Owner", color: "#218A72" },
    { initials: "ML", name: "Mai Le", email: "mai@seekora.demo", role: locale === "vi" ? "Researcher" : "Researcher", color: "#655BE8" },
    { initials: "TH", name: "Thanh Ho", email: "thanh@seekora.demo", role: locale === "vi" ? "Viewer" : "Viewer", color: "#D2803B" },
  ];
  return <WorkspaceShell active="team"><div className="mx-auto max-w-[1200px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9"><PageIntro title={t.pages.team.title} subtitle={t.pages.team.subtitle} action={<button type="button" onClick={() => { setNotice(locale === "vi" ? "Lời mời đã sẵn sàng để gửi." : "Your invite is ready to send."); setTimeout(() => setNotice(""), 2300); }} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5D53E8] px-4 text-[12px] font-bold text-white hover:bg-[#4E44D7]"><Plus size={15} />{t.pages.team.action}</button>} /><div className="grid gap-4 md:grid-cols-3">{members.map((member) => <section key={member.email} className="rounded-[20px] border border-[#E8EAF0] bg-white p-5 shadow-[0_8px_28px_rgba(31,38,56,0.025)]"><div className="flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: `${member.color}18`, color: member.color }}>{member.initials}</div><button type="button" className="rounded-lg p-1.5 text-[#9BA0AC] hover:bg-[#F5F6F8]"><MoreHorizontal size={18} /></button></div><h2 className="mt-4 text-[14px] font-bold text-[#343746]">{member.name}</h2><p className="mt-1 text-[11px] text-[#898F9E]">{member.email}</p><div className="mt-4 flex items-center justify-between border-t border-[#EEF0F4] pt-3"><span className="rounded-full bg-[#F1F0FF] px-2 py-1 text-[10px] font-bold text-[#6257E7]">{member.role}</span><span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#218B70]"><span className="h-1.5 w-1.5 rounded-full bg-[#28A984]" />{t.common.active}</span></div></section>)}</div><section className="mt-5 rounded-[20px] border border-[#E9E6FB] bg-[#FAF9FF] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><div className="rounded-xl bg-white p-2.5 text-[#6257E7] shadow-sm"><ShieldCheck size={18} /></div><div><h2 className="text-[13px] font-bold text-[#403D59]">{locale === "vi" ? "Phân quyền theo workspace" : "Workspace-based access"}</h2><p className="mt-1 text-[11px] leading-4 text-[#77738D]">{locale === "vi" ? "Owner và Admin quản lý credits, retention và thành viên. Researcher chỉ tạo report trong workspace của mình." : "Owners and admins manage credits, retention, and members. Researchers can only create reports in their own workspace."}</p></div></div><button type="button" className="w-fit text-[11px] font-bold text-[#5F54E6]">{locale === "vi" ? "Xem role matrix" : "View role matrix"}</button></div></section>{notice ? <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#2E2B47] px-4 py-3 text-[12px] font-medium text-white shadow-xl">{notice}</div> : null}</div></WorkspaceShell>;
}

export function BillingPage() {
  const { locale, t } = useWorkspaceCopy();
  const usage = locale === "vi" ? [["Hôm nay", "Nova Distribution Ltd.", "Company Report", "-5"], ["Hôm qua", "Hoshi Components Co.", "Company Report", "-5"], ["01/10/2026", "Nạp Starter credits", "Top-up", "+150"]] : [["Today", "Nova Distribution Ltd.", "Company Report", "-5"], ["Yesterday", "Hoshi Components Co.", "Company Report", "-5"], ["01 Oct 2026", "Starter credits top-up", "Top-up", "+150"]];
  return <WorkspaceShell active="billing"><div className="mx-auto max-w-[1200px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9"><PageIntro title={t.pages.billing.title} subtitle={t.pages.billing.subtitle} action={<button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5D53E8] px-4 text-[12px] font-bold text-white hover:bg-[#4E44D7]"><Plus size={15} />{locale === "vi" ? "Nạp credits" : "Add credits"}</button>} /><div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]"><section className="overflow-hidden rounded-[22px] bg-[#2E2B47] p-6 text-white shadow-[0_14px_30px_rgba(40,36,78,0.14)]"><div className="flex items-center justify-between"><div className="rounded-xl bg-white/10 p-2.5"><CreditCard size={18} /></div><span className="rounded-full bg-[#9B8CFF]/20 px-2 py-1 text-[10px] font-bold text-[#CDC6FF]">STARTER</span></div><p className="mt-5 text-[11px] font-medium text-[#C8C5DC]">{t.dashboard.credits}</p><p className="mt-1 text-[38px] font-bold tracking-[-0.06em]">128 <span className="text-[15px] font-semibold text-[#B7B2D4]">{t.common.credits}</span></p><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[71%] rounded-full bg-[#A89CFF]" /></div><div className="mt-3 flex items-center justify-between text-[10px] text-[#C9C5DD]"><span>{locale === "vi" ? "Chu kỳ tháng 10" : "October cycle"}</span><span>72% {locale === "vi" ? "còn lại" : "remaining"}</span></div></section><section className="rounded-[22px] border border-[#E8EAF0] bg-white p-6"><div className="flex items-center gap-2"><Database size={18} className="text-[#6257E7]" /><h2 className="text-[14px] font-bold text-[#353847]">{locale === "vi" ? "Starter vs Pro Archive" : "Starter vs Pro Archive"}</h2></div><div className="mt-4 space-y-3 text-[11px]">{[[locale === "vi" ? "Research reports" : "Research reports", "5 credits", "5 credits"], [locale === "vi" ? "Lưu snapshot" : "Snapshot retention", "30 days", "12 months"], [locale === "vi" ? "Change monitoring" : "Change monitoring", "—", "Included"]].map((row) => <div key={row[0]} className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 border-b border-[#F0F1F4] pb-3 last:border-0"><span className="text-[#747A89]">{row[0]}</span><span className="font-semibold text-[#5C6170]">{row[1]}</span><span className="font-bold text-[#6257E7]">{row[2]}</span></div>)}</div><button type="button" className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-[#5D53E8]">{t.common.upgrade}<ArrowUpRight size={13} /></button></section></div><section className="mt-5 rounded-[21px] border border-[#EAECF1] bg-white p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[14px] font-bold text-[#353847]">{locale === "vi" ? "Credit activity" : "Credit activity"}</h2><p className="mt-1 text-[11px] text-[#898F9E]">{locale === "vi" ? "Lịch sử credit có thể audit theo từng research job." : "Credit activity can be audited against every research job."}</p></div><button type="button" className="text-[11px] font-bold text-[#6257E7]">{locale === "vi" ? "Tải invoice" : "Download invoice"}</button></div><div className="space-y-1">{usage.map((entry) => <div key={entry.join("-")} className="grid grid-cols-[90px_1fr_120px_40px] items-center gap-2 rounded-xl px-3 py-3 text-[11px] hover:bg-[#FAFBFC]"><span className="text-[#979DAA]">{entry[0]}</span><span className="font-bold text-[#414452]">{entry[1]}</span><span className="text-[#7B8190]">{entry[2]}</span><span className={`text-right font-bold ${entry[3].startsWith("+") ? "text-[#219070]" : "text-[#5E54E8]"}`}>{entry[3]}</span></div>)}</div></section></div></WorkspaceShell>;
}

export function SettingsPage() {
  const { locale, t } = useWorkspaceCopy();
  const [retention, setRetention] = useState("30");
  const [notice, setNotice] = useState("");
  const save = () => { setNotice(locale === "vi" ? "Cài đặt đã được lưu trong demo workspace." : "Settings saved in the demo workspace."); setTimeout(() => setNotice(""), 2600); };
  return <WorkspaceShell active="settings"><div className="mx-auto max-w-[980px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9"><PageIntro title={t.pages.settings.title} subtitle={t.pages.settings.subtitle} action={<button type="button" onClick={save} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5D53E8] px-4 text-[12px] font-bold text-white hover:bg-[#4E44D7]"><Check size={15} />{t.common.save}</button>} /><div className="space-y-5"><section className="rounded-[21px] border border-[#EAECF1] bg-white p-5"><div className="flex gap-3"><div className="rounded-xl bg-[#F0EEFF] p-2.5 text-[#6257E7]"><Archive size={18} /></div><div><h2 className="text-[14px] font-bold text-[#373A49]">{locale === "vi" ? "Data retention" : "Data retention"}</h2><p className="mt-1 text-[11px] leading-5 text-[#818796]">{locale === "vi" ? "Chọn thời gian giữ report snapshot. Raw artifacts phải tuân theo giới hạn của nguồn dữ liệu." : "Choose the report snapshot period. Raw artifacts must respect each source’s permitted retention period."}</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-[240px_1fr]"><select value={retention} onChange={(event) => setRetention(event.target.value)} className="h-10 rounded-xl border border-[#E2E5EC] bg-white px-3 text-[12px] font-semibold text-[#5F6471] outline-none focus:border-[#9187EE]"><option value="30">30 {t.common.days} · Starter</option><option value="90">90 {t.common.days} · Pro</option><option value="365">12 {locale === "vi" ? "tháng" : "months"} · Pro Archive</option></select><p className="rounded-xl bg-[#FAFBFC] px-3 py-2.5 text-[11px] text-[#777D8B]">{locale === "vi" ? "Thay đổi này chỉ áp dụng cho report mới; snapshot cũ giữ policy tại thời điểm tạo." : "This change applies to new reports only; existing snapshots retain their original policy."}</p></div></section><section className="rounded-[21px] border border-[#EAECF1] bg-white p-5"><div className="flex gap-3"><div className="rounded-xl bg-[#F0EEFF] p-2.5 text-[#6257E7]"><ShieldCheck size={18} /></div><div><h2 className="text-[14px] font-bold text-[#373A49]">{locale === "vi" ? "Research safety" : "Research safety"}</h2><p className="mt-1 text-[11px] leading-5 text-[#818796]">{locale === "vi" ? "Các nguyên tắc an toàn áp dụng khi người dùng dán một link nguồn." : "Safety guardrails applied whenever a user pastes a source link."}</p></div></div><div className="mt-5 space-y-3">{[[locale === "vi" ? "Chỉ cho phép HTTP/HTTPS" : "Only allow HTTP/HTTPS", true], [locale === "vi" ? "Chặn private IP và cloud metadata" : "Block private IPs and cloud metadata", true], [locale === "vi" ? "Lưu source evidence theo policy" : "Keep source evidence by policy", true]].map(([label, on]) => <label key={String(label)} className="flex items-center justify-between rounded-xl border border-[#EDF0F4] px-3.5 py-3"><span className="text-[12px] font-semibold text-[#555B6A]">{label as string}</span><span className={`relative h-5 w-9 rounded-full ${on ? "bg-[#655BE8]" : "bg-[#D8DBE2]"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ${on ? "right-0.5" : "left-0.5"}`} /></span></label>)}</div></section><section className="rounded-[21px] border border-[#EAECF1] bg-white p-5"><div className="flex gap-3"><div className="rounded-xl bg-[#F0EEFF] p-2.5 text-[#6257E7]"><Globe2 size={18} /></div><div><h2 className="text-[14px] font-bold text-[#373A49]">{t.language}</h2><p className="mt-1 text-[11px] leading-5 text-[#818796]">{locale === "vi" ? "Giao diện hỗ trợ tiếng Việt và English. Dữ liệu nguồn vẫn được giữ nguyên ngôn ngữ gốc." : "The interface supports Vietnamese and English. Source data remains in its original language."}</p></div></div><div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#F6F7FA] px-3 py-2 text-[11px] font-bold text-[#5D53E8]"><Globe2 size={14} />{locale === "vi" ? "Tiếng Việt đang được dùng" : "English is currently active"}</div></section></div>{notice ? <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#2E2B47] px-4 py-3 text-[12px] font-medium text-white shadow-xl">{notice}</div> : null}</div></WorkspaceShell>;
}
