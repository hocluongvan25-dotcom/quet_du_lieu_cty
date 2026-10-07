/**
 * Chức danh → `role_kind` (enum trong migration 009).
 *
 * ## Vì sao cần trường này thay vì suy lại mỗi lần
 *
 * Cổng Role trong thiết kế chuẩn hỏi: "người này có phải đầu mối mua hàng
 * không?". Trước đây câu đó được suy lại từ chuỗi chức danh ở mỗi chỗ dùng
 * (`TITLE_WORDS` trong `extract.ts`, `search-roles.ts`, rồi tới UI), nên mỗi
 * nơi trả lời một kiểu. Giờ nó được phân loại **một lần**, lưu vào cột, và mọi
 * chỗ đọc cùng một giá trị.
 *
 * ## Nguyên tắc
 *
 *  - Chỉ đọc chức danh/bộ phận có trên trang. Không suy từ tên người, không suy
 *    từ email, không đoán theo ngành.
 *  - Ưu tiên việc mua hàng trước chức danh quản lý: "Procurement Director" là
 *    `procurement`, không phải `management`. "Sales Director" là `sales`.
 *  - Không có chức danh → `unknown`. Có chức danh nhưng không khớp nhóm nào →
 *    `other`. Hai giá trị này khác nhau và không được gộp: người ta cần biết
 *    mình đang thiếu dữ liệu hay đang có dữ liệu không dùng được.
 */

/** Đúng bằng các giá trị của enum `public.role_kind` (migration 009). */
export const ROLE_KINDS = [
  "procurement",
  "purchasing",
  "sourcing",
  "supply_chain",
  "quality",
  "logistics",
  "sales",
  "management",
  "other",
  "unknown",
] as const;

export type RoleKind = (typeof ROLE_KINDS)[number];

/** Nhãn hiển thị. Không có từ nào mang tính khuyên bảo (spec §10). */
export const ROLE_LABELS: Record<RoleKind, { vi: string; en: string }> = {
  procurement: { vi: "Thu mua", en: "Procurement" },
  purchasing: { vi: "Mua hàng", en: "Purchasing" },
  sourcing: { vi: "Tìm nguồn hàng", en: "Sourcing" },
  supply_chain: { vi: "Chuỗi cung ứng", en: "Supply chain" },
  quality: { vi: "Chất lượng", en: "Quality" },
  logistics: { vi: "Logistics / xuất nhập khẩu", en: "Logistics / import-export" },
  sales: { vi: "Kinh doanh", en: "Sales" },
  management: { vi: "Ban lãnh đạo", en: "Management" },
  other: { vi: "Chức danh khác", en: "Other role" },
  unknown: { vi: "Chưa rõ chức danh", en: "Title not found" },
};

/**
 * Nhóm chức danh **trực tiếp mua hàng**. Cổng Role dùng danh sách này; ba giá
 * trị đầu đúng như thiết kế chuẩn nêu (`procurement` / `purchasing` /
 * `sourcing`), cộng `supply_chain` vì ở nhiều công ty thực phẩm người quyết
 * định nằm ở bộ phận này.
 */
export const BUYING_ROLES: RoleKind[] = ["procurement", "purchasing", "sourcing", "supply_chain"];

export function isBuyingRole(kind: RoleKind): boolean {
  return BUYING_ROLES.includes(kind);
}

/**
 * Thứ tự kiểm tra quan trọng: nhóm cụ thể trước, nhóm chung sau. Đổi thứ tự là
 * đổi kết quả ("Procurement Director" sẽ thành `management`).
 */
const ROLE_PATTERNS: { kind: RoleKind; pattern: RegExp }[] = [
  {
    kind: "sourcing",
    pattern: /\bsourcing\b|\bsource\b|commodity|nguồn hàng|tìm nguồn/i,
  },
  {
    kind: "purchasing",
    pattern: /\bpurchas|\bbuyer\b|\bbuying\b|\bbuy\b|category manager|category buyer|mua hàng|thu mua hàng/i,
  },
  {
    kind: "procurement",
    pattern: /procure|thu mua|cung ứng vật tư/i,
  },
  {
    kind: "supply_chain",
    pattern: /supply chain|supply-chain|demand plan|\bs&op\b|planner|planning|chuỗi cung ứng|kế hoạch/i,
  },
  {
    kind: "logistics",
    pattern: /logistic|import|export|ship|freight|customs|distribution|warehouse|forwarding|xuất nhập khẩu|hải quan|kho vận/i,
  },
  {
    kind: "quality",
    pattern: /\bquality\b|\bq\.?a\.?\b|\bq\.?c\.?\b|food safety|technical|regulatory|\br&d\b|\blab\b|chất lượng|kỹ thuật|an toàn thực phẩm/i,
  },
  {
    kind: "sales",
    pattern: /sales|sell|account|business development|\bbd\b|marketing|commercial|customer|client|kinh doanh|bán hàng|thương mại|tiếp thị/i,
  },
  {
    kind: "management",
    pattern: /president|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|chief|owner|founder|partner|director|\bvp\b|vice president|general manager|managing|head of|board|chairman|tổng giám đốc|giám đốc|chủ tịch|ban lãnh đạo/i,
  },
];

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Quét một chuỗi theo đúng thứ tự ưu tiên ở trên. */
function classifyText(text: string): RoleKind | null {
  for (const rule of ROLE_PATTERNS) {
    if (rule.pattern.test(text)) return rule.kind;
  }
  return null;
}

/**
 * "Manager" / "Director" / "Specialist" không nói người đó làm gì; khi chức danh
 * chung chung như vậy thì bộ phận mới là chỗ có thông tin.
 */
function isGenericRole(kind: RoleKind | null): boolean {
  return kind === null || kind === "management" || kind === "other";
}

/**
 * Phân loại một người từ chức danh và/hoặc bộ phận. Không nhận tên, email hay
 * bất cứ thứ gì khác — nguồn duy nhất là chữ đã công bố.
 *
 * Chức danh cụ thể thắng bộ phận ("Sales Manager" ở bộ phận Procurement vẫn là
 * kinh doanh). Chức danh chung chung thì không ("Manager" ở bộ phận Procurement
 * là thu mua) — đó là lúc bộ phận mới nói lên điều gì.
 */
export function classifyRole(title?: string | null, department?: string | null): RoleKind {
  const titleText = normalize(title ?? "");
  const departmentText = normalize(department ?? "");
  if (!titleText && !departmentText) return "unknown";

  const fromTitle = titleText ? classifyText(titleText) : null;
  if (!isGenericRole(fromTitle)) return fromTitle!;

  const fromDepartment = departmentText ? classifyText(departmentText) : null;
  if (!isGenericRole(fromDepartment)) return fromDepartment!;

  // Không bên nào cho nhóm cụ thể: giữ thứ có sẵn (management/other), và chỉ
  // rơi về `other` khi thật sự có chữ nhưng không khớp nhóm nào.
  return fromTitle ?? fromDepartment ?? "other";
}

/** Nhãn hiển thị, có ngôn ngữ. */
export function roleLabel(kind: string, locale: "vi" | "en" = "vi"): string {
  const entry = ROLE_LABELS[kind as RoleKind];
  if (!entry) return locale === "vi" ? "Chưa rõ chức danh" : "Title not found";
  return entry[locale];
}
