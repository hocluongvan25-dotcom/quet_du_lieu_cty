"use client";

import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CircleHelp,
  Clock,
  Copy,
  ExternalLink,
  Hand,
  Mail,
  MailQuestion,
  Phone,
  Send,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import type { AppLocale } from "@/lib/i18n";
import type { Certainty, ChannelPolicy, DecisionMaker, IdentityMatch } from "@/lib/demo-data";

/**
 * What the report shows about people and channels: who they are, their role, and
 * the public channels found for them — each with its source and its labels.
 *
 * The system finds and labels. Deciding whom to contact, and how, is the user's
 * job: nothing here recommends an approach or a priority order.
 *
 * Labels render as small icons with the full wording on hover. A row of pills
 * ("Đã thấy công bố", "Cần kiểm tra mailbox") is wider than the value it labels,
 * so on the report the icons carry the meaning and the words stay in the
 * tooltip, in the list view and in the CSV export.
 */

const CERTAINTY_LABELS: Record<Certainty, { vi: string; en: string }> = {
  confirmed: { vi: "Đã thấy công bố", en: "Seen published" },
  probable: { vi: "Chưa kiểm lại", en: "Not re-checked" },
  inferred: { vi: "Suy luận theo pattern", en: "Pattern-inferred" },
};

const CERTAINTY_ICONS: Record<Certainty, { Icon: typeof BadgeCheck; tone: string }> = {
  confirmed: { Icon: BadgeCheck, tone: "text-[#168466]" },
  probable: { Icon: Clock, tone: "text-[#C37B18]" },
  inferred: { Icon: CircleHelp, tone: "text-[#C2445C]" },
};

const IDENTITY_LABELS: Record<IdentityMatch, { vi: string; en: string }> = {
  person: { vi: "Cá nhân", en: "Person" },
  department: { vi: "Bộ phận", en: "Department" },
  company_general: { vi: "Chung công ty", en: "Company" },
  unknown: { vi: "Chưa rõ ai", en: "Unattributed" },
};

const IDENTITY_ICONS: Record<IdentityMatch, { Icon: typeof BadgeCheck; tone: string }> = {
  person: { Icon: UserRound, tone: "text-[#5C70CC]" },
  department: { Icon: Building2, tone: "text-[#6C7280]" },
  company_general: { Icon: BriefcaseBusiness, tone: "text-[#6C7280]" },
  unknown: { Icon: CircleHelp, tone: "text-[#A0A5B1]" },
};

const POLICY_LABELS: Record<ChannelPolicy, { vi: string; en: string }> = {
  outreach_ready: { vi: "Gửi được", en: "Ready to send" },
  needs_mailbox_check: { vi: "Cần kiểm tra mailbox", en: "Mailbox unchecked" },
  manual_contact_only: { vi: "Liên hệ thủ công", en: "Manual contact only" },
  requires_override: { vi: "Cần xác nhận trước", en: "Needs confirmation" },
};

const POLICY_ICONS: Record<ChannelPolicy, { Icon: typeof BadgeCheck; tone: string }> = {
  outreach_ready: { Icon: Send, tone: "text-[#168466]" },
  needs_mailbox_check: { Icon: MailQuestion, tone: "text-[#C37B18]" },
  manual_contact_only: { Icon: Hand, tone: "text-[#4E5FC4]" },
  requires_override: { Icon: ShieldAlert, tone: "text-[#C37B18]" },
};

function LabelIcon({ Icon, tone, label, size }: { Icon: typeof BadgeCheck; tone: string; label: string; size: number }) {
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center">
      <Icon size={size} className={tone} />
    </span>
  );
}

/**
 * Provenance of one channel: how sure we are it exists, who it belongs to, and
 * what may be done with it — one icon each, full wording on hover.
 */
export function ProvenanceBadge({ locale, certainty, identityMatch, policy, size = 12 }: { locale: AppLocale; certainty?: Certainty; identityMatch?: IdentityMatch; policy?: ChannelPolicy; size?: number }) {
  const isVietnamese = locale === "vi";
  const pick = (vi: string, en: string) => (isVietnamese ? vi : en);

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {certainty ? <LabelIcon Icon={CERTAINTY_ICONS[certainty].Icon} tone={CERTAINTY_ICONS[certainty].tone} label={pick(CERTAINTY_LABELS[certainty].vi, CERTAINTY_LABELS[certainty].en)} size={size} /> : null}
      {identityMatch ? <LabelIcon Icon={IDENTITY_ICONS[identityMatch].Icon} tone={IDENTITY_ICONS[identityMatch].tone} label={pick(IDENTITY_LABELS[identityMatch].vi, IDENTITY_LABELS[identityMatch].en)} size={size} /> : null}
      {policy ? <LabelIcon Icon={POLICY_ICONS[policy].Icon} tone={POLICY_ICONS[policy].tone} label={pick(POLICY_LABELS[policy].vi, POLICY_LABELS[policy].en)} size={size} /> : null}
    </span>
  );
}

function ChannelIcon({ type }: { type: DecisionMaker["channels"][number]["type"] }) {
  if (type === "email") return <Mail size={14} className="text-[#6C63E9]" />;
  if (type === "phone") return <Phone size={14} className="text-[#3E9BC4]" />;
  return <UserRound size={14} className="text-[#5C70CC]" />;
}

export function PeoplePanel({ locale, people, onCopy }: { locale: AppLocale; people: DecisionMaker[]; onCopy: (value: string, label: string) => void }) {
  const isVietnamese = locale === "vi";
  if (people.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-[#333747]">{isVietnamese ? "Người liên quan" : "People"}</h3>
          <p className="mt-1 text-[11px] text-[#8A90A0]">
            {isVietnamese ? "Thông tin tìm được từ nguồn công khai, kèm nguồn và nhãn tin cậy." : "Found in public sources, with source and confidence label."}
          </p>
        </div>
        <span className="rounded-full bg-[#F0EEFF] px-2 py-1 text-[10px] font-bold text-[#6257E7]">{people.length} {isVietnamese ? "người" : "people"}</span>
      </div>

      <div className="mt-3 space-y-2">
        {people.map((person) => (
          <article key={person.id} className="min-w-0 rounded-xl border border-[#E9EBF0] bg-white p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[13px] font-bold text-[#333747]">{person.name}</h4>
              <ProvenanceBadge locale={locale} certainty={person.certainty} identityMatch={person.identityMatch} size={13} />
            </div>
            <p className="mt-0.5 text-[11px] font-semibold text-[#5D6371]">{person.title}</p>
            <p className="mt-0.5 text-[10px] text-[#8A90A0]">{person.department}</p>
            {person.previousRole ? <p className="mt-0.5 text-[10px] text-[#8A90A0]">{person.previousRole}</p> : null}

            <div className="mt-2.5 space-y-1.5">
              {person.channels.map((channel) => (
                <div key={`${person.id}-${channel.value}`} className="flex items-center gap-2 rounded-lg bg-[#F8F9FC] px-2.5 py-2">
                  <ChannelIcon type={channel.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-bold text-[#3B3F4F]">{channel.value}</p>
                  </div>
                  <ProvenanceBadge locale={locale} policy={channel.policy} />
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
          </article>
        ))}
      </div>
    </section>
  );
}
