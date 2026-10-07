"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Filter,
  Globe2,
  Mail,
  Phone,
  Search,
  UserRound,
  Users, MessageCircle } from "lucide-react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { filterBuyerList, type BuyerContactRow, type BuyerListRow } from "@/lib/data/buyer-view";
import type { AppLocale } from "@/lib/i18n";

/**
 * Danh sách buyer: nhiều công ty trên một màn hình, mở rộng để xem kênh liên hệ
 * tìm được. Chỉ hiển thị dữ liệu, nguồn và nhãn tin cậy.
 */

const CHANNEL_ICON: Record<string, typeof Mail> = {
  email: Mail,
  phone: Phone,
  linkedin: UserRound,
  whatsapp: MessageCircle,
  form: Globe2,
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("vi-VN");
}

export function BuyersPage({
  locale,
  buyers,
  contacts,
  live,
}: {
  locale: AppLocale;
  buyers: BuyerListRow[];
  contacts: BuyerContactRow[];
  live: boolean;
}) {
  const isVietnamese = locale === "vi";
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [onlyWithPeople, setOnlyWithPeople] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(buyers[0]?.id ?? null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");

  const countries = useMemo(() => [...new Set(buyers.map((buyer) => buyer.country).filter(Boolean))].sort() as string[], [buyers]);
  const contactsByBuyer = useMemo(() => {
    const map = new Map<string, BuyerContactRow[]>();
    contacts.forEach((contact) => {
      const list = map.get(contact.buyerId) ?? [];
      list.push(contact);
      map.set(contact.buyerId, list);
    });
    return map;
  }, [contacts]);

  const filtered = useMemo(
    () => filterBuyerList({ buyers, contacts: [] }, { country, query, onlyWithPeople }).buyers,
    [buyers, country, onlyWithPeople, query],
  );

  const filteredContactCount = filtered.reduce((total, buyer) => total + (contactsByBuyer.get(buyer.id)?.length ?? 0), 0);
  const withheldTotal = filtered.reduce((total, buyer) => total + buyer.withheldChannels, 0);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (country) params.set("country", country);
      if (query.trim()) params.set("q", query.trim());
      if (onlyWithPeople) params.set("people", "1");
      const response = await fetch(`/api/export/buyers?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `seekora-buyers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(isVietnamese ? `Đã xuất ${filteredContactCount} dòng.` : `Exported ${filteredContactCount} rows.`);
    } catch {
      setNotice(isVietnamese ? "Không xuất được file. Thử lại sau." : "Could not export the file. Please retry.");
    } finally {
      setExporting(false);
      window.setTimeout(() => setNotice(""), 3000);
    }
  };

  return (
    <WorkspaceShell active="buyers">
      <div className="mx-auto max-w-[1460px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[27px] font-bold tracking-[-0.045em] text-[#282B39] sm:text-[31px]">
              {isVietnamese ? "Buyer & kênh liên hệ" : "Buyers & channels"}
            </h1>
            <p className="mt-1.5 text-[13px] text-[#777D8C]">
              {isVietnamese
                ? "Danh sách công ty kèm kênh liên hệ tìm được từ nguồn công khai. Xuất CSV chỉ gồm những dòng đã qua kiểm tra."
                : "Companies with contact channels found in public sources. The CSV export contains only rows that passed the policy check."}
            </p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || filteredContactCount === 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#5D53E8] px-4 text-[12px] font-bold text-white shadow-[0_7px_15px_rgba(85,73,218,0.2)] transition hover:bg-[#4E44D7] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={15} />
            {exporting ? (isVietnamese ? "Đang xuất…" : "Exporting…") : isVietnamese ? `Xuất CSV (${filteredContactCount})` : `Export CSV (${filteredContactCount})`}
          </button>
        </div>

        {!live ? (
          <div className="mb-4 rounded-2xl border border-[#E6E3FA] bg-[#FAF9FF] px-4 py-3 text-[11px] text-[#6C6A8A]">
            {isVietnamese
              ? "Đang hiển thị dữ liệu mẫu. Kết nối Supabase và chạy research để thấy dữ liệu thật của workspace."
              : "Showing sample data. Connect Supabase and run research to see your workspace's own data."}
          </div>
        ) : null}

        <section className="rounded-[21px] border border-[#EAECF1] bg-white p-4 shadow-[0_8px_28px_rgba(31,38,56,0.025)] sm:p-5">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-[380px] flex-1">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9DA2AF]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isVietnamese ? "Tìm theo tên, quốc gia, ngành…" : "Search by name, country, industry…"}
                className="h-10 w-full rounded-xl border border-[#E3E6ED] bg-[#FAFBFC] pl-9 pr-3 text-[12px] outline-none focus:border-[#9187EE] focus:bg-white"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9DA2AF]" />
                <select
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className="h-10 appearance-none rounded-xl border border-[#E4E6EC] bg-white pl-8 pr-8 text-[11px] font-semibold text-[#646A79] outline-none focus:border-[#9187EE]"
                >
                  <option value="">{isVietnamese ? "Tất cả quốc gia" : "All countries"}</option>
                  {countries.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9DA2AF]" />
              </div>
              <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E4E6EC] px-3 text-[11px] font-bold text-[#646A79]">
                <input type="checkbox" checked={onlyWithPeople} onChange={(event) => setOnlyWithPeople(event.target.checked)} className="h-3.5 w-3.5 accent-[#5D53E8]" />
                {isVietnamese ? "Chỉ công ty có tên người" : "Only with named people"}
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#A0A5B2]">
                  <th className="border-b border-[#EDF0F4] pb-3 pl-2">{isVietnamese ? "Công ty" : "Company"}</th>
                  <th className="border-b border-[#EDF0F4] pb-3">{isVietnamese ? "Kênh xuất được" : "Exportable channels"}</th>
                  <th className="border-b border-[#EDF0F4] pb-3">{isVietnamese ? "Người liên hệ" : "Named people"}</th>
                  <th className="border-b border-[#EDF0F4] pb-3">{isVietnamese ? "Thấy lần cuối" : "Last seen"}</th>
                  <th className="border-b border-[#EDF0F4] pb-3 pr-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((buyer) => {
                  const rows = contactsByBuyer.get(buyer.id) ?? [];
                  const isOpen = expanded === buyer.id;
                  return (
                    <Fragment key={buyer.id}>
                      <tr className="group cursor-pointer hover:bg-[#FAFBFD]" onClick={() => setExpanded(isOpen ? null : buyer.id)}>
                        <td className="border-b border-[#F0F1F4] py-3.5 pl-2">
                          <div className="flex items-center gap-3">
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#F0EEFF] text-[#5D53E8]">
                              <Building2 size={16} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-bold text-[#363947]">{buyer.name}</p>
                              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#9095A3]">
                                <Globe2 size={11} />
                                {[buyer.country, buyer.industry].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="border-b border-[#F0F1F4] py-3.5">
                          <span className="text-[12px] font-bold text-[#4E5361]">{buyer.exportableChannels}</span>
                          <span className="ml-2 text-[10px] text-[#9095A3]">
                            {buyer.verifiedChannels > 0 ? `${buyer.verifiedChannels} ${isVietnamese ? "đã xác minh" : "verified"}` : ""}
                          </span>
                        </td>
                        <td className="border-b border-[#F0F1F4] py-3.5">
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-[#5F6472]">
                            <Users size={13} className="text-[#9DA2AF]" />
                            {buyer.namedPeople}
                          </span>
                        </td>
                        <td className="border-b border-[#F0F1F4] py-3.5 text-[11px] text-[#7B8190]">{formatDate(buyer.lastContactSeenAt ?? buyer.lastSignalAt)}</td>
                        <td className="border-b border-[#F0F1F4] py-3.5 pr-2 text-right">
                          <ChevronRight size={15} className={`inline text-[#A1A6B2] transition ${isOpen ? "rotate-90" : ""}`} />
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={5} className="border-b border-[#F0F1F4] bg-[#FCFCFE] px-3 py-3">
                            {rows.length === 0 ? (
                              <p className="text-[11px] text-[#8B90A0]">
                                {isVietnamese ? "Chưa có kênh nào qua được kiểm tra cho công ty này." : "No channel for this company has passed the check yet."}
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {rows.map((contact) => {
                                  const Icon = CHANNEL_ICON[contact.channelType] ?? Globe2;
                                  return (
                                    <div key={`${contact.channelType}-${contact.value}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#EDEFF4] bg-white px-3 py-2">
                                      <Icon size={14} className="text-[#6C63E9]" />
                                      <span className="text-[11px] font-bold text-[#3B3F4F]">{contact.value}</span>
                                      {contact.personName ? (
                                        <span className="text-[10px] text-[#7B8190]">
                                          {contact.personName}
                                          {contact.jobTitle ? ` · ${contact.jobTitle}` : ""}
                                        </span>
                                      ) : null}
                                      <span className="ml-auto flex items-center gap-1.5">
                                        <span className="rounded-full bg-[#F4F5F8] px-1.5 py-0.5 text-[8px] font-semibold text-[#6C7280]">{contact.identityMatch}</span>
                                        <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${contact.isVerified ? "bg-[#EAF8F3] text-[#168466]" : "bg-[#FFF4E5] text-[#C37B18]"}`}>
                                          {contact.confidenceLabel}
                                        </span>
                                        {/* Chỉ hiện khi một dịch vụ đã kiểm số này có WhatsApp.
                                            Chưa kiểm thì không có nút, không có suy đoán. */}
                                        {contact.whatsappUrl ? (
                                          <a
                                            href={contact.whatsappUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-[9px] font-bold text-[#1E9E57] hover:text-[#157A42]"
                                            title={contact.whatsappCheckedBy ? `${isVietnamese ? "Kiểm bởi" : "Checked by"} ${contact.whatsappCheckedBy}` : undefined}
                                            onClick={(event) => event.stopPropagation()}
                                          >
                                            <MessageCircle size={10} /> {isVietnamese ? "Nhắn WhatsApp" : "WhatsApp"}
                                          </a>
                                        ) : null}
                                        {contact.sourceUrl ? (
                                          <a
                                            href={contact.sourceUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-[9px] font-bold text-[#6257E7] hover:text-[#4335CB]"
                                            onClick={(event) => event.stopPropagation()}
                                          >
                                            {isVietnamese ? "Nguồn" : "Source"} <ExternalLink size={10} />
                                          </a>
                                        ) : null}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-[#8B90A0]">
              {isVietnamese ? "Không có công ty nào khớp bộ lọc." : "No company matches these filters."}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0F1F4] pt-3 text-[10px] text-[#9095A3]">
            <span>
              {filtered.length} {isVietnamese ? "công ty" : "companies"} · {filteredContactCount} {isVietnamese ? "dòng xuất được" : "exportable rows"}
            </span>
            {withheldTotal > 0 ? (
              <span>
                {withheldTotal} {isVietnamese ? "kênh bị giữ lại (chưa kiểm mailbox, catch-all hoặc hết hạn)" : "channels withheld (mailbox unchecked, catch-all or expired)"}
              </span>
            ) : null}
          </div>
        </section>
      </div>

      {notice ? <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#2E2B47] px-4 py-3 text-[12px] font-medium text-white shadow-xl">{notice}</div> : null}
    </WorkspaceShell>
  );
}
