"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Anchor, ArrowRight, Check, Container, Link2, LoaderCircle, PackageSearch, ShieldAlert, UserPlus } from "lucide-react";

import type { BuyerListRow } from "@/lib/data/buyer-view";
import type { BuyerCustomsRow, CustomsQueueItem } from "@/lib/customs/view";
import { customsSideFor } from "@/lib/customs/normalize";
import { soleStrongCandidate, suggestBuyerCandidates, type BuyerCandidate } from "@/lib/customs/resolve";
import { MATCH_METHOD_LABELS, MATCH_STATUS_LABELS, type CustomsMatchMethod } from "@/lib/customs/types";
import { ROLE_LABELS_VI } from "@/lib/customs/columns";

/**
 * Hai khối giao diện của phần hải quan.
 *
 *  - `CustomsHistory` — tóm tắt lịch sử và vai nhập khẩu, hiện trong báo cáo
 *    khách hàng và trong dòng mở rộng của danh sách.
 *  - `CustomsQueuePanel` — hàng đợi Resolve: bên nhận hàng trên tờ khai chưa nối
 *    với hồ sơ nào, kèm ứng viên do máy xếp hạng và quyết định của người dùng.
 *
 * Không khối nào tự quyết định nối ai. Ứng viên chỉ là gợi ý có lý do; người
 * dùng bấm thì lệnh mới được gửi đi, và DB vẫn là nơi từ chối cuối cùng.
 */

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function roleLabel(role: CustomsQueueItem["role"], side: CustomsQueueItem["side"], isVietnamese: boolean) {
  const label = ROLE_LABELS_VI[role];
  if (!isVietnamese) return `${role}${side === "importer_side" ? " (importer side)" : ""}`;
  return label;
}

/** Khối tóm tắt lịch sử + vai nhập khẩu. Chỉ hiện khi có lịch sử thật. */
export function CustomsHistory({ customs, isVietnamese }: { customs: BuyerCustomsRow; isVietnamese: boolean }) {
  const facts: { label: string; value: string }[] = [];

  facts.push({
    label: isVietnamese ? "Số lô hàng" : "Shipments",
    value: String(customs.recordsCount),
  });
  if (customs.firstShipment || customs.lastShipment) {
    facts.push({
      label: isVietnamese ? "Khoảng thời gian" : "Period",
      value: `${formatDate(customs.firstShipment)} → ${formatDate(customs.lastShipment)}`,
    });
  }
  if (customs.hsCodes.length > 0) facts.push({ label: isVietnamese ? "Mã HS" : "HS codes", value: customs.hsCodes.join(" · ") });
  if (customs.productSamples.length > 0) facts.push({ label: isVietnamese ? "Hàng hoá" : "Goods", value: customs.productSamples.join(" · ") });
  if (customs.supplierNames.length > 0) facts.push({ label: isVietnamese ? "Nhà cung cấp (bên gửi hàng)" : "Suppliers (shipper)", value: customs.supplierNames.join(" · ") });
  if (customs.supplierCountries.length > 0) facts.push({ label: isVietnamese ? "Nước xuất hàng" : "Shipped from", value: customs.supplierCountries.join(" · ") });
  if (customs.sourceLabels.length > 0) facts.push({ label: isVietnamese ? "Nguồn" : "Source", value: customs.sourceLabels.join(" · ") });

  return (
    <div className="mb-2.5 rounded-xl border border-[#E7EAF1] bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Container size={13} className="text-[#0F9488]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#0F9488]">
          {isVietnamese ? "Lịch sử nhập khẩu" : "Import history"}
        </span>
        {customs.lastDecidedAt ? (
          <span className="text-[10px] text-[#9095A3]">
            {isVietnamese ? "nối ngày" : "linked"} {formatDate(customs.lastDecidedAt)}
          </span>
        ) : null}
      </div>

      {customs.roles.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {customs.roles.map((role) => (
            <span
              key={`${role.role}-${role.side}`}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold ${
                role.side === "importer_side" ? "bg-[#E8F7F4] text-[#0B7A6F]" : "bg-[#F3F4F7] text-[#6C7280]"
              }`}
            >
              <Anchor size={10} />
              {isVietnamese ? ROLE_LABELS_VI[role.role] : role.role}
              <span className="font-bold">×{role.records_count}</span>
              {role.last_shipment ? <span className="font-normal opacity-70">· {formatDate(role.last_shipment)}</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex gap-1.5 text-[11px] leading-snug">
            <dt className="shrink-0 text-[#9095A3]">{fact.label}:</dt>
            <dd className="min-w-0 break-words font-semibold text-[#3B3F4F]">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {customs.matchMethods.length > 0 ? (
        <p className="mt-1.5 text-[10px] text-[#9095A3]">
          {isVietnamese ? "Cách nối: " : "Match method: "}
          {customs.matchMethods.map((method) => MATCH_METHOD_LABELS[method as CustomsMatchMethod] ?? method).join(" · ")}
        </p>
      ) : null}

      <p className="mt-1 text-[10px] text-[#9095A3]">
        {isVietnamese
          ? "Vận đơn công bố không có email hay điện thoại — khối này chỉ nói công ty đã nhập gì, từ đâu, khi nào."
          : "Bills of lading publish no email or phone — this block only says what, from where and when."}
      </p>
    </div>
  );
}

type QueueAction = "link" | "mark" | "create_buyer";

export function CustomsQueuePanel({
  queue,
  buyers,
  isVietnamese,
  live,
}: {
  queue: CustomsQueueItem[];
  buyers: BuyerListRow[];
  isVietnamese: boolean;
  live: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const candidatePool = useMemo(
    () =>
      buyers.map((buyer) => ({
        id: buyer.id,
        legal_name: buyer.name,
        display_name: buyer.name,
        domain: buyer.website,
        country: buyer.country,
      })),
    [buyers],
  );

  const items = useMemo(
    () =>
      queue.map((item) => {
        const candidates = suggestBuyerCandidates(
          {
            role: item.role,
            side: item.side ?? customsSideFor(item.role),
            name_as_printed: item.nameAsPrinted,
            name_normalized: item.nameNormalized,
            country_as_printed: item.country,
            country_iso2: item.countryIso2,
            website_declared: item.website,
          },
          candidatePool,
        );
        return { item, candidates, strong: soleStrongCandidate(candidates) };
      }),
    [queue, candidatePool],
  );

  if (queue.length === 0) return null;

  async function act(partyId: string, action: QueueAction, payload: Record<string, unknown> = {}) {
    setBusy(partyId);
    setNotice("");
    try {
      const response = await fetch("/api/customs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, partyId, ...payload }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Không thực hiện được.");
      setNotice(isVietnamese ? "Đã ghi quyết định. Danh sách đang được làm mới." : "Decision saved. Refreshing the list.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-[#E7EAF1] bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
      >
        <PackageSearch size={15} className="text-[#5D53E8]" />
        <span className="text-[12px] font-bold text-[#363947]">{isVietnamese ? "Hàng đợi phân loại tờ khai hải quan" : "Customs resolution queue"}</span>
        <span className="rounded-lg bg-[#F0EEFF] px-2 py-0.5 text-[10px] font-bold text-[#5D53E8]">{queue.length}</span>
        <span className="text-[10px] text-[#8B90A0]">
          {isVietnamese
            ? "bên nhận hàng chưa nối hồ sơ khách hàng — máy xếp ứng viên, người quyết"
            : "importer-side parties not linked to a buyer profile yet"}
        </span>
      </button>

      {!live ? (
        <p className="px-4 pb-3 text-[10px] text-[#9095A3]">
          {isVietnamese
            ? "Đang xem dữ liệu mẫu: ứng viên vẫn được xếp hạng thật, nhưng chỉ ghi được quyết định khi đã nối Supabase."
            : "Demo data: candidates are ranked for real, but decisions can only be written once Supabase is connected."}
        </p>
      ) : null}

      {open ? (
        <div className="border-t border-[#F0F1F4] px-4 py-3">
          {notice ? <p className="mb-2 rounded-lg bg-[#F5F4FF] px-2.5 py-1.5 text-[10px] font-semibold text-[#4F46C8]">{notice}</p> : null}
          <p className="mb-2 text-[10px] text-[#9095A3]">
            {isVietnamese
              ? `${queue.length} bên đang chờ. Nối xong, lô hàng tự vào trade_signals và lịch sử nhập khẩu hiện trên báo cáo khách hàng.`
              : `${queue.length} parties waiting. Linking also writes the shipment into trade_signals.`}
          </p>
          <div className="space-y-2">
            {items.map(({ item, candidates, strong }) => (
              <div key={item.partyId} className="rounded-xl border border-[#EDEFF4] bg-[#FCFCFE] px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] font-bold text-[#363947]">{item.nameAsPrinted}</span>
                  <span className="rounded-md bg-[#F0F1F4] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#6C7280]">
                    {roleLabel(item.role, item.side, isVietnamese)}
                  </span>
                  {item.country ? <span className="text-[10px] text-[#7B8190]">{item.country}</span> : null}
                  {item.status ? (
                    <span className="text-[10px] font-semibold text-[#B0723A]">{MATCH_STATUS_LABELS[item.status]}</span>
                  ) : null}
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[#8B90A0]">
                  <span>#{item.recordReference}</span>
                  {item.shipmentDate ? <span>· {formatDate(item.shipmentDate)}</span> : null}
                  {item.hsCode ? <span>· HS {item.hsCode}</span> : null}
                  <span>· {item.sourceLabel}</span>
                  {item.sourceColumn ? <span>· {isVietnamese ? "từ cột" : "column"} “{item.sourceColumn}”</span> : null}
                  {item.counterpartyName ? (
                    <span>
                      · {isVietnamese ? "đối tác" : "counterparty"}: {item.counterpartyName}
                      {item.counterpartyCountry ? ` (${item.counterpartyCountry})` : ""}
                    </span>
                  ) : null}
                </p>

                {item.reasons.length > 0 ? (
                  <p className="mt-1 text-[10px] text-[#9095A3]">{isVietnamese ? "Trạng thái trước: " : "Previous: "}{item.reasons.join(" · ")}</p>
                ) : null}

                {candidates.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {candidates.map((candidate) => (
                      <CandidateRow
                        key={candidate.buyerProfileId}
                        candidate={candidate}
                        strong={strong?.buyerProfileId === candidate.buyerProfileId}
                        busy={busy === item.partyId}
                        canLink={live}
                        isVietnamese={isVietnamese}
                        onLink={() =>
                          act(item.partyId, "link", {
                            buyerProfileId: candidate.buyerProfileId,
                            method: candidate.method,
                            confidence: candidate.score,
                            reasons: candidate.reasons,
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[#8B90A0]">
                    <ShieldAlert size={11} /> {isVietnamese ? "Chưa có ứng viên nào đủ gần — không nối bừa." : "No close candidate — nothing suggested."}
                  </p>
                )}

                {live ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#F0F1F4] pt-2">
                  <select
                    value={chosen[item.partyId] ?? ""}
                    onChange={(event) => setChosen((current) => ({ ...current, [item.partyId]: event.target.value }))}
                    className="rounded-lg border border-[#E3E6EE] bg-white px-2 py-1 text-[10px] text-[#4E5361]"
                  >
                    <option value="">{isVietnamese ? "Chọn hồ sơ khách hàng khác…" : "Pick another buyer profile…"}</option>
                    {buyers.map((buyer) => (
                      <option key={buyer.id} value={buyer.id}>
                        {buyer.name}
                        {buyer.country ? ` — ${buyer.country}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!chosen[item.partyId] || busy === item.partyId}
                    onClick={() =>
                      act(item.partyId, "link", {
                        buyerProfileId: chosen[item.partyId],
                        method: "manual",
                        confidence: 60,
                        reasons: [isVietnamese ? "người dùng tự chọn hồ sơ" : "picked by a person"],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-[#5D53E8] px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40"
                  >
                    {busy === item.partyId ? <LoaderCircle size={11} className="animate-spin" /> : <Link2 size={11} />}
                    {isVietnamese ? "Nối với hồ sơ đã chọn" : "Link selected profile"}
                  </button>

                  <button
                    type="button"
                    disabled={busy === item.partyId}
                    onClick={() => act(item.partyId, "create_buyer")}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#DCD9F8] px-2.5 py-1 text-[10px] font-bold text-[#5D53E8] disabled:opacity-40"
                  >
                    <UserPlus size={11} /> {isVietnamese ? "Tạo hồ sơ mới từ tờ khai" : "Create profile from record"}
                  </button>

                  <button
                    type="button"
                    disabled={busy === item.partyId}
                    onClick={() => act(item.partyId, "mark", { status: "review", reasons: [isVietnamese ? "người dùng để lại xem sau" : "left for later"] })}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#E3E6EE] px-2.5 py-1 text-[10px] font-semibold text-[#6C7280] disabled:opacity-40"
                  >
                    <ArrowRight size={11} /> {isVietnamese ? "Chờ xem sau" : "Review later"}
                  </button>

                  <button
                    type="button"
                    disabled={busy === item.partyId}
                    onClick={() => act(item.partyId, "mark", { status: "unmatched", reasons: [isVietnamese ? "không tìm thấy hồ sơ phù hợp" : "no matching profile"] })}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#E3E6EE] px-2.5 py-1 text-[10px] font-semibold text-[#6C7280] disabled:opacity-40"
                  >
                    <Check size={11} /> {isVietnamese ? "Đánh dấu chưa có ứng viên" : "Mark unmatched"}
                  </button>
                </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CandidateRow({
  candidate,
  strong,
  busy,
  canLink,
  isVietnamese,
  onLink,
}: {
  candidate: BuyerCandidate;
  strong: boolean;
  busy: boolean;
  canLink: boolean;
  isVietnamese: boolean;
  onLink: () => void;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 ${strong ? "border-[#CDEAE4] bg-[#F3FBF9]" : "border-[#EDEFF4] bg-white"}`}>
      <span className="text-[11px] font-semibold text-[#3B3F4F]">{candidate.label}</span>
      <span className="rounded-md bg-[#EEF0F5] px-1.5 py-0.5 text-[9px] font-bold text-[#5A6070]">{candidate.score}</span>
      <span className="text-[10px] text-[#8B90A0]">{MATCH_METHOD_LABELS[candidate.method]}</span>
      <span className="min-w-0 flex-1 text-[10px] text-[#9095A3]">{candidate.reasons.join(" · ")}</span>
      <button
        type="button"
        disabled={busy || !canLink}
        onClick={onLink}
        className="inline-flex items-center gap-1 rounded-lg bg-[#0F9488] px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40"
      >
        {busy ? <LoaderCircle size={11} className="animate-spin" /> : <Link2 size={11} />}
        {isVietnamese ? "Nối hồ sơ này" : "Link this profile"}
      </button>
    </div>
  );
}
