"use client";

import { useState } from "react";
import { AlertTriangle, Crown, DoorOpen } from "lucide-react";

import { BUYER_TYPES, SECTORS, playbooksForSector, type BuyerTypeKey, type SectorKey } from "@/lib/target-roles";
import type { AppLocale } from "@/lib/i18n";

/**
 * Trả lời câu hỏi "người nào đứng đầu" ngay trên màn hình, theo ngành và theo
 * loại người mua — thay vì để người dùng tự đoán.
 */
export function TargetRolesPanel({ locale }: { locale: AppLocale }) {
  const isVietnamese = locale === "vi";
  const [sector, setSector] = useState<SectorKey>("agri");
  const available = playbooksForSector(sector);
  const [buyerType, setBuyerType] = useState<BuyerTypeKey>(available[0]?.buyerType ?? "manufacturer");
  const playbook = available.find((item) => item.buyerType === buyerType) ?? available[0];

  const sectorLabel = SECTORS.find((item) => item.key === sector);

  return (
    <section className="rounded-[21px] border border-[#E9E8F5] bg-white p-5 shadow-[0_8px_28px_rgba(31,38,56,0.025)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9B9FAE]">{isVietnamese ? "Tìm ai trước" : "Who to approach first"}</p>
          <h2 className="mt-1.5 text-[16px] font-bold text-[#303342]">{isVietnamese ? "Vai trò đứng đầu theo ngành" : "Lead role by sector"}</h2>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F0EEFF] text-[#5D53E8]">
          <Crown size={19} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {SECTORS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setSector(item.key);
              const next = playbooksForSector(item.key)[0];
              if (next) setBuyerType(next.buyerType);
            }}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${sector === item.key ? "bg-[#5D53E8] text-white" : "bg-[#F4F5F8] text-[#6C7280] hover:bg-[#ECEDF3]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {sectorLabel ? <p className="mt-1.5 text-[10px] text-[#A1A5B1]">{sectorLabel.examples}</p> : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {BUYER_TYPES.filter((type) => available.some((item) => item.buyerType === type.key)).map((type) => (
          <button
            key={type.key}
            type="button"
            onClick={() => setBuyerType(type.key)}
            className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition ${buyerType === type.key ? "bg-[#EEF0FF] text-[#4E44D7] ring-1 ring-[#C9C2FF]" : "text-[#7C8290] hover:bg-[#F6F7FA]"}`}
          >
            {type.label}
          </button>
        ))}
      </div>

      {playbook ? (
        <div className="mt-4">
          <p className="text-[11px] font-bold text-[#4B5060]">{playbook.headline}</p>
          {playbook.note ? <p className="mt-1.5 rounded-lg bg-[#FFF8ED] px-2.5 py-2 text-[10px] leading-4 text-[#A9701A]">{playbook.note}</p> : null}

          <ol className="mt-3 space-y-2">
            {playbook.roles.map((role) => (
              <li key={role.title} className="rounded-xl border border-[#EDEFF4] bg-[#FBFCFE] p-3">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${role.rank === 1 ? "bg-[#EAF8F3] text-[#168466]" : "bg-[#F0F1F5] text-[#6C7280]"}`}>{role.rank}</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[#333747]">{role.title}</p>
                    <p className="text-[10px] text-[#8A90A0]">{role.titleVi}</p>
                    {role.gatekeeper ? (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[9px] font-bold text-[#C37B18]">
                        <AlertTriangle size={10} /> {isVietnamese ? "Người gác cửa — có quyền phủ quyết" : "Gatekeeper — can veto"}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[10px] leading-4 text-[#6B7180]">{role.why}</p>
                    <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-4 text-[#7C8290]">
                      <DoorOpen size={11} className="mt-0.5 shrink-0 text-[#8A6BD1]" />
                      <span>
                        <span className="font-semibold text-[#5D6371]">{isVietnamese ? "Đường vào: " : "Route: "}</span>
                        {role.route}
                      </span>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
