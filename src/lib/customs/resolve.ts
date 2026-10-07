/**
 * Xếp hạng ứng viên hồ sơ khách hàng cho một bên trên tờ khai hải quan.
 *
 * Đây là **gợi ý**, không phải quyết định: hàm trả về danh sách có điểm và lý do,
 * người dùng chọn. Ba luật cứng:
 *
 *  1. Chỉ bên nhận hàng (`importer_side`) mới có ứng viên. Bên gửi hàng là nhà
 *     cung cấp — trả về rỗng, không có ngoại lệ nào.
 *  2. Không đoán bừa: dưới ngưỡng giống nhau thì không trả gì, và mọi ứng viên
 *     đều kèm lý do đọc được.
 *  3. Điểm phản ánh **bằng chứng**, không phải xác suất: trùng tên miền là bằng
 *     chứng mạnh nhất, trùng tên + quốc gia mạnh hơn trùng tên đơn thuần.
 */

import { customsSideFor, countryIso2, nameSimilarity, normalizeCompanyName } from "./normalize";
import type { CustomsMatchMethod, CustomsPartyRole, CustomsSide } from "./types";

export type CustomsPartySubject = {
  role: CustomsPartyRole;
  side?: CustomsSide | null;
  name_as_printed: string;
  name_normalized?: string | null;
  country_as_printed?: string | null;
  /** Mã ISO-2 của bản in, khi lớp nhập đã suy ra được. */
  country_iso2?: string | null;
  website_declared?: string | null;
};

export type CandidateBuyer = {
  id: string;
  legal_name: string;
  display_name?: string | null;
  domain?: string | null;
  country?: string | null;
};

export type BuyerCandidate = {
  buyerProfileId: string;
  label: string;
  score: number;
  method: CustomsMatchMethod;
  reasons: string[];
};

/** Trần gợi ý: hàng đợi là để người xem, không phải để đọc cả danh sách. */
export const MAX_CANDIDATES = 5;
const MIN_SCORE = 40;

function registrable(value?: string | null): string | null {
  const text = (value ?? "").trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const host = text.split("/")[0];
  return host.includes(".") ? host : null;
}

/**
 * Ứng viên cho một bên, xếp theo điểm giảm dần. Trả về mảng rỗng khi bên đó
 * không phải bên nhận hàng, hoặc khi không có gì đủ gần để nói ra.
 */
export function suggestBuyerCandidates(
  party: CustomsPartySubject,
  buyers: CandidateBuyer[],
  limit = MAX_CANDIDATES,
): BuyerCandidate[] {
  const side = party.side ?? customsSideFor(party.role);
  if (side !== "importer_side") return [];

  const partyName = party.name_normalized?.trim() || normalizeCompanyName(party.name_as_printed);
  if (!partyName) return [];

  const partyCountry = party.country_iso2 || countryIso2(party.country_as_printed);
  const partyDomain = registrable(party.website_declared);

  const candidates: BuyerCandidate[] = [];

  buyers.forEach((buyer) => {
    const buyerName = normalizeCompanyName(buyer.legal_name || buyer.display_name || "");
    const buyerDomain = registrable(buyer.domain);
    const reasons: string[] = [];
    let score = 0;
    let method: CustomsMatchMethod = "fuzzy_name";

    if (partyDomain && buyerDomain && partyDomain === buyerDomain) {
      score = 96;
      method = "exact_domain";
      reasons.push(`website trên tờ khai cùng tên miền với hồ sơ (${partyDomain})`);
    }

    if (partyName && buyerName && partyName === buyerName) {
      if (score < 90) {
        score = 80;
        method = "exact_name";
      }
      reasons.push("tên trên tờ khai giống khít tên hồ sơ sau khi bỏ hậu tố pháp nhân");
      const buyerCountry = countryIso2(buyer.country);
      if (partyCountry && buyerCountry && partyCountry === buyerCountry) {
        score = Math.max(score, 88);
        method = method === "exact_domain" ? method : "exact_name_country";
        reasons.push(`cùng quốc gia (${partyCountry})`);
      } else if (partyCountry && !buyerCountry) {
        reasons.push("hồ sơ chưa có quốc gia nên không đối chiếu được phần quốc gia");
      } else if (partyCountry && buyerCountry) {
        reasons.push(`khác quốc gia: tờ khai ${partyCountry}, hồ sơ ${buyerCountry}`);
      }
    } else if (partyName && buyerName) {
      const similarity = nameSimilarity(partyName, buyerName);
      if (similarity >= 0.5) {
        score = 40 + Math.round(similarity * 30);
        method = "fuzzy_name";
        reasons.push(`tên gần giống (${Math.round(similarity * 100)}% từ chung) — cần người xem lại`);
        const buyerCountry = countryIso2(buyer.country);
        if (partyCountry && buyerCountry && partyCountry === buyerCountry) {
          score += 6;
          reasons.push(`cùng quốc gia (${partyCountry})`);
        }
      }
    }

    // Tên miền trên tờ khai mà hồ sơ có tên miền khác: nói ra, vì đây là dấu hiệu
    // mạnh nhất chống lại việc nối nhầm hai công ty cùng tên ở hai nước.
    if (partyDomain && buyerDomain && partyDomain !== buyerDomain) {
      reasons.push(`tên miền khác nhau: tờ khai ${partyDomain}, hồ sơ ${buyerDomain}`);
    }

    if (score >= MIN_SCORE) {
      candidates.push({
        buyerProfileId: buyer.id,
        label: buyer.display_name?.trim() || buyer.legal_name,
        score: Math.min(score, 99),
        method,
        reasons,
      });
    }
  });

  return candidates.sort((left, right) => right.score - left.score || left.label.localeCompare(right.label)).slice(0, limit);
}

/**
 * Có đúng một ứng viên với bằng chứng mạnh (trùng tên miền, hoặc trùng tên khít
 * cùng quốc gia)? Trả về ứng viên đó — để giao diện xếp việc "chắc ăn" lên trước.
 * Vẫn là gợi ý: người dùng bấm mới nối.
 */
export function soleStrongCandidate(candidates: BuyerCandidate[]): BuyerCandidate | null {
  const strong = candidates.filter((candidate) => candidate.method === "exact_domain" || candidate.method === "exact_name_country");
  return strong.length === 1 && strong[0].score >= 88 ? strong[0] : null;
}
