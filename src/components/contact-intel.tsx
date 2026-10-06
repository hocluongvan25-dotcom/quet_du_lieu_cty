"use client";

import { Copy, Mail, Phone, UserRound } from "lucide-react";

import type { AppLocale } from "@/lib/i18n";
import type { DecisionMaker } from "@/lib/demo-data";

/**
 * What the report shows about people: who they are, their role, and the public
 * channels found for them, each with its own icon and a copy button.
 *
 * Status marks do not belong here: no certainty / identity / policy badges and no
 * "source: LinkedIn profile" line. Those labels stay in the model, the buyers list
 * and the CSV; the report shows content and links.
 */

function ChannelIcon({ type }: { type: DecisionMaker["channels"][number]["type"] }) {
  if (type === "email") return <Mail size={14} className="text-[#6C63E9]" />;
  if (type === "phone") return <Phone size={14} className="text-[#3E9BC4]" />;
  return <UserRound size={14} className="text-[#5C70CC]" />;
}

/** A profile slug is a link; a bare value is not. */
function channelHref(value: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return value.includes(".") ? `https://${value}` : null;
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
            {isVietnamese ? "Thông tin tìm được từ nguồn công khai." : "Found in public sources."}
          </p>
        </div>
        <span className="rounded-full bg-[#F0EEFF] px-2 py-1 text-[10px] font-bold text-[#6257E7]">{people.length} {isVietnamese ? "người" : "people"}</span>
      </div>

      <div className="mt-3 space-y-2">
        {people.map((person) => (
          <article key={person.id} className="min-w-0 rounded-xl border border-[#E9EBF0] bg-white p-3.5">
            <h4 className="text-[13px] font-bold text-[#333747]">{person.name}</h4>
            {person.title ? <p className="mt-0.5 text-[11px] font-semibold text-[#5D6371]">{person.title}</p> : null}
            {person.department ? <p className="mt-0.5 text-[10px] text-[#8A90A0]">{person.department}</p> : null}
            {person.previousRole ? <p className="mt-0.5 text-[10px] text-[#8A90A0]">{person.previousRole}</p> : null}

            {person.channels.length > 0 ? (
              <div className="mt-2.5 space-y-1.5">
                {person.channels.map((channel) => {
                  const href = channelHref(channel.value);
                  return (
                    <div key={`${person.id}-${channel.value}`} className="flex items-center gap-2 rounded-lg bg-[#F8F9FC] px-2.5 py-2">
                      <ChannelIcon type={channel.type} />
                      <div className="min-w-0 flex-1">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" className="block truncate text-[11px] font-bold text-[#5D53E8] hover:text-[#4335CB] hover:underline">
                            {channel.value}
                          </a>
                        ) : (
                          <p className="truncate text-[11px] font-bold text-[#3B3F4F]">{channel.value}</p>
                        )}
                      </div>
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
                  );
                })}
              </div>
            ) : null}

            {person.lastSeenAt ? <p className="mt-2.5 text-[10px] text-[#A1A5B1]">{isVietnamese ? "Thấy lần cuối" : "Last seen"} {person.lastSeenAt}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
