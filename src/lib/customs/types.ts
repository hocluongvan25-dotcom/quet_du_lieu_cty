/**
 * Kiểu dữ liệu chung của phần hải quan — chép đúng theo enum trong migration 012.
 *
 * Ba tầng, tách bạch có chủ ý:
 *  - **vai** (`role`): đúng như tờ khai in ra — đây là sự thật;
 *  - **bên** (`side`): suy ra từ vai, và `unknown` là một câu trả lời hợp lệ;
 *  - **khớp** (`status`): người quyết — `review` khác `unmatched`.
 */

export type CustomsPartyRole = "importer" | "consignee" | "shipper" | "notify_party" | "other";

export type CustomsSide = "importer_side" | "exporter_side" | "unknown";

export type CustomsMatchMethod =
  | "exact_domain"
  | "exact_name_country"
  | "exact_name"
  | "fuzzy_name"
  | "created_from_customs"
  | "manual";

export type CustomsMatchStatus = "linked" | "created" | "review" | "unmatched";

export type CustomsPartyRow = {
  id: string;
  role: CustomsPartyRole;
  side: CustomsSide;
  name_as_printed: string;
  name_normalized: string;
  country_as_printed: string | null;
  /** Bản suy ra từ quốc gia in trên tờ khai, để đối chiếu. Bản in ở trên. */
  country_iso2: string | null;
  address_as_printed: string | null;
  website_declared: string | null;
  source_column: string | null;
  customs_record_id: string;
};

export type CustomsSummary = {
  records_count: number;
  first_shipment: string | null;
  last_shipment: string | null;
  hs_codes: string[] | null;
  product_samples: string[] | null;
  supplier_countries: string[] | null;
  supplier_names: string[] | null;
  source_labels: string[] | null;
  match_methods: string[] | null;
  last_decided_at: string | null;
};

export type CustomsRoleRow = {
  role: CustomsPartyRole;
  side: CustomsSide;
  records_count: number;
  last_shipment: string | null;
};

export type CustomsQueueRow = {
  customs_party_id: string;
  role: CustomsPartyRole;
  side: CustomsSide;
  name_as_printed: string;
  name_normalized: string;
  country_as_printed: string | null;
  country_iso2: string | null;
  address_as_printed: string | null;
  website_declared: string | null;
  source_column: string | null;
  customs_record_id: string;
  record_reference: string;
  shipment_date: string | null;
  hs_code: string | null;
  product_description: string | null;
  source_label: string;
  source_key: string;
  match_status: CustomsMatchStatus | null;
  match_method: CustomsMatchMethod | null;
  match_confidence: number | null;
  match_reasons: string[] | null;
  counterparty_name: string | null;
  counterparty_country: string | null;
};

export const MATCH_STATUS_LABELS: Record<CustomsMatchStatus, string> = {
  linked: "đã nối",
  created: "tạo mới từ tờ khai",
  review: "chờ người xem",
  unmatched: "chưa có ứng viên",
};

export const MATCH_METHOD_LABELS: Record<CustomsMatchMethod, string> = {
  exact_domain: "trùng tên miền website",
  exact_name_country: "trùng tên + quốc gia",
  exact_name: "trùng tên khít",
  fuzzy_name: "tên gần giống",
  created_from_customs: "tạo mới từ tờ khai",
  manual: "người tự chọn",
};
