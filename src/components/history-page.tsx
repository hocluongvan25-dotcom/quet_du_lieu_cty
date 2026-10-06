"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, History, MinusCircle, PencilLine, PlusCircle } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { describeChange, groupChanges } from "@/lib/data/activity-view";
import type { ReportChange } from "@/lib/data/workspace-types";
import { getCopy, type AppLocale } from "@/lib/i18n";

const DEMO_EVENTS: Record<AppLocale, Array<[string, string, string, string]>> = {
  vi: [
    ["Hôm nay, 09:42", "Nova Distribution Ltd.", "Đã phát hiện email kinh doanh mới", "sales@novadistribution.example đã được xác minh từ trang Contact."],
    ["02/10/2026", "Velar Foods GmbH", "Confidence giảm từ 82 xuống 67", "Phát hiện hai company profiles có tên và quốc gia gần giống nhau."],
    ["28/09/2026", "Hoshi Components Co.", "Website catalog được cập nhật", "Đã thay đổi URL catalogue sản phẩm và giữ snapshot trước đó."],
  ],
  en: [
    ["Today, 09:42", "Nova Distribution Ltd.", "New business email detected", "sales@novadistribution.example was verified from the Contact page."],
    ["02 Oct 2026", "Velar Foods GmbH", "Confidence changed from 82 to 67", "Two company profiles with similar names and countries were discovered."],
    ["28 Sep 2026", "Hoshi Components Co.", "Website catalogue updated", "The product catalogue URL changed and the previous snapshot was retained."],
  ],
};

const KIND_ICONS = {
  added: PlusCircle,
  removed: MinusCircle,
  changed: PencilLine,
} as const;

const KIND_TONES = {
  added: "text-[#209170]",
  removed: "text-[#C4574A]",
  changed: "text-[#6257E7]",
} as const;

export function HistoryPage({
  locale,
  changes,
  live,
}: {
  locale: AppLocale;
  changes: ReportChange[];
  live: boolean;
}) {
  const t = getCopy(locale);
  const groups = useMemo(() => groupChanges(changes), [changes]);
  const prefix = `/${locale}`;

  return (
    <WorkspaceShell active="history">
      <div className="mx-auto max-w-[1000px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9">
        <div className="mb-7">
          <h1 className="text-[27px] font-bold tracking-[-0.045em] text-[#282B39] sm:text-[31px]">{t.pages.history.title}</h1>
          <p className="mt-1.5 text-[13px] text-[#777D8C]">{t.pages.history.subtitle}</p>
        </div>

        <section className="rounded-[21px] border border-[#EAECF1] bg-white p-5 sm:p-6">
          <div className="mb-6 flex items-center gap-2">
            <div className="rounded-lg bg-[#F0EEFF] p-2 text-[#6359E8]">
              <History size={17} />
            </div>
            <div>
              <p className="text-[13px] font-bold text-[#343747]">{t.history.timeline}</p>
              <p className="mt-0.5 text-[10px] text-[#8C92A0]">{t.history.timelineText}</p>
            </div>
            <span className="ml-auto rounded-full bg-[#F1F2F5] px-2.5 py-1 text-[10px] font-bold text-[#6C7280]">
              {live ? t.history.changeCount.replace("{count}", String(changes.length)) : t.history.demoBadge}
            </span>
          </div>

          {live ? (
            groups.length === 0 ? (
              <p className="rounded-xl bg-[#FAFBFC] px-4 py-10 text-center text-[12px] text-[#8B90A0]">{t.history.empty}</p>
            ) : (
              <div className="relative ml-3 border-l border-[#E4E6EF] pl-6">
                {groups.map((group, index) => (
                  <article key={group.key} className="relative pb-7 last:pb-0">
                    <span className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-[3px] border-white ${index === 0 ? "bg-[#665BE8] shadow-[0_0_0_1px_#dcd8ff]" : "bg-[#B8BDC8]"}`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold text-[#999FAD]">{group.detectedLabel}</span>
                      <span className="rounded-full bg-[#F3F4F7] px-2 py-0.5 text-[9px] font-bold text-[#6F7584]">{group.companyName}</span>
                      <span className="rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[9px] font-bold text-[#4B6DE3]">
                        {t.history.changesInRun.replace("{count}", String(group.changes.length))}
                      </span>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {group.changes.map((change) => {
                        const Icon = KIND_ICONS[change.kind];
                        return (
                          <li key={change.id} className="flex items-start gap-2 text-[12px] leading-5 text-[#4A4F5E]">
                            <Icon size={14} className={`mt-0.5 shrink-0 ${KIND_TONES[change.kind]}`} />
                            <span>{describeChange(change, locale)}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {group.changes.some((change) => change.reportId) ? (
                      <Link href={`${prefix}/reports`} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#6257E7] hover:text-[#4439C9]">
                        {t.history.openSnapshot} <ArrowUpRight size={12} />
                      </Link>
                    ) : (
                      <p className="mt-2 text-[10px] text-[#9BA0AE]">{t.history.snapshotGone}</p>
                    )}
                  </article>
                ))}
              </div>
            )
          ) : (
            <div className="relative ml-3 border-l border-[#E4E6EF] pl-6">
              {DEMO_EVENTS[locale].map((event, index) => (
                <article key={event[0]} className="relative pb-7 last:pb-0">
                  <span className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-[3px] border-white ${index === 0 ? "bg-[#665BE8] shadow-[0_0_0_1px_#dcd8ff]" : "bg-[#B8BDC8]"}`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold text-[#999FAD]">{event[0]}</span>
                    <span className="rounded-full bg-[#F3F4F7] px-2 py-0.5 text-[9px] font-bold text-[#6F7584]">{event[1]}</span>
                  </div>
                  <h3 className="mt-2 text-[13px] font-bold text-[#383B4A]">{event[2]}</h3>
                  <p className="mt-1 max-w-[650px] text-[11px] leading-5 text-[#7B8190]">{event[3]}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        {live ? (
          <p className="mt-4 text-[11px] leading-5 text-[#8A90A0]">{t.history.retentionNote}</p>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
