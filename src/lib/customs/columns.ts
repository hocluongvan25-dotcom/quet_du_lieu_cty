/**
 * Hợp đồng cột với file hải quan.
 *
 * File của mỗi nhà cung cấp dữ liệu đặt tên cột một kiểu. Thay vì viết một bộ
 * đọc cho từng nhà cung cấp, ở đây có **một bảng ánh xạ** từ tên cột (đã bỏ dấu,
 * viết thường, bỏ ký tự trang trí) sang trường của mình. Nhập file luôn in ra
 * bảng đối chiếu này: cột nào nhận ra, thành trường nào, cột nào bỏ qua — để
 * không có chuyện dữ liệu vào sai chỗ mà im lặng.
 *
 * ## Vai của một bên đọc từ **tên cột**, không từ suy đoán
 *
 * Trong file vận đơn, vai nằm ở chính tên cột: "Shipper Name", "Consignee",
 * "Buyer", "Notify Party". Vì vậy:
 *
 *  - cột nào tên là shipper/exporter → vai `shipper`;
 *  - consignee → `consignee`; importer → `importer`; buyer → `importer` (file
 *    gọi bên đó là người mua — mình ghi lại đúng chữ của file trong
 *    `source_column`, và vai theo nghĩa hẹp nhất mà file nói);
 *  - notify party → `notify_party`.
 *
 * File không có cột nào cho biết vai thì **không nhập được**: mình không suy vai
 * từ vị trí cột hay từ thứ tự bên trong dòng.
 */

import type { CustomsPartyRole } from "./normalize";

export type RecordField =
  | "record_reference"
  | "shipment_date"
  | "hs_code"
  | "product_description"
  | "quantity"
  | "quantity_unit"
  | "weight_kg"
  | "containers"
  | "value_usd"
  | "origin_country"
  | "destination_port";

export type PartyPart = "name" | "country" | "address" | "website";

export type ColumnRole = {
  role: CustomsPartyRole;
  /** Cụm từ trong tên cột đã cho ra vai này, để in lại trong bảng đối chiếu. */
  via: string;
};

export type ColumnMapping =
  | { kind: "record"; field: RecordField; header: string }
  | { kind: "party"; part: PartyPart; role: CustomsPartyRole; via: string; header: string };

/** Bỏ dấu, viết thường, gộp khoảng trắng, bỏ ký tự trang trí — để so tên cột. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/|]+/g, " ")
    .replace(/[^a-z0-9\s().%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cột của cả lô hàng, xếp theo mức cụ thể: cái nào khớp trước thì thắng. */
const RECORD_COLUMNS: { field: RecordField; patterns: RegExp[] }[] = [
  { field: "record_reference", patterns: [/\bbill of lading\b/, /\bbol\b/, /\bbl no\b/, /\bbl number\b/, /\bshipment id\b/, /\bshipment no\b/, /\brecord id\b/, /\bdeclaration no\b/, /\breference\b/] },
  { field: "shipment_date", patterns: [/\bshipment date\b/, /\bbill date\b/, /\bbol date\b/, /\barrival date\b/, /\bdeparture date\b/, /\bshipped on\b/, /\bdate\b/] },
  { field: "hs_code", patterns: [/\bhs code\b/, /\bhs\b/, /\bhts\b/, /\bhts code\b/, /\btariff code\b/, /\bcommodity code\b/] },
  { field: "product_description", patterns: [/\bproduct description\b/, /\bgoods description\b/, /\bdescription\b/, /\bcommodity\b/, /\bproduct\b/] },
  { field: "quantity_unit", patterns: [/\bquantity unit\b/, /\bunit of measure\b/, /\bunit\b/] },
  { field: "quantity", patterns: [/\bquantity\b/, /\bqty\b/, /\bpackages\b/, /\bpieces\b/] },
  { field: "weight_kg", patterns: [/\bweight kg\b/, /\bgross weight\b/, /\bnet weight\b/, /\bweight\b/, /\bkg\b/] },
  { field: "containers", patterns: [/\bcontainers?\b/, /\bcontainer count\b/, /\bteu\b/] },
  { field: "value_usd", patterns: [/\bvalue usd\b/, /\busd value\b/, /\bdeclared value\b/, /\bvalue\b/, /\bamount\b/] },
  { field: "origin_country", patterns: [/\bcountry of origin\b/, /\borigin country\b/, /\borigin\b/] },
  { field: "destination_port", patterns: [/\bport of discharge\b/, /\bdestination port\b/, /\bport of unloading\b/, /\bdestination\b/] },
];

/**
 * Vai đọc từ tên cột. Thứ tự quan trọng: "notify party" phải xét trước "party",
 * và "consignee" trước "shipper" vì một số file có cột "Shipper / Consignee".
 */
const PARTY_ROLES: { role: CustomsPartyRole; via: string; patterns: { re: RegExp; phrase: string }[] }[] = [
  {
    role: "notify_party",
    via: "notify party",
    patterns: [
      { re: /\bnotify party\b/, phrase: "notify party" },
      { re: /\bnotify\b/, phrase: "notify" },
    ],
  },
  {
    role: "consignee",
    via: "consignee",
    patterns: [
      { re: /\bconsignee\b/, phrase: "consignee" },
      { re: /\bconsigned to\b/, phrase: "consigned to" },
      { re: /\breceiver\b/, phrase: "receiver" },
    ],
  },
  {
    role: "importer",
    via: "importer",
    patterns: [
      { re: /\bimporter\b/, phrase: "importer" },
      { re: /\bimporting company\b/, phrase: "importing company" },
    ],
  },
  {
    // "Buyer" là chữ của chính file: bên đó được nguồn gọi là người mua. Mình xếp
    // vào vai `importer` và ghi lại nguyên văn tên cột trong `source_column`.
    role: "importer",
    via: "buyer",
    patterns: [
      { re: /\bbuyer\b/, phrase: "buyer" },
      { re: /\bpurchaser\b/, phrase: "purchaser" },
    ],
  },
  {
    role: "shipper",
    via: "shipper",
    patterns: [
      { re: /\bshipper\b/, phrase: "shipper" },
      { re: /\bshipped by\b/, phrase: "shipped by" },
      { re: /\bexporter\b/, phrase: "exporter" },
      { re: /\bsupplier\b/, phrase: "supplier" },
      { re: /\bseller\b/, phrase: "seller" },
    ],
  },
];

/** Phần nào của một bên: tên, địa chỉ, quốc gia, website. */
const PARTY_PARTS: { part: PartyPart; patterns: { re: RegExp; phrase: string }[] }[] = [
  {
    part: "website",
    patterns: [
      { re: /\bwebsite\b/, phrase: "website" },
      { re: /\bweb site\b/, phrase: "web site" },
      { re: /\bdomain\b/, phrase: "domain" },
      { re: /\burl\b/, phrase: "url" },
    ],
  },
  {
    part: "address",
    patterns: [
      { re: /\baddress\b/, phrase: "address" },
      { re: /\baddr\b/, phrase: "addr" },
    ],
  },
  {
    part: "country",
    patterns: [
      { re: /\bcountry\b/, phrase: "country" },
      { re: /\bnation\b/, phrase: "nation" },
    ],
  },
];

/** Chữ còn lại sau khi bỏ tên vai và tên phần — chỉ những chữ này mới hợp lệ. */
const NAME_FILLER = /\b(name|full|full name|company|company name|entity|business|legal|co|corp)\b/g;

/**
 * Một tên cột → một trường, hoặc không nhận ra.
 *
 * Cách làm: tìm tên vai trong cột, bỏ nó ra, tìm phần (địa chỉ/quốc gia/website)
 * bỏ tiếp. Chữ còn lại phải rỗng (hoặc chỉ là chữ đệm như "name", "full") thì
 * cột đó mới là cột của bên. Nhờ vậy "Consignee Address" và "Shipper" được nhận,
 * còn "Shipper reference", "Shipper email" thì không — và những cột bị bỏ qua
 * đều được in ra trong bảng đối chiếu.
 */
export function mapColumn(header: string): ColumnMapping | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;

  const roleHit = PARTY_ROLES.map((entry) => ({ entry, hit: entry.patterns.find((pattern) => pattern.re.test(normalized)) })).find(
    (item) => item.hit,
  );

  if (roleHit?.hit) {
    const partHit = PARTY_PARTS.map((entry) => ({ entry, hit: entry.patterns.find((pattern) => pattern.re.test(normalized)) })).find(
      (item) => item.hit,
    );
    const part: PartyPart = partHit?.entry.part ?? "name";

    let rest = normalized.replace(roleHit.hit.re, " ");
    if (partHit?.hit) rest = rest.replace(partHit.hit.re, " ");
    rest = rest.replace(NAME_FILLER, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

    // Cột tên bên thì không được còn chữ lạ; cột địa chỉ/quốc gia/website được
    // phép còn ("Consignee Address Line 1", "Shipper Country Code").
    if (part === "name" && rest !== "") return null;

    return { kind: "party", part, role: roleHit.entry.role, via: roleHit.entry.via, header };
  }

  for (const entry of RECORD_COLUMNS) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      return { kind: "record", field: entry.field, header };
    }
  }

  return null;
}

export type ColumnReport = {
  mapped: { header: string; target: string }[];
  ignored: string[];
  /** Có đủ thứ tối thiểu để nhập không. */
  ready: boolean;
  /** Lý do chưa nhập được — hiện thẳng cho người nhập đọc. */
  problems: string[];
};

/** Bảng đối chiếu in ra trước khi ghi: nhận ra gì, bỏ qua gì, còn thiếu gì. */
export function mapHeaders(headers: string[]): ColumnReport {
  const mapped: { header: string; target: string }[] = [];
  const ignored: string[] = [];
  const partyRoles = new Set<CustomsPartyRole>();
  let hasReference = false;

  headers.forEach((header) => {
    const mapping = mapColumn(header);
    if (!mapping) {
      ignored.push(header);
      return;
    }
    if (mapping.kind === "record") {
      if (mapping.field === "record_reference") hasReference = true;
      mapped.push({ header, target: mapping.field });
      return;
    }
    if (mapping.part === "name") partyRoles.add(mapping.role);
    mapped.push({ header, target: `${mapping.role}.${mapping.part}` });
  });

  const problems: string[] = [];
  if (!hasReference) {
    problems.push(
      "Thiếu cột số vận đơn/tờ khai (Bill of Lading, BOL, Shipment ID…): không có khoá thì nhập hai lần sẽ nhân đôi dữ liệu, nên file này không nhập được.",
    );
  }
  if (partyRoles.size === 0) {
    problems.push(
      "Không có cột nào cho biết vai của một bên (Shipper, Consignee, Importer, Buyer, Notify Party): không suy vai từ vị trí cột, nên file này không nhập được.",
    );
  }

  return { mapped, ignored, ready: problems.length === 0, problems };
}

/** Nhãn tiếng Việt cho bảng đối chiếu in ra màn hình. */
export const FIELD_LABELS: Record<RecordField | `${string}.${PartyPart}`, string> = {
  record_reference: "số vận đơn/tờ khai",
  shipment_date: "ngày",
  hs_code: "mã HS",
  product_description: "mô tả hàng hoá",
  quantity: "số lượng",
  quantity_unit: "đơn vị",
  weight_kg: "cân nặng (kg)",
  containers: "số container",
  value_usd: "trị giá (USD)",
  origin_country: "quốc gia xuất xứ",
  destination_port: "cảng đến",
  "importer.name": "tên bên nhập khẩu",
  "importer.country": "quốc gia bên nhập khẩu",
  "importer.address": "địa chỉ bên nhập khẩu",
  "importer.website": "website bên nhập khẩu",
  "consignee.name": "tên bên nhận hàng",
  "consignee.country": "quốc gia bên nhận hàng",
  "consignee.address": "địa chỉ bên nhận hàng",
  "consignee.website": "website bên nhận hàng",
  "shipper.name": "tên bên gửi hàng",
  "shipper.country": "quốc gia bên gửi hàng",
  "shipper.address": "địa chỉ bên gửi hàng",
  "shipper.website": "website bên gửi hàng",
  "notify_party.name": "tên bên được thông báo",
  "notify_party.country": "quốc gia bên được thông báo",
  "notify_party.address": "địa chỉ bên được thông báo",
  "notify_party.website": "website bên được thông báo",
  "other.name": "tên bên khác",
  "other.country": "quốc gia bên khác",
  "other.address": "địa chỉ bên khác",
  "other.website": "website bên khác",
};

export const ROLE_LABELS_VI: Record<CustomsPartyRole, string> = {
  importer: "người nhập khẩu",
  consignee: "người nhận hàng",
  shipper: "người gửi hàng",
  notify_party: "bên được thông báo",
  other: "bên khác",
};
