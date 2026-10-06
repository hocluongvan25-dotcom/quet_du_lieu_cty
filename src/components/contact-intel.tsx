"use client";

import { AlertTriangle, BadgeCheck, Copy, ExternalLink, HelpCircle, Info, Mail, Phone, ShieldQuestion, UserRound, XCircle } from "lucide-react";

import type { AppLocale } from "@/lib/i18n";
import type { Certainty, ChannelPolicy, DecisionMaker, IdentityMatch, IntelNote } from "@/lib/demo-data";

/**
 * The part of a report a seller actually acts on: who to contact, how sure we
 * are, and which channels are safe to use. Every badge here is derived from the
 * same rules the database enforces (`contact_export_policy`), so the UI can
 * never look more confident than the data is.
 */

const CERTAINTY_LABELS: Record<Certainty, { vi: string; en: string }> = {
  confirmed: { vi: "Đã thấy công bố", en: "Seen published" },
  probable: { vi: "Chưa kiểm lại", en: "Not re-checked" },
  inferred: { vi: "Suy luận theo pattern", en: "Pattern-inferred" },
};

const CERTAINTY_TONE: Record<Certainty, string> = {
  confirmed: "bg-[#EAF8F3] text-[#168466]",
  probable: "bg-[#FFF4E5] text-[#C37B18]",
  inferred: "bg-[#FDECEF] text-[#C2445C]",
};

const IDENTITY_LABELS: Record<IdentityMatch, { vi: string; en: string }> = {
  person: { vi: "Cá nhân", en: "Person" },
  department: { vi: "Bộ phận", en: "Department" },
  company_general: { vi: "Chung công ty", en: "Company" },
  unknown: { vi: "Chưa rõ ai", en: "Unattributed" },
};

const POLICY_LABELS: Record<ChannelPolicy, { vi: string; en: string }> = {
  outreach_ready: { vi: "Gửi được", en: "Ready to send" },
  needs_mailbox_check: { vi: "Cần kiểm tra mailbox trước khi gửi", en: "Check mailbox before sending" },
  manual_contact_only: { vi: "Liên hệ thủ công", en: "Manual contact only" },
  requires_override: { vi: "Cần bạn xác nhận trước", en: "Needs your confirmation" },
};

/** Ranking is use-case dependent, so the report must say which use case it ranked for. */
const OFFER_LABELS: Record<"ingredients" | "packaging" | "finished_product", { vi: string; en: string }> = {
  ingredients: { vi: "Nguyên liệu thô", en: "Raw materials" },
  packaging: { vi: "Bao bì / vật tư đóng gói", en: "Packaging" },
  finished_product: { vi: "Hàng thành phẩm / private label", en: "Finished goods / private label" },
};

const POLICY_TONE: Record<ChannelPolicy, string> = {
  outreach_ready: "bg-[#EAF8F3] text-[#168466]",
  needs_mailbox_check: "bg-[#FFF4E5] text-[#C37B18]",
  manual_contact_only: "bg-[#EEF2FF] text-[#4E5FC4]",
  requires_override: "bg-[#FFF4E5] text-[#C37B18]",
};

/** Compact provenance badge for a business channel: how sure, and what may be done with it. */
export function ProvenanceBadge({ locale, certainty, identityMatch, policy }: { locale: AppLocale; certainty?: Certainty; identityMatch?: IdentityMatch; policy?: ChannelPolicy }) {
  const isVietnamese = locale === "vi";
  return (
    <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
      {certainty ? <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${CERTAINTY_TONE[certainty]}`}>{CERTAINTY_LABELS[certainty][isVietnamese ? "vi" : "en"]}</span> : null}
      {identityMatch ? <span className="rounded-full bg-[#F4F5F8] px-1.5 py-0.5 text-[8px] font-semibold text-[#6C7280]">{IDENTITY_LABELS[identityMatch][isVietnamese ? "vi" : "en"]}</span> : null}
      {policy ? <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${POLICY_TONE[policy]}`}>{POLICY_LABELS[policy][isVietnamese ? "vi" : "en"]}</span> : null}
    </span>
  );
}

function ChannelIcon({ type }: { type: DecisionMaker["channels"][number]["type"] }) {
  if (type === "email") return <Mail size={14} className="text-[#6C63E9]" />;
  if (type === "phone") return <Phone size={14} className="text-[#3E9BC4]" />;
  return <UserRound size={14} className="text-[#5C70CC]" />;
}

export function PeoplePanel({ locale, people, offer, onCopy }: { locale: AppLocale; people: DecisionMaker[]; offer?: "ingredients" | "packaging" | "finished_product"; onCopy: (value: string, label: string) => void }) {
  const isVietnamese = locale === "vi";
  if (people.length === 0) return null;
  const offerLabel = offer ? OFFER_LABELS[offer][isVietnamese ? "vi" : "en"] : null;

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-[#333747]">{isVietnamese ? "Đầu mối liên hệ" : "Contacts"}</h3>
          <p className="mt-1 text-[11px] text-[#8A90A0]">
            {isVietnamese
              ? "Người ra quyết định / bộ phận, xếp theo mức liên quan. Nhãn tin cậy đi kèm từng giá trị."
              : "Decision makers and departments, ranked by relevance. Every value carries its confidence label."}
            {offerLabel ? (
              <>
                {" "}
                <span className="font-semibold text-[#6D63E8]">
                  {isVietnamese ? "Xếp hạng cho:" : "Ranked for:"} {offerLabel}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <span className="rounded-full bg-[#F0EEFF] px-2 py-1 text-[10px] font-bold text-[#6257E7]">{people.length} {isVietnamese ? "đầu mối" : "contacts"}</span>
      </div>

      <div className="mt-3 space-y-2">
        {people.map((person) => (
          <article key={person.id} className="rounded-xl border border-[#E9EBF0] bg-white p-3.5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#F0EEFF] text-[11px] font-bold text-[#5D53E8]">{person.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-[13px] font-bold text-[#333747]">{person.name}</h4>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${CERTAINTY_TONE[person.certainty]}`}>{CERTAINTY_LABELS[person.certainty][isVietnamese ? "vi" : "en"]}</span>
                  <span className="rounded-full bg-[#F4F5F8] px-2 py-0.5 text-[9px] font-semibold text-[#6C7280]">{IDENTITY_LABELS[person.identityMatch][isVietnamese ? "vi" : "en"]}</span>
                </div>
                <p className="mt-0.5 text-[11px] font-semibold text-[#5D6371]">{person.title} · {person.department}</p>
                {person.previousRole ? <p className="mt-0.5 text-[10px] text-[#8A90A0]">{person.previousRole}</p> : null}
                <p className="mt-2 text-[11px] leading-5 text-[#6B7180]">
                  <span className="font-semibold text-[#4B5060]">{isVietnamese ? "Vì sao: " : "Why: "}</span>
                  {person.relevance}
                </p>
                {person.caution ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-[#FFF8ED] px-2.5 py-1.5 text-[10px] leading-4 text-[#A9701A]">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {person.caution}
                  </p>
                ) : null}

                <div className="mt-2.5 space-y-1.5">
                  {person.channels.map((channel) => (
                    <div key={`${person.id}-${channel.value}`} className="flex items-center gap-2 rounded-lg bg-[#F8F9FC] px-2.5 py-2">
                      <ChannelIcon type={channel.type} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-bold text-[#3B3F4F]">{channel.value}</p>
                        {channel.note ? <p className="mt-0.5 text-[10px] leading-4 text-[#8A90A0]">{channel.note}</p> : null}
                      </div>
                      <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold sm:inline ${POLICY_TONE[channel.policy]}`}>{POLICY_LABELS[channel.policy][isVietnamese ? "vi" : "en"]}</span>
                      <button
                        type="button"
                        onClick={() => onCopy(channel.value, person.name)}
                        title={isVietnamese ? "Sao chép" : "Copy"}
                        aria-label={`Copy ${channel.value}`}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#E3E6EC] text-[#6257E7] transition hover:border-[#D7D1FF] hover:bg-[#F6F4FF]"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <a href={person.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#6257E7] hover:text-[#4335CB]">
                    <BadgeCheck size={12} /> {person.sourceLabel} <ExternalLink size={11} />
                  </a>
                  <span className="text-[9px] text-[#A1A5B1]">{isVietnamese ? "Thấy lần cuối" : "Last seen"} {person.lastSeenAt}</span>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function IntelNotesPanel({ locale, notes }: { locale: AppLocale; notes: IntelNote[] }) {
  const isVietnamese = locale === "vi";
  if (notes.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2">
        <ShieldQuestion size={15} className="text-[#8A6BD1]" />
        <h3 className="text-[14px] font-bold text-[#333747]">{isVietnamese ? "Không tìm thấy & đã loại trừ" : "Not found & excluded"}</h3>
      </div>
      <p className="mt-1 text-[11px] text-[#8A90A0]">
        {isVietnamese
          ? "Ghi rõ thứ không tìm được thay vì suy diễn, và loại những gì trông giống nhưng không phải."
          : "Absence is recorded instead of invented, and look-alikes are excluded."}
      </p>
      <div className="mt-3 space-y-2">
        {notes.map((note) => (
          <div key={note.label} className="flex items-start gap-2.5 rounded-xl border border-[#EDEAF7] bg-[#FBFAFF] p-3">
            {note.kind === "not_found" ? <HelpCircle size={15} className="mt-0.5 shrink-0 text-[#8A6BD1]" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-[#C2445C]" />}
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#3B3F4F]">{note.label}</p>
              <p className="mt-1 text-[10px] leading-4 text-[#757B8A]">{note.detail}</p>
              {note.sourceUrl ? (
                <a href={note.sourceUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-[#6257E7] hover:text-[#4335CB]">
                  <Info size={11} /> {isVietnamese ? "Xem nguồn đã đối chiếu" : "View the source checked"} <ExternalLink size={10} />
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
