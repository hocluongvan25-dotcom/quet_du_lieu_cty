/**
 * Nhập file hải quan (CSV) thành tờ khai + các bên.
 *
 * Nguyên tắc của lần nhập này:
 *
 *  1. **In bảng đối chiếu cột trước khi ghi** — người nhập thấy cột nào vào
 *     trường nào, cột nào bị bỏ qua, và thiếu gì thì chặn ngay.
 *  2. **Không đoán**: thiếu số vận đơn → không nhập; ngày mơ hồ → để trống chứ
 *     không chọn bừa; tên rỗng → bỏ bên đó chứ không bịa.
 *  3. **Nhập lại không nhân đôi**: khoá là (workspace, nguồn, số vận đơn), hàm
 *     `record_customs_record` trả về dòng cũ.
 *  4. Không tự nối bên với hồ sơ khách hàng. Nối là việc của người — hàm ghi ở
 *     đây chỉ đưa bên vào hàng đợi xem xét (xem `src/lib/customs/resolve.ts`).
 */

import { mapHeaders, mapColumn, type ColumnReport, type RecordField } from "./columns";
import { parseCsv } from "./csv";
import {
  countryIso2,
  declaredDomain,
  normalizeCompanyName,
  parseNumber,
  parseShipmentDate,
  type DateOrder,
} from "./normalize";
import type { CustomsPartyInput, CustomsStore } from "./persist";
import type { CustomsPartyRole } from "./types";

export type CustomsImportOptions = {
  organizationId: string;
  /** Khoá nguồn trong `market_sources`. Chưa có dòng thì lần nhập bị từ chối. */
  sourceKey: string;
  text: string;
  /** Thứ tự ngày/tháng khi file để cả hai số đều ≤ 12. Mặc định: không đoán. */
  dateOrder?: DateOrder;
  /** Chỉ đọc file và in bảng đối chiếu, không ghi gì. */
  dryRun?: boolean;
};

export type CustomsImportReport = {
  columns: ColumnReport;
  rows: number;
  /** Số tờ khai đã ghi mới trong lần này. */
  imported: number;
  /** Số tờ khai đã có sẵn trong DB (nhập lại file cũ) — không tạo bản sao. */
  replayed: number;
  duplicatesInFile: number;
  skippedNoReference: number;
  /** Dòng đọc được nhưng không có bên nào (chỉ có cột hàng hoá). */
  skippedNoParty: number;
  parties: number;
  /** Lô hàng chỉ có bên gửi hàng / bên được thông báo, không có bên nhận hàng. */
  recordsWithoutBuyerSide: number;
  ambiguousDates: number;
  failures: { reference: string; message: string }[];
};

type BuiltRecord = {
  reference: string;
  shipmentDate: string | null;
  hsCode: string | null;
  productDescription: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  weightKg: number | null;
  containers: number | null;
  valueUsd: number | null;
  originCountry: string | null;
  destinationPort: string | null;
  parties: CustomsPartyInput[];
  ambiguousDate: boolean;
  hasBuyerSide: boolean;
};

/** Số container là số nguyên; file ghi "1 container" hay "1,00" đều đọc ra 1. */
function containers(raw: string | null): number | null {
  const value = parseNumber(raw);
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 100000 ? rounded : null;
}

type PartyDraft = { name?: string; nameColumn?: string; country?: string; address?: string; website?: string };

/**
 * Đọc một dòng theo bảng ánh xạ cột. Mọi trường giữ nguyên bản in; chỉ ngày và
 * con số được đổi kiểu, và cả hai đều có thể là null thay vì đoán.
 */
function buildRecord(
  headers: string[],
  row: string[],
  dateOrder: DateOrder,
): { record: BuiltRecord | null; reason: "no-reference" | "no-party" | null } {
  const values: Partial<Record<RecordField, string>> = {};
  const parties = new Map<CustomsPartyRole, PartyDraft>();

  headers.forEach((header, index) => {
    const mapping = mapColumn(header);
    if (!mapping) return;
    const value = (row[index] ?? "").trim();

    if (mapping.kind === "record") {
      values[mapping.field] = value;
      return;
    }

    const draft = parties.get(mapping.role) ?? {};
    if (mapping.part === "name") {
      draft.name = value;
      draft.nameColumn = mapping.header;
    } else {
      draft[mapping.part] = value;
    }
    parties.set(mapping.role, draft);
  });

  const reference = (values.record_reference ?? "").trim();
  if (!reference) return { record: null, reason: "no-reference" };

  const parsedDate = parseShipmentDate(values.shipment_date ?? null, dateOrder);

  const built: BuiltRecord = {
    reference,
    shipmentDate: parsedDate.ok ? parsedDate.value : null,
    hsCode: values.hs_code?.trim() || null,
    productDescription: values.product_description?.trim() || null,
    quantity: parseNumber(values.quantity),
    quantityUnit: values.quantity_unit?.trim() || null,
    weightKg: parseNumber(values.weight_kg),
    containers: containers(values.containers ?? null),
    valueUsd: parseNumber(values.value_usd),
    originCountry: values.origin_country?.trim() || null,
    destinationPort: values.destination_port?.trim() || null,
    parties: [],
    ambiguousDate: parsedDate.ok ? false : parsedDate.ambiguous,
    hasBuyerSide: false,
  };

  parties.forEach((draft, role) => {
    const name = draft.name?.trim();
    if (!name) return;
    const normalized = normalizeCompanyName(name);
    if (!normalized) return;
    built.parties.push({
      role,
      name,
      nameNormalized: normalized,
      country: draft.country?.trim() || null,
      countryIso2: draft.country?.trim() ? countryIso2(draft.country.trim()) : null,
      address: draft.address?.trim() || null,
      website: draft.website?.trim() ? declaredDomain(draft.website) || draft.website.trim() : null,
      column: draft.nameColumn ?? null,
    });
  });

  if (built.parties.length === 0) return { record: null, reason: "no-party" };
  built.hasBuyerSide = built.parties.some((party) => party.role === "importer" || party.role === "consignee");
  return { record: built, reason: null };
}

/** Nhập cả file. Trả về bảng đối chiếu cột kèm số liệu — dùng cho cả chế độ xem thử. */
export async function importCustomsCsv(store: CustomsStore, options: CustomsImportOptions): Promise<CustomsImportReport> {
  const parsed = parseCsv(options.text);
  const columns = mapHeaders(parsed.headers);
  const report: CustomsImportReport = {
    columns,
    rows: parsed.rows.length,
    imported: 0,
    replayed: 0,
    duplicatesInFile: 0,
    skippedNoReference: 0,
    skippedNoParty: 0,
    parties: 0,
    recordsWithoutBuyerSide: 0,
    ambiguousDates: 0,
    failures: [],
  };

  if (!columns.ready || options.dryRun) return report;

  // Một file có thể lặp cùng số vận đơn; giữ dòng đầu và đếm phần lặp để báo lại
  // thay vì âm thầm bỏ.
  const seen = new Set<string>();
  const built: BuiltRecord[] = [];
  for (const row of parsed.rows) {
    const { record, reason } = buildRecord(parsed.headers, row, options.dateOrder ?? "auto");
    if (!record) {
      if (reason === "no-reference") report.skippedNoReference += 1;
      else report.skippedNoParty += 1;
      continue;
    }
    if (seen.has(record.reference)) {
      report.duplicatesInFile += 1;
      continue;
    }
    seen.add(record.reference);
    built.push(record);
  }

  for (const record of built) {
    if (record.ambiguousDate) report.ambiguousDates += 1;
    if (!record.hasBuyerSide) report.recordsWithoutBuyerSide += 1;
    try {
      const result = await store.recordRecord({
        organizationId: options.organizationId,
        sourceKey: options.sourceKey,
        recordReference: record.reference,
        shipmentDate: record.shipmentDate,
        hsCode: record.hsCode,
        productDescription: record.productDescription,
        quantity: record.quantity,
        quantityUnit: record.quantityUnit,
        weightKg: record.weightKg,
        containers: record.containers,
        valueUsd: record.valueUsd,
        originCountry: record.originCountry,
        destinationPort: record.destinationPort,
        parties: record.parties,
      });
      if (result.replayed) report.replayed += 1;
      else {
        report.imported += 1;
        report.parties += record.parties.length;
      }
    } catch (error) {
      // Nguồn thiếu (chưa có dòng trong market_sources) là lỗi thật; thông báo
      // của DB là thứ người nhập cần đọc nên giữ nguyên chữ, không bọc lại.
      report.failures.push({ reference: record.reference, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return report;
}
