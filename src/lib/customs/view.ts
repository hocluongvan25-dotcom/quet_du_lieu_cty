/**
 * Đổi dòng thô từ Postgres thành dòng cho giao diện — thuần, không phụ thuộc server.
 *
 * Tách khỏi `src/lib/data/customs.ts` (loader) để client component và bộ test dùng
 * được mà không kéo `next/headers` vào bundle trình duyệt.
 */

import type { CustomsRoleRow, CustomsSummary, CustomsQueueRow } from "./types";

/** Thông tin hải quan của một khách hàng, đã ở dạng hiển thị được. */
export type BuyerCustomsRow = {
  recordsCount: number;
  firstShipment: string | null;
  lastShipment: string | null;
  /** Mã HS đã gom theo chữ số (view lo phần đó) — chỉ để hiển thị. */
  hsCodes: string[];
  productSamples: string[];
  supplierNames: string[];
  supplierCountries: string[];
  sourceLabels: string[];
  matchMethods: string[];
  lastDecidedAt: string | null;
  /** Vai của khách hàng trên các tờ khai đã nối, kèm số lô mỗi vai. */
  roles: CustomsRoleRow[];
};

export type CustomsQueueItem = {
  partyId: string;
  nameAsPrinted: string;
  nameNormalized: string;
  country: string | null;
  countryIso2: string | null;
  address: string | null;
  website: string | null;
  sourceColumn: string | null;
  role: CustomsQueueRow["role"];
  side: CustomsQueueRow["side"];
  recordReference: string;
  shipmentDate: string | null;
  hsCode: string | null;
  productDescription: string | null;
  sourceLabel: string;
  status: CustomsQueueRow["match_status"];
  method: CustomsQueueRow["match_method"];
  confidence: number | null;
  reasons: string[];
  counterpartyName: string | null;
  counterpartyCountry: string | null;
};

function list(values: string[] | null | undefined): string[] {
  return Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim().length > 0) : [];
}

/** Dòng của view `buyer_customs_summary` → khối hiển thị trên báo cáo. */
export function toBuyerCustomsRow(
  summary: CustomsSummary,
  roles: CustomsRoleRow[] = [],
): BuyerCustomsRow {
  return {
    recordsCount: Number.isFinite(summary.records_count) ? summary.records_count : 0,
    firstShipment: summary.first_shipment,
    lastShipment: summary.last_shipment,
    hsCodes: list(summary.hs_codes),
    productSamples: list(summary.product_samples),
    supplierNames: list(summary.supplier_names),
    supplierCountries: list(summary.supplier_countries),
    sourceLabels: list(summary.source_labels),
    matchMethods: list(summary.match_methods),
    lastDecidedAt: summary.last_decided_at,
    roles,
  };
}

/** Dòng của view `customs_resolution_queue` → dòng cho hàng đợi xem xét. */
export function toCustomsQueueItem(row: CustomsQueueRow): CustomsQueueItem {
  return {
    partyId: row.customs_party_id,
    nameAsPrinted: row.name_as_printed,
    nameNormalized: row.name_normalized,
    country: row.country_as_printed,
    countryIso2: row.country_iso2,
    address: row.address_as_printed,
    website: row.website_declared,
    sourceColumn: row.source_column,
    role: row.role,
    side: row.side,
    recordReference: row.record_reference,
    shipmentDate: row.shipment_date,
    hsCode: row.hs_code,
    productDescription: row.product_description,
    sourceLabel: row.source_label,
    status: row.match_status,
    method: row.match_method,
    confidence: row.match_confidence,
    reasons: list(row.match_reasons),
    counterpartyName: row.counterparty_name,
    counterpartyCountry: row.counterparty_country,
  };
}

/**
 * Danh sách cột cần đọc từ `buyer_customs_summary`. Viết ra đây để loader và test
 * dùng chung một danh sách, thêm cột thì thêm ở một chỗ.
 */
export const CUSTOMS_SUMMARY_COLUMNS =
  "buyer_profile_id, records_count, first_shipment, last_shipment, hs_codes, product_samples, supplier_countries, supplier_names, source_labels, match_methods, last_decided_at";

export const CUSTOMS_ROLE_COLUMNS = "buyer_profile_id, role, side, records_count, last_shipment";

export const CUSTOMS_QUEUE_COLUMNS =
  "customs_party_id, organization_id, role, side, name_as_printed, name_normalized, country_as_printed, country_iso2, address_as_printed, website_declared, source_column, customs_record_id, record_reference, shipment_date, hs_code, product_description, source_label, source_key, match_status, match_method, match_confidence, match_reasons, counterparty_name, counterparty_country";

export type CustomsSummaryDbRow = CustomsSummary & { buyer_profile_id: string };
export type CustomsRoleDbRow = CustomsRoleRow & { buyer_profile_id: string };

/**
 * Ghép thông tin tóm tắt với vai của từng khách hàng. Dòng tóm tắt không có
 * (khách hàng chưa nối tờ khai nào) thì không có khoá trong map — và như vậy là
 * đúng: không có lịch sử thì không hiện khối.
 */
export function toBuyerCustomsByBuyer(
  summaryRows: CustomsSummaryDbRow[],
  roleRows: CustomsRoleDbRow[],
): Map<string, BuyerCustomsRow> {
  const rolesByBuyer = new Map<string, CustomsRoleRow[]>();
  roleRows.forEach((row) => {
    const list_ = rolesByBuyer.get(row.buyer_profile_id) ?? [];
    list_.push({ role: row.role, side: row.side, records_count: row.records_count, last_shipment: row.last_shipment });
    rolesByBuyer.set(row.buyer_profile_id, list_);
  });

  const byBuyer = new Map<string, BuyerCustomsRow>();
  summaryRows.forEach((row) => {
    byBuyer.set(row.buyer_profile_id, toBuyerCustomsRow(row, rolesByBuyer.get(row.buyer_profile_id) ?? []));
  });
  return byBuyer;
}
