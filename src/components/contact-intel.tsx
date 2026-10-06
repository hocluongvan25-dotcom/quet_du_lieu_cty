"use client";

import type { AppLocale } from "@/lib/i18n";
import type { DecisionMaker } from "@/lib/demo-data";

/**
 * What the report shows about people: who they are, their role, and the public
 * channels found for them. Content only — no icons, no badges, no notices: each
 * value links to where it was seen, and the report's source block lists the pages.
 *
 * The system finds and labels. Deciding whom to contact, and how, is the user's
 * job: nothing here recommends an approach or a priority order.
 */

/** A profile slug is a link; a bare value is not. */
function channelHref(value: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return value.includes(".") ? `https://${value}` : null;
}

export function PeoplePanel({ locale, people }: { locale: AppLocale; people: DecisionMaker[] }) {
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
            <p className="mt-0.5 text-[11px] font-semibold text-[#5D6371]">{person.title}</p>
            <p className="mt-0.5 text-[10px] text-[#8A90A0]">{person.department}</p>
            {person.previousRole ? <p className="mt-0.5 text-[10px] text-[#8A90A0]">{person.previousRole}</p> : null}

            {person.channels.length > 0 ? (
              <div className="mt-2 space-y-1">
                {person.channels.map((channel) => {
                  const href = channelHref(channel.value);
                  return (
                    <div key={`${person.id}-${channel.value}`}>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="block truncate text-[11px] font-bold text-[#3B3F4F] hover:text-[#5D53E8] hover:underline">
                          {channel.value}
                        </a>
                      ) : (
                        <span className="block truncate text-[11px] font-bold text-[#3B3F4F]">{channel.value}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {person.lastSeenAt ? <p className="mt-2 text-[10px] text-[#A1A5B1]">{isVietnamese ? "Thấy lần cuối" : "Last seen"} {person.lastSeenAt}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
