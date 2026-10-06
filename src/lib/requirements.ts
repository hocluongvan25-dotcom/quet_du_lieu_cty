/**
 * Điều kiện & giấy tờ mà nhà nhập khẩu công bố đối với nhà cung cấp.
 *
 * Đây là **dữ liệu**, không phải lời khuyên: mỗi mục là một câu chữ thật của
 * nhà nhập khẩu, kèm trang/file đã thấy nó. Hàm không suy diễn, không sinh mục
 * từ kiến thức chung: không có câu yêu cầu trong nguồn thì không có mục nào.
 *
 * Nhãn tiếng Việt là bản dịch tên loại giấy tờ; phần `detail` giữ **nguyên văn**
 * câu của nhà nhập khẩu, vì đó mới là bằng chứng.
 */

export type RequirementCategory = "certification" | "document" | "audit" | "terms" | "labelling";

export type RequirementTerm = {
  /** Ký hiệu nhận dạng trong nguồn (tên chứng nhận, loại giấy tờ…). */
  match: RegExp;
  label: { vi: string; en: string };
  category: RequirementCategory;
};

export type Requirement = {
  id: string;
  category: RequirementCategory;
  /** Nhãn ngắn tiếng Việt, ví dụ "Chứng nhận BRCGS". */
  label: string;
  /** Nguyên văn câu của nhà nhập khẩu. */
  detail: string;
  sourceUrl: string;
  kind: "html" | "pdf";
  certainty: "confirmed";
};

export const REQUIREMENT_TERMS: RequirementTerm[] = [
  { match: /\bBRC(?:GS)?\b|British Retail Consortium/i, label: { vi: "Chứng nhận BRCGS", en: "BRCGS certification" }, category: "certification" },
  { match: /\bSQF\b/i, label: { vi: "Chứng nhận SQF", en: "SQF certification" }, category: "certification" },
  { match: /\bFSSC\s?22000\b/i, label: { vi: "Chứng nhận FSSC 22000", en: "FSSC 22000" }, category: "certification" },
  { match: /\bHACCP\b/i, label: { vi: "HACCP", en: "HACCP" }, category: "certification" },
  { match: /\bISO\s?22000\b/i, label: { vi: "ISO 22000", en: "ISO 22000" }, category: "certification" },
  { match: /\bISO\s?9001\b/i, label: { vi: "ISO 9001", en: "ISO 9001" }, category: "certification" },
  { match: /\bGMP\b|\bGHP\b/i, label: { vi: "GMP / GHP", en: "GMP / GHP" }, category: "certification" },
  { match: /\bGlobalG\.?A\.?P\.?\b/i, label: { vi: "GlobalG.A.P.", en: "GlobalG.A.P." }, category: "certification" },
  { match: /\bSMETA\b|\bSedex\b/i, label: { vi: "SMETA / Sedex", en: "SMETA / Sedex" }, category: "audit" },
  { match: /\bBSCI\b|amfori/i, label: { vi: "amfori BSCI", en: "amfori BSCI" }, category: "audit" },
  { match: /\bSA\s?8000\b/i, label: { vi: "SA8000", en: "SA8000" }, category: "audit" },
  { match: /\bFDA\b/i, label: { vi: "Đăng ký cơ sở với FDA (Mỹ)", en: "FDA facility registration" }, category: "document" },
  { match: /\bFSVP\b/i, label: { vi: "FSVP — nghĩa vụ của nhà nhập khẩu Mỹ", en: "FSVP" }, category: "document" },
  { match: /\borganic\b|hữu cơ/i, label: { vi: "Chứng nhận hữu cơ", en: "Organic certification" }, category: "certification" },
  { match: /\bKosher\b/i, label: { vi: "Chứng nhận Kosher", en: "Kosher" }, category: "certification" },
  { match: /\bHalal\b/i, label: { vi: "Chứng nhận Halal", en: "Halal" }, category: "certification" },
  { match: /certificate of analysis|\bCOA\b|\bCoA\b/i, label: { vi: "Giấy phân tích chất lượng (COA)", en: "Certificate of analysis" }, category: "document" },
  { match: /certificate of origin|\bCOO\b|\bC\/O\b/i, label: { vi: "Giấy chứng nhận xuất xứ (COO)", en: "Certificate of origin" }, category: "document" },
  { match: /phytosanitary/i, label: { vi: "Giấy kiểm dịch thực vật", en: "Phytosanitary certificate" }, category: "document" },
  { match: /fumigation/i, label: { vi: "Giấy hun trùng (fumigation)", en: "Fumigation certificate" }, category: "document" },
  { match: /health certificate/i, label: { vi: "Giấy chứng nhận an toàn thực phẩm", en: "Health certificate" }, category: "document" },
  { match: /product liability|liability insurance|insurance certificate/i, label: { vi: "Bảo hiểm trách nhiệm sản phẩm", en: "Product liability insurance" }, category: "document" },
  { match: /\bW-?9\b/i, label: { vi: "Mẫu W-9 (Mỹ)", en: "W-9 form" }, category: "document" },
  { match: /food safety plan|haccp plan/i, label: { vi: "Kế hoạch an toàn thực phẩm", en: "Food safety plan" }, category: "document" },
  { match: /traceab/i, label: { vi: "Truy xuất nguồn gốc", en: "Traceability" }, category: "document" },
  { match: /specification sheet|product specification|\bspec sheet\b/i, label: { vi: "Phiếu thông số sản phẩm", en: "Product specification" }, category: "document" },
  { match: /pesticide residue|\bMRL\b|maximum residue/i, label: { vi: "Dư lượng thuốc bảo vệ thực vật (MRL)", en: "Pesticide residue / MRL" }, category: "document" },
  { match: /aflatoxin|heavy metal/i, label: { vi: "Chỉ tiêu aflatoxin / kim loại nặng", en: "Aflatoxin / heavy metals" }, category: "document" },
  { match: /label(?:l)?ing|labelled|labeled|nutrition facts/i, label: { vi: "Yêu cầu nhãn mác", en: "Labelling" }, category: "labelling" },
  { match: /allergen/i, label: { vi: "Công bố chất gây dị ứng", en: "Allergen declaration" }, category: "labelling" },
  { match: /third[- ]party audit|site audit|factory audit|social audit/i, label: { vi: "Chịu kiểm tra của bên thứ ba", en: "Third-party audit" }, category: "audit" },
  { match: /\bMOQ\b|minimum order quantity|minimum quantity/i, label: { vi: "Số lượng đặt tối thiểu (MOQ)", en: "Minimum order quantity" }, category: "terms" },
  { match: /payment terms|letter of credit|\bL\/C\b|irrevocable/i, label: { vi: "Điều khoản thanh toán", en: "Payment terms" }, category: "terms" },
  { match: /lead time|delivery time|shipping window/i, label: { vi: "Thời gian giao hàng", en: "Lead time" }, category: "terms" },
  { match: /pre[- ]shipment sample|sample approval|samples? (?:are )?required/i, label: { vi: "Mẫu trước khi giao", en: "Pre-shipment sample" }, category: "terms" },
];

/**
 * Dấu hiệu "đây là yêu cầu". Bắt buộc phải có — nếu không thì một câu giới thiệu
 * ("we are BRCGS certified") sẽ bị đọc nhầm thành yêu cầu đối với nhà cung cấp.
 */
const REQUIREMENT_CUE =
  /\b(?:must|shall|required|require[ds]?|mandatory|comply|compliance|need(?:s)? to|provide|submit|approval|approved|qualify|qualification|audited|verif(?:y|ied)|accept(?:ed|able)?|prior to (?:shipment|order)|before (?:shipping|shipment|ordering))\b|yêu cầu|phải|cần cung cấp|đáp ứng|bắt buộc/i;

/**
 * Điều khoản thương mại tự nó đã là dữ liệu: câu "Our minimum order quantity is
 * one container and payment terms are net 30 days" không có chữ "must" nào nhưng
 * chính là điều nhà cung cấp cần biết. Các cụm này được tính như dấu hiệu yêu cầu.
 */
const TERMS_CUE = /minimum order quantity|\bMOQ\b|payment terms|letter of credit|\bL\/C\b|net \d+ days|lead time|delivery time|shipping window|pre-?shipment sample|sample approval/i;

/**
 * Câu nói về **chính nhà nhập khẩu** ("chúng tôi đạt BRCGS", "nhà máy của chúng
 * tôi được audit") không phải yêu cầu đối với nhà cung cấp. Chỉ bỏ qua khi câu
 * không hướng tới nhà cung cấp — nếu có "suppliers must…" thì vẫn là yêu cầu.
 */
const SELF_STATEMENT =
  /\bwe (?:are|were|have|hold|own|operate)\b|\bour (?:own )?(?:facility|facilities|plant|plants|site|sites|company|factory|factories|operation|operations|brand|store|stores)\b/i;
const SUPPLIER_DIRECTED = /suppliers?\b|vendors?\b|nhà cung cấp|you (?:must|shall|need|are required)|all (?:suppliers|vendors)/i;

/** Tiêu đề mở đầu một danh sách yêu cầu — dùng cho các gạch đầu dòng bên dưới. */
const REQUIREMENT_HEADING =
  /supplier (?:requirement|approval|qualification|standard|expectation)|vendor (?:requirement|approval|qualification)|requirements? (?:for|of) (?:supplier|vendor)|required documents?|what we (?:require|need|look for)|supplier documents?|documentation required|yêu cầu (?:đối với )?nhà cung cấp|giấy tờ (?:cần|cần có)/i;

function clip(value: string, max = 240): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function idFor(category: RequirementCategory, label: string, sourceUrl: string, detail: string): string {
  const raw = `${category}-${label}-${sourceUrl}-${detail}`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) hash = (hash * 31 + raw.charCodeAt(index)) | 0;
  return `req-${Math.abs(hash).toString(36)}`;
}

/**
 * Có tiêu đề danh sách yêu cầu ở ngay trên dòng này không (trong vòng 4 dòng).
 * Nhờ vậy các gạch đầu dòng ngắn kiểu "– BRCGS, level AA" vẫn được tính.
 */
export function hasRequirementHeadingAbove(lines: string[], index: number, lookBack = 4): boolean {
  for (let cursor = Math.max(0, index - lookBack); cursor < index; cursor += 1) {
    if (REQUIREMENT_HEADING.test(lines[cursor])) return true;
  }
  return false;
}

export type FindRequirementsInput = {
  url: string;
  lines: string[];
  kind?: "html" | "pdf";
};

/**
 * Tìm các yêu cầu trong một nguồn đã đọc. Chỉ trả về mục khi:
 *  1. dòng có ký hiệu của một loại giấy tờ/chứng nhận trong danh mục, **và**
 *  2. dòng có dấu hiệu yêu cầu, **hoặc** dòng nằm ngay dưới một tiêu đề yêu cầu.
 */
export function findRequirements({ url, lines, kind = "html" }: FindRequirementsInput): Requirement[] {
  const found: Requirement[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const text = line.replace(/\s+/g, " ").trim();
    if (text.length < 8) return;

    const hasCue = REQUIREMENT_CUE.test(text) || TERMS_CUE.test(text);
    const inRequirementSection = hasRequirementHeadingAbove(lines, index);
    if (!hasCue && !inRequirementSection) return;

    // "Chúng tôi đạt X" / "nhà máy của chúng tôi được audit" là chuyện của chính
    // nhà nhập khẩu, không phải điều kiện đặt ra cho nhà cung cấp.
    if (SELF_STATEMENT.test(text) && !SUPPLIER_DIRECTED.test(text)) return;

    const terms = REQUIREMENT_TERMS.filter((term) => term.match.test(text));
    if (terms.length === 0) return;

    const detail = clip(text);
    terms.forEach((term) => {
      const label = term.label.vi;
      const key = `${label}|${detail}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({
        id: idFor(term.category, label, url, detail),
        category: term.category,
        label,
        detail,
        sourceUrl: url,
        kind,
        certainty: "confirmed",
      });
    });
  });

  return found;
}

/** Gộp yêu cầu từ nhiều nguồn: cùng nhãn + cùng câu chữ thì giữ một mục. */
export function mergeRequirements(existing: Requirement[], incoming: Requirement[]): Requirement[] {
  const merged = [...existing];
  const keys = new Set(existing.map((item) => `${item.label}|${item.detail}`));
  incoming.forEach((item) => {
    const key = `${item.label}|${item.detail}`;
    if (keys.has(key)) return;
    keys.add(key);
    merged.push(item);
  });
  return merged;
}

/**
 * Sắp xếp để người đọc thấy việc nặng trước: chứng nhận → audit → giấy tờ →
 * điều khoản → nhãn mác. Trong cùng nhóm thì giữ thứ tự đã thấy trên nguồn.
 */
export function sortRequirements(items: Requirement[]): Requirement[] {
  const order: RequirementCategory[] = ["certification", "audit", "document", "terms", "labelling"];
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => order.indexOf(a.item.category) - order.indexOf(b.item.category) || a.index - b.index)
    .map((entry) => entry.item);
}
