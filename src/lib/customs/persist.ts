/**
 * Tầng ghi dữ liệu hải quan.
 *
 * Hai lớp, giống phần connector:
 *
 *  - `CustomsStore` — hợp đồng ghi, để bộ test chạy được trên Postgres trong
 *    tiến trình (PGlite) đúng như trên Supabase;
 *  - `supabaseCustomsStore(client)` — bản chạy thật, gọi bốn hàm của migration
 *    012 bằng RPC.
 *
 * Mọi luật nằm trong hàm của DB (bên gửi hàng không bao giờ thành khách hàng,
 * hồ sơ khác workspace không nối được, thiếu quốc gia thì không tạo hồ sơ, thiếu
 * `market_sources` thì không ghi). Lớp này chỉ chuyển tham số — không lớp nào ở
 * đây quyết định thay DB.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomsMatchMethod, CustomsMatchStatus, CustomsPartyRole } from "./types";

export type CustomsPartyInput = {
  role: CustomsPartyRole;
  /** Tên đúng như tờ khai in — không sửa. */
  name: string;
  /** Bản chuẩn hoá để so khớp (`normalizeCompanyName`). */
  nameNormalized: string;
  /** Quốc gia đúng như tờ khai in — không viết lại. */
  country?: string | null;
  /** Bản suy ra để đối chiếu (ISO-2), tách khỏi bản in. */
  countryIso2?: string | null;
  address?: string | null;
  website?: string | null;
  /** Tên cột trong file nguồn mà bên này được đọc ra — để tra lại khi cần. */
  column?: string | null;
};

export type CustomsRecordInput = {
  organizationId: string;
  sourceKey: string;
  recordReference: string;
  shipmentDate?: string | null;
  hsCode?: string | null;
  productDescription?: string | null;
  quantity?: number | null;
  quantityUnit?: string | null;
  weightKg?: number | null;
  containers?: number | null;
  valueUsd?: number | null;
  originCountry?: string | null;
  destinationPort?: string | null;
  parties: CustomsPartyInput[];
};

export type CustomsRecordResult = { record_id: string; replayed: boolean };

export type CustomsMatchRow = {
  id: string;
  status: CustomsMatchStatus;
  buyer_profile_id: string | null;
  method: CustomsMatchMethod | null;
  confidence: number | null;
};

export type CustomsLinkInput = {
  partyId: string;
  buyerProfileId: string;
  method: CustomsMatchMethod;
  confidence: number;
  reasons?: string[];
  decidedBy?: string;
};

export type CustomsMarkInput = {
  partyId: string;
  status: Extract<CustomsMatchStatus, "review" | "unmatched">;
  method?: CustomsMatchMethod | null;
  confidence?: number | null;
  reasons?: string[];
  decidedBy?: string;
};

export type CustomsStore = {
  recordRecord(input: CustomsRecordInput): Promise<CustomsRecordResult>;
  link(input: CustomsLinkInput): Promise<CustomsMatchRow>;
  mark(input: CustomsMarkInput): Promise<CustomsMatchRow>;
  createBuyer(input: { partyId: string; decidedBy?: string }): Promise<CustomsMatchRow>;
};

/** Bản chạy thật: bốn hàm `security definer` của 012, cấp cho service_role. */
export function supabaseCustomsStore(client: SupabaseClient): CustomsStore {
  return {
    async recordRecord(input) {
      const { data, error } = await client
        .rpc("record_customs_record", {
          p_organization_id: input.organizationId,
          p_source_key: input.sourceKey,
          p_record_reference: input.recordReference,
          p_shipment_date: input.shipmentDate ?? null,
          p_hs_code: input.hsCode ?? null,
          p_product_description: input.productDescription ?? null,
          p_quantity: input.quantity ?? null,
          p_quantity_unit: input.quantityUnit ?? null,
          p_weight_kg: input.weightKg ?? null,
          p_containers: input.containers ?? null,
          p_value_usd: input.valueUsd ?? null,
          p_origin_country: input.originCountry ?? null,
          p_destination_port: input.destinationPort ?? null,
          p_parties: input.parties.map((party) => ({
            role: party.role,
            name: party.name,
            name_normalized: party.nameNormalized,
            country: party.country ?? null,
            country_iso: party.countryIso2 ?? null,
            address: party.address ?? null,
            website: party.website ?? null,
            column: party.column ?? null,
          })),
        })
        .single();
      if (error) throw new Error(error.message);
      return data as CustomsRecordResult;
    },

    async link(input) {
      const { data, error } = await client
        .rpc("link_customs_party", {
          p_party_id: input.partyId,
          p_buyer_profile_id: input.buyerProfileId,
          p_method: input.method,
          p_confidence: input.confidence,
          p_reasons: input.reasons ?? [],
          p_decided_by: input.decidedBy ?? "resolver",
        })
        .single();
      if (error) throw new Error(error.message);
      return data as CustomsMatchRow;
    },

    async mark(input) {
      const { data, error } = await client
        .rpc("mark_customs_party", {
          p_party_id: input.partyId,
          p_status: input.status,
          p_method: input.method ?? null,
          p_confidence: input.confidence ?? null,
          p_reasons: input.reasons ?? [],
          p_decided_by: input.decidedBy ?? "resolver",
        })
        .single();
      if (error) throw new Error(error.message);
      return data as CustomsMatchRow;
    },

    async createBuyer(input) {
      const { data, error } = await client
        .rpc("create_buyer_from_customs_party", {
          p_party_id: input.partyId,
          p_decided_by: input.decidedBy ?? "resolver",
        })
        .single();
      if (error) throw new Error(error.message);
      return data as CustomsMatchRow;
    },
  };
}
