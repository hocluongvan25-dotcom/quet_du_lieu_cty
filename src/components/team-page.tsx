"use client";

import { useState } from "react";
import {
  Clock3,
  FileSearch,
  Mail,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { roleLabel } from "@/lib/data/activity-view";
import type { WorkspaceMember } from "@/lib/data/workspace-types";
import { getCopy, type AppLocale } from "@/lib/i18n";

const DEMO_MEMBERS: Array<Pick<WorkspaceMember, "name" | "email" | "role" | "initials" | "reportsCreated" | "joinedLabel">> = [
  { name: "Anh Nguyen", email: "anh@seekora.demo", role: "owner", initials: "AN", reportsCreated: 18, joinedLabel: "01/09/2026" },
  { name: "Mai Le", email: "mai@seekora.demo", role: "member", initials: "ML", reportsCreated: 6, joinedLabel: "12/09/2026" },
  { name: "Thanh Ho", email: "thanh@seekora.demo", role: "viewer", initials: "TH", reportsCreated: 0, joinedLabel: "21/09/2026" },
];

const ROLE_TONES: Record<string, string> = {
  owner: "#218A72",
  admin: "#655BE8",
  member: "#3E7BC4",
  viewer: "#D2803B",
};

type InviteState = { kind: "idle" | "busy" | "done" | "error"; message: string };

export function TeamPage({
  locale,
  members,
  live,
  canInvite,
}: {
  locale: AppLocale;
  members: WorkspaceMember[];
  live: boolean;
  canInvite: boolean;
}) {
  const t = getCopy(locale);
  const [invite, setInvite] = useState<InviteState>({ kind: "idle", message: "" });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [showForm, setShowForm] = useState(false);

  const rows: Array<WorkspaceMember | (typeof DEMO_MEMBERS)[number]> = live ? members : DEMO_MEMBERS;

  const sendInvite = async () => {
    if (!email.includes("@")) {
      setInvite({ kind: "error", message: t.team.emailRule });
      return;
    }

    setInvite({ kind: "busy", message: t.team.sending });
    try {
      const response = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; emailSent?: boolean };

      if (!response.ok || !result.ok) throw new Error(result.error || t.team.inviteFailed);

      setInvite({
        kind: "done",
        message: result.emailSent ? t.team.inviteSent.replace("{email}", email) : t.team.invitePending,
      });
      setEmail("");
      setShowForm(false);
    } catch (caught) {
      setInvite({ kind: "error", message: caught instanceof Error ? caught.message : t.team.inviteFailed });
    }
  };

  return (
    <WorkspaceShell active="team">
      <div className="mx-auto max-w-[1200px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[27px] font-bold tracking-[-0.045em] text-[#282B39] sm:text-[31px]">{t.pages.team.title}</h1>
            <p className="mt-1.5 text-[13px] text-[#777D8C]">{t.pages.team.subtitle}</p>
          </div>
          {canInvite ? (
            <button
              type="button"
              onClick={() => {
                setShowForm((visible) => !visible);
                setInvite({ kind: "idle", message: "" });
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5D53E8] px-4 text-[12px] font-bold text-white hover:bg-[#4E44D7]"
            >
              <Plus size={15} />
              {t.pages.team.action}
            </button>
          ) : null}
        </div>

        {showForm && canInvite ? (
          <section className="mb-5 rounded-[20px] border border-[#E3DEFB] bg-[#FAF9FF] p-5">
            <div className="flex items-center gap-2 text-[#52479B]">
              <UserPlus size={16} />
              <h2 className="text-[13px] font-bold">{t.team.inviteTitle}</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t.auth.emailPlaceholder}
                className="h-11 rounded-xl border border-[#E2E5EC] bg-white px-3.5 text-[13px] outline-none focus:border-[#8A7FF0] focus:ring-4 focus:ring-[#EEEAFE]"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="h-11 rounded-xl border border-[#E2E5EC] bg-white px-3 text-[12px] font-semibold text-[#5F6471] outline-none focus:border-[#8A7FF0]"
              >
                <option value="member">{roleLabel("member", locale)}</option>
                <option value="admin">{roleLabel("admin", locale)}</option>
                <option value="viewer">{roleLabel("viewer", locale)}</option>
              </select>
              <button
                type="button"
                onClick={sendInvite}
                disabled={invite.kind === "busy"}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#5D53E8] px-4 text-[12px] font-bold text-white hover:bg-[#4E44D7] disabled:opacity-60"
              >
                {invite.kind === "busy" ? t.team.sending : t.common.invite}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-[#77738D]">{t.team.inviteHint}</p>
          </section>
        ) : null}

        {invite.message ? (
          <p
            className={`mb-5 rounded-xl px-3.5 py-2.5 text-[11px] leading-4 ${
              invite.kind === "error" ? "bg-[#FFF4F1] text-[#B4543F]" : "bg-[#F0FBF7] text-[#1F7C61]"
            }`}
          >
            {invite.message}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          {rows.map((member) => {
            const tone = ROLE_TONES[member.role] ?? "#655BE8";
            return (
              <section key={member.email ?? member.name} className="rounded-[20px] border border-[#E8EAF0] bg-white p-5 shadow-[0_8px_28px_rgba(31,38,56,0.025)]">
                <div className="flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: `${tone}18`, color: tone }}>
                    {member.initials}
                  </div>
                  <button type="button" className="rounded-lg p-1.5 text-[#9BA0AC] hover:bg-[#F5F6F8]" aria-label="Member actions">
                    <MoreHorizontal size={18} />
                  </button>
                </div>
                <h2 className="mt-4 flex items-center gap-1.5 text-[14px] font-bold text-[#343746]">
                  {member.name}
                  {"isSelf" in member && member.isSelf ? <span className="rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[9px] font-bold text-[#4B6DE3]">{t.team.you}</span> : null}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#898F9E]">
                  <Mail size={12} /> {member.email ?? "-"}
                </p>
                <div className="mt-4 space-y-1.5 border-t border-[#EEF0F4] pt-3 text-[10px] text-[#8D93A0]">
                  <p className="flex items-center gap-1.5">
                    <FileSearch size={12} /> {t.team.reportsCreated.replace("{count}", String(member.reportsCreated))}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Clock3 size={12} /> {t.team.joined.replace("{date}", member.joinedLabel)}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="rounded-full bg-[#F1F0FF] px-2 py-1 text-[10px] font-bold" style={{ color: tone }}>
                    {roleLabel(member.role, locale)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#218B70]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#28A984]" />
                    {t.common.active}
                  </span>
                </div>
              </section>
            );
          })}
        </div>

        <section className="mt-5 rounded-[20px] border border-[#E9E6FB] bg-[#FAF9FF] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <div className="rounded-xl bg-white p-2.5 text-[#6257E7] shadow-sm">
                <ShieldCheck size={18} />
              </div>
              <div>
                <h2 className="text-[13px] font-bold text-[#403D59]">{t.team.accessTitle}</h2>
                <p className="mt-1 max-w-[640px] text-[11px] leading-4 text-[#77738D]">{t.team.accessText}</p>
              </div>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-bold text-[#5F54E6] shadow-sm">
              <UserCheck size={13} /> {t.team.memberCount.replace("{count}", String(rows.length))}
            </span>
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
