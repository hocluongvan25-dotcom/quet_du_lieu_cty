-- Seekora / Company Intelligence
-- 012: dữ liệu hải quan — vai của từng bên trên tờ khai, và resolve pháp nhân.
--
-- Thiết kế chuẩn gọi bước 1 là **Resolve Entity & Domain**. 011 đã làm phần sổ
-- đăng ký. Tờ khai hải quan là nguồn thứ hai trả lời cùng câu hỏi đó, và là
-- nguồn duy nhất nói được **công ty này nhập hàng gì, từ đâu, khi nào** — thứ
-- mà một lần Google không có.
--
-- ## Vì sao phải tách "vai trên tờ khai" khỏi "có phải khách hàng không"
--
-- Một vận đơn có nhiều bên: người nhập khẩu, người nhận hàng, người gửi hàng,
-- bên được thông báo. Câu hỏi của người dùng là "công ty này là ai trong giao
-- dịch đó". Nhưng kết luận "đây là khách hàng của mình" **không được** trộn vào
-- vai in trên tờ khai:
--
--   * `customs_party_role`  — bên đó được ghi là ai **trên tờ khai** (sự thật).
--   * `customs_side`        — suy ra từ vai: bên nhận hàng hay bên gửi hàng.
--   * `customs_entity_matches` — quyết định của mình: bên này ứng với hồ sơ
--                             khách hàng nào (hoặc chưa ứng với ai).
--
-- Giữ ba thứ riêng là điều kiện để không bao giờ gán nhầm: bên gửi hàng — tức
-- nhà cung cấp, tức chính khách hàng của người dùng — **không bao giờ** được
-- ghi thành một hồ sơ khách hàng mua hàng. Điều đó được ép bằng ràng buộc ở
-- tầng DB (`customs_entity_matches_side_can_link`), không phải bằng lời nhắc
-- trong tài liệu.
--
-- ## Nguồn dữ liệu
--
-- Không có nguồn nào được ghi nếu chưa có dòng trong `market_sources` (005).
-- Luật đó được giữ nguyên ở đây: mỗi lần nhập phải khai khoá nguồn, và khoá đó
-- phải tồn tại. Tờ khai là dữ liệu mua hoặc dữ liệu công khai của hải quan; cả
-- hai đều đi qua cùng một cửa.

-- ---------------------------------------------------------------------------
-- A. Từ vựng: vai trên tờ khai, và bên nào của giao dịch.
-- ---------------------------------------------------------------------------
create type public.customs_party_role as enum (
  'importer',      -- người nhập khẩu
  'consignee',     -- người nhận hàng
  'shipper',       -- người gửi hàng (nhà xuất khẩu)
  'notify_party',  -- bên được thông báo
  'other'          -- có tên trên tờ khai nhưng vai không thuộc nhóm trên
);

comment on type public.customs_party_role is
  'Vai của một bên **như tờ khai ghi**. Đây là sự thật của nguồn, không phải kết luận của mình — kết luận nằm ở customs_entity_matches.';

create type public.customs_side as enum (
  'importer_side', -- bên nhận hàng: importer, consignee
  'exporter_side', -- bên gửi hàng: shipper (nhà xuất khẩu)
  'unknown'        -- notify_party, other: không được suy thành bên nào
);

comment on type public.customs_side is
  'Bên nào của giao dịch. `notify_party` cố ý để `unknown`: bên được thông báo có thể là hãng tàu, ngân hàng, hoặc đại lý hải quan — suy ra bên mua từ đó là đoán.';

create function public.customs_side_for(p_role public.customs_party_role)
returns public.customs_side
language sql
immutable
as $$
  select case
    when p_role in ('importer', 'consignee') then 'importer_side'::public.customs_side
    when p_role = 'shipper' then 'exporter_side'::public.customs_side
    else 'unknown'::public.customs_side
  end;
$$;

comment on function public.customs_side_for(public.customs_party_role) is
  'Vai → bên của giao dịch. Bản sao bằng SQL của customsSideFor() trong src/lib/customs/normalize.ts; test đối chiếu hai bản.';

-- ---------------------------------------------------------------------------
-- B. Tờ khai và các bên trên tờ khai — tầng sự thật, append-only.
-- ---------------------------------------------------------------------------
create table public.customs_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  market_source_id uuid not null references public.market_sources(id) on delete restrict,
  -- Số vận đơn / số tờ khai. Bắt buộc: không có khoá thì nhập hai lần sẽ nhân đôi.
  record_reference text not null check (nullif(btrim(record_reference), '') is not null),
  shipment_date date,
  -- Mã HS giữ **nguyên như nguồn ghi**; việc gom nhóm thea chữ số làm ở view.
  hs_code text,
  product_description text,
  quantity numeric,
  quantity_unit text,
  weight_kg numeric,
  containers integer,
  value_usd numeric,
  origin_country text,
  destination_port text,
  captured_at timestamptz not null default now(),
  unique (organization_id, market_source_id, record_reference)
);

comment on table public.customs_records is
  'Một dòng cho mỗi vận đơn/tờ khai. Chỉ ghi thứ nguồn công bố: thiếu cột nào thì để trống cột đó, không suy.';

create index customs_records_org_date_idx on public.customs_records (organization_id, shipment_date desc);
create index customs_records_hs_idx on public.customs_records (hs_code);

create table public.customs_record_parties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customs_record_id uuid not null references public.customs_records(id) on delete cascade,
  role public.customs_party_role not null,
  side public.customs_side not null default 'unknown',
  -- Tên **nguyên như tờ khai in**. Không sửa, không dịch, không rút gọn.
  name_as_printed text not null check (nullif(btrim(name_as_printed), '') is not null),
  -- Tên đã chuẩn hoá để so khớp: bỏ dấu, bỏ hậu tố pháp nhân, viết thường.
  -- Đây là bản sao để tra, không phải bản thay thế bản in.
  name_normalized text not null check (nullif(btrim(name_normalized), '') is not null),
  -- Quốc gia **đúng như tờ khai in** ("Viet Nam", "UNITED KINGDOM") — đây là thứ
  -- hiển thị. country_iso2 là bản suy ra để đối chiếu, tách riêng đúng như
  -- value / phone_e164 của bảng kênh: bản in không bao giờ bị viết lại.
  country_as_printed text,
  country_iso2 text check (country_iso2 is null or country_iso2 ~ '^[A-Z]{2}$'),
  address_as_printed text,
  -- Nếu file có cột website/domain cho bên này thì giữ lại: đó là khoá mạnh
  -- nhất để nối với hồ sơ khách hàng, và nó do nguồn công bố.
  website_declared text,
  -- Tên cột trong file nguồn ("Shipper Name", "Buyer", "Consignee"...). Giữ lại
  -- để luôn đọc được vì sao mình xếp bên này vào vai kia.
  source_column text,
  created_at timestamptz not null default now(),
  unique (customs_record_id, role, name_normalized)
);

comment on table public.customs_record_parties is
  'Các bên trên một tờ khai, tên nguyên như nguồn in, kèm tên chuẩn hoá để so khớp. Bảng này không có cột liên hệ nào — tờ khai không công bố email hay điện thoại.';

create index customs_record_parties_record_idx on public.customs_record_parties (customs_record_id);
create index customs_record_parties_name_idx on public.customs_record_parties (organization_id, name_normalized);
create index customs_record_parties_side_idx on public.customs_record_parties (organization_id, side);

-- Ghi vai xuống cột `side` ngay khi ghi bên, để ràng buộc ở bảng quyết định đọc
-- được một cột thay vì gọi hàm trong CHECK.
create function public.customs_record_parties_set_side()
returns trigger
language plpgsql
as $$
begin
  new.side := public.customs_side_for(new.role);
  return new;
end;
$$;

create trigger customs_record_parties_side
before insert or update of role on public.customs_record_parties
for each row execute function public.customs_record_parties_set_side();

-- ---------------------------------------------------------------------------
-- C. Quyết định: bên này ứng với hồ sơ khách hàng nào.
-- ---------------------------------------------------------------------------
create type public.customs_match_method as enum (
  'exact_domain',         -- website trong file trùng tên miền hồ sơ
  'exact_name_country',   -- tên chuẩn hoá trùng, cùng quốc gia
  'exact_name',           -- tên chuẩn hoá trùng, chưa chắc quốc gia
  'fuzzy_name',           -- gần giống: cần người xác nhận
  'created_from_customs', -- tạo hồ sơ mới từ chính tờ khai
  'manual'                -- người quyết
);

create type public.customs_match_status as enum (
  'linked',   -- đã nối với một hồ sơ khách hàng có sẵn
  'created',  -- hồ sơ khách hàng được tạo từ chính tờ khai này
  'review',   -- có ứng viên nhưng chưa đủ chắc — chờ người quyết
  'unmatched' -- chưa có ứng viên nào
);

comment on type public.customs_match_status is
  '`review` khác `unmatched`: review là có ứng viên nhưng không đủ chắc để tự nối; unmatched là chưa thấy ứng viên nào. Hai câu trả lời khác nhau.';

create table public.customs_entity_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customs_party_id uuid not null references public.customs_record_parties(id) on delete cascade,
  buyer_profile_id uuid references public.buyer_profiles(id) on delete set null,
  status public.customs_match_status not null,
  method public.customs_match_method,
  confidence smallint check (confidence between 0 and 100),
  reasons text[] not null default '{}',
  -- Bên của giao dịch, chép lại lúc quyết. Bảng bên là append-only nên bản chép
  -- này không lệch; nó tồn tại để ràng buộc bên dưới đọc được.
  side public.customs_side not null,
  decided_by text not null default 'resolver',
  decided_at timestamptz not null default now(),
  -- Mỗi bên chỉ có một quyết định hiện hành. Lịch sử nằm ở tầng sự thật (các
  -- bên trên tờ khai), không nằm ở đây.
  unique (customs_party_id),
  -- Nối được thì phải có hồ sơ; không nối được thì không được có hồ sơ.
  constraint customs_entity_matches_link_has_profile
    check ((status in ('linked', 'created')) = (buyer_profile_id is not null)),
  -- LUẬT CỦA CẢ BẢNG: bên gửi hàng (nhà xuất khẩu, tức nhà cung cấp của người
  -- dùng) không bao giờ được ghi thành khách hàng mua hàng.
  constraint customs_entity_matches_side_can_link
    check (side = 'importer_side' or buyer_profile_id is null)
);

comment on table public.customs_entity_matches is
  'Quyết định của mình về từng bên trên tờ khai: ứng với hồ sơ khách hàng nào, hoặc chờ người xem. Ràng buộc customs_entity_matches_side_can_link chặn việc gán bên gửi hàng thành khách hàng.';

create index customs_entity_matches_buyer_idx on public.customs_entity_matches (buyer_profile_id);
create index customs_entity_matches_org_status_idx on public.customs_entity_matches (organization_id, status);

-- ---------------------------------------------------------------------------
-- D. Ghi: nhập tờ khai, nối bên, tạo hồ sơ từ tờ khai.
-- ---------------------------------------------------------------------------
-- Nhập một tờ khai và các bên của nó. Nhập lại cùng số vận đơn thì không tạo
-- dòng mới — trả về dòng đã có kèm cờ replayed = true.
create function public.record_customs_record(
  p_organization_id uuid,
  p_source_key text,
  p_record_reference text,
  p_shipment_date date default null,
  p_hs_code text default null,
  p_product_description text default null,
  p_quantity numeric default null,
  p_quantity_unit text default null,
  p_weight_kg numeric default null,
  p_containers integer default null,
  p_value_usd numeric default null,
  p_origin_country text default null,
  p_destination_port text default null,
  -- [{ "role": "shipper", "name": "...", "name_normalized": "...",
  --    "country": "...", "country_iso": "VN", "address": "...", "website": "...",
  --    "column": "Shipper Name" }]
  -- `country` là bản in, `country_iso` là bản suy ra để đối chiếu — hai cột riêng.
  p_parties jsonb default '[]'::jsonb
)
returns table (record_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_id uuid;
  v_record public.customs_records;
  v_allowed text[];
begin
  if nullif(btrim(coalesce(p_record_reference, '')), '') is null then
    raise exception 'Thiếu số vận đơn/tờ khai: không có khoá thì nhập hai lần sẽ nhân đôi dữ liệu.'
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_typeof(coalesce(p_parties, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách các bên phải là một mảng JSON.' using errcode = 'invalid_parameter_value';
  end if;

  -- Nguyên tắc 005: không nguồn nào được lưu nếu chưa có dòng trong market_sources.
  select id into v_source_id from public.market_sources where key = btrim(p_source_key);
  if v_source_id is null then
    raise exception 'Chưa có market_sources khoá "%" — không ghi được vì thiếu nguồn.', p_source_key
      using errcode = 'no_data_found';
  end if;

  insert into public.customs_records
    (organization_id, market_source_id, record_reference, shipment_date, hs_code, product_description,
     quantity, quantity_unit, weight_kg, containers, value_usd, origin_country, destination_port)
  values
    (p_organization_id, v_source_id, btrim(p_record_reference), p_shipment_date, nullif(btrim(p_hs_code), ''),
     nullif(btrim(p_product_description), ''), p_quantity, nullif(btrim(p_quantity_unit), ''), p_weight_kg,
     p_containers, p_value_usd, nullif(btrim(p_origin_country), ''), nullif(btrim(p_destination_port), ''))
  on conflict (organization_id, market_source_id, record_reference) do nothing
  returning * into v_record;

  if not found then
    -- Đã nhập ở lần trước: dùng lại dòng cũ, không tạo bản sao, và nói rõ là
    -- nhập lại để người nhập biết file này đã vào rồi.
    select * into v_record
    from public.customs_records
    where organization_id = p_organization_id
      and market_source_id = v_source_id
      and record_reference = btrim(p_record_reference);
    record_id := v_record.id;
    replayed := true;
    -- Hàm trả TABLE thì phải RETURN NEXT mới thật sự phát ra dòng.
    return next;
  end if;

  -- Vai lạ bị bỏ qua thay vì làm hỏng cả lần nhập.
  select array_agg(role::text) into v_allowed from unnest(enum_range(null::public.customs_party_role)) as role;

  insert into public.customs_record_parties
    (organization_id, customs_record_id, role, name_as_printed, name_normalized,
     country_as_printed, country_iso2, address_as_printed, website_declared, source_column)
  select
    v_record.organization_id,
    v_record.id,
    (element ->> 'role')::public.customs_party_role,
    btrim(element ->> 'name'),
    btrim(element ->> 'name_normalized'),
    nullif(btrim(coalesce(element ->> 'country', '')), ''),
    nullif(upper(btrim(coalesce(element ->> 'country_iso', ''))), ''),
    nullif(btrim(coalesce(element ->> 'address', '')), ''),
    nullif(btrim(coalesce(element ->> 'website', '')), ''),
    nullif(btrim(coalesce(element ->> 'column', '')), '')
  from jsonb_array_elements(coalesce(p_parties, '[]'::jsonb)) as element
  where nullif(btrim(coalesce(element ->> 'name', '')), '') is not null
    and nullif(btrim(coalesce(element ->> 'name_normalized', '')), '') is not null
    and element ->> 'role' = any (v_allowed)
  on conflict (customs_record_id, role, name_normalized) do nothing;

  record_id := v_record.id;
  replayed := false;
  return next;
end;
$$;

comment on function public.record_customs_record is
  'Nhập một tờ khai và các bên của nó; trả về id và cờ replayed (true = số vận đơn đã có từ trước, không tạo bản sao). Bên thiếu tên hoặc vai lạ bị bỏ qua, phần còn lại vẫn ghi.';

-- Nối một bên với hồ sơ khách hàng. Từ chối mọi thứ không phải bên nhận hàng, và
-- tự ghi luôn dòng vận đơn vào trade_signals để "đã nối" luôn đi kèm "có lịch sử".
create function public.link_customs_party(
  p_party_id uuid,
  p_buyer_profile_id uuid,
  p_method public.customs_match_method,
  p_confidence smallint,
  p_reasons text[] default '{}',
  p_decided_by text default 'resolver'
)
returns public.customs_entity_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.customs_record_parties;
  v_record public.customs_records;
  v_buyer public.buyer_profiles;
  v_counterparty public.customs_record_parties;
  v_match public.customs_entity_matches;
  v_status public.customs_match_status;
begin
  select * into v_party from public.customs_record_parties where id = p_party_id;
  if not found then
    raise exception 'Không có bên nào với id %', p_party_id using errcode = 'no_data_found';
  end if;

  if v_party.side <> 'importer_side' then
    raise exception 'Bên "%" có vai % — chỉ bên nhận hàng (importer/consignee) mới được nối thành khách hàng.',
      v_party.name_as_printed, v_party.role
      using errcode = 'check_violation';
  end if;

  select * into v_buyer from public.buyer_profiles where id = p_buyer_profile_id;
  if not found then
    raise exception 'Không có buyer_profile nào với id %', p_buyer_profile_id using errcode = 'no_data_found';
  end if;

  if v_buyer.organization_id <> v_party.organization_id then
    raise exception 'Hồ sơ khách hàng thuộc workspace khác — không nối được.'
      using errcode = 'check_violation';
  end if;

  v_status := case when p_method = 'created_from_customs' then 'created'::public.customs_match_status
                  else 'linked'::public.customs_match_status end;

  insert into public.customs_entity_matches
    (organization_id, customs_party_id, buyer_profile_id, status, method, confidence, reasons, side, decided_by)
  values
    (v_party.organization_id, p_party_id, p_buyer_profile_id, v_status, p_method, p_confidence,
     coalesce(p_reasons, '{}'), v_party.side, coalesce(nullif(btrim(p_decided_by), ''), 'resolver'))
  on conflict (customs_party_id) do update
    set buyer_profile_id = excluded.buyer_profile_id,
        status = excluded.status,
        method = excluded.method,
        confidence = excluded.confidence,
        reasons = excluded.reasons,
        decided_by = excluded.decided_by,
        decided_at = now()
  returning * into v_match;

  -- Vận đơn vào bảng trade_signals: đây là chỗ lịch sử nhập khẩu sống, và view
  -- buyer_customs_summary đọc từ đó. Bên gửi hàng, nếu tờ khai có, thành nhà
  -- cung cấp của lô hàng.
  select * into v_record from public.customs_records where id = v_party.customs_record_id;

  select * into v_counterparty
  from public.customs_record_parties
  where customs_record_id = v_record.id and side = 'exporter_side'
  limit 1;

  insert into public.trade_signals
    (organization_id, buyer_profile_id, market_source_id, shipment_date, supplier_name, supplier_country,
     hs_code, product_description, quantity, quantity_unit, weight_kg, containers, value_usd,
     origin_country, destination_port, record_reference)
  values
    (v_record.organization_id, p_buyer_profile_id, v_record.market_source_id, v_record.shipment_date,
     v_counterparty.name_as_printed, v_counterparty.country_as_printed,
     v_record.hs_code, v_record.product_description, v_record.quantity, v_record.quantity_unit,
     v_record.weight_kg, v_record.containers, v_record.value_usd,
     v_record.origin_country, v_record.destination_port, v_record.record_reference)
  on conflict (buyer_profile_id, market_source_id, record_reference) do nothing;

  -- first_signal_at / last_signal_at là để danh sách biết công ty này hoạt động
  -- gần đây không; chỉ đẩy khi tờ khai có ngày.
  if v_record.shipment_date is not null then
    update public.buyer_profiles
       set first_signal_at = least(coalesce(first_signal_at, v_record.shipment_date), v_record.shipment_date),
           last_signal_at = greatest(coalesce(last_signal_at, v_record.shipment_date), v_record.shipment_date),
           updated_at = now()
     where id = p_buyer_profile_id;
  end if;

  return v_match;
end;
$$;

comment on function public.link_customs_party is
  'Nối một bên nhận hàng với hồ sơ khách hàng, ghi lô hàng vào trade_signals, và từ chối mọi bên không phải importer/consignee.';

-- Ghi lại một bên là "chờ người xem" hoặc "chưa có ứng viên".
create function public.mark_customs_party(
  p_party_id uuid,
  p_status public.customs_match_status,
  p_method public.customs_match_method default null,
  p_confidence smallint default null,
  p_reasons text[] default '{}',
  p_decided_by text default 'resolver'
)
returns public.customs_entity_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.customs_record_parties;
  v_match public.customs_entity_matches;
begin
  if p_status not in ('review', 'unmatched') then
    raise exception 'Chỉ ghi được trạng thái review hoặc unmatched ở đây; dùng link_customs_party để nối.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_party from public.customs_record_parties where id = p_party_id;
  if not found then
    raise exception 'Không có bên nào với id %', p_party_id using errcode = 'no_data_found';
  end if;

  insert into public.customs_entity_matches
    (organization_id, customs_party_id, buyer_profile_id, status, method, confidence, reasons, side, decided_by)
  values
    (v_party.organization_id, p_party_id, null, p_status, p_method, p_confidence,
     coalesce(p_reasons, '{}'), v_party.side, coalesce(nullif(btrim(p_decided_by), ''), 'resolver'))
  on conflict (customs_party_id) do update
    set buyer_profile_id = null,
        status = excluded.status,
        method = excluded.method,
        confidence = excluded.confidence,
        reasons = excluded.reasons,
        decided_by = excluded.decided_by,
        decided_at = now()
  returning * into v_match;

  return v_match;
end;
$$;

comment on function public.mark_customs_party is
  'Ghi một bên là review (có ứng viên, chờ người quyết) hoặc unmatched (chưa có ứng viên). Không dùng để nối — nối là link_customs_party.';

-- Tạo hồ sơ khách hàng từ một bên nhận hàng trên tờ khai. Chỉ làm khi chính
-- người dùng yêu cầu, và từ chối nếu không đủ dữ kiện để biết đang nói về ai.
create function public.create_buyer_from_customs_party(
  p_party_id uuid,
  p_decided_by text default 'resolver'
)
returns public.customs_entity_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.customs_record_parties;
  v_record public.customs_records;
  v_existing_match public.customs_entity_matches;
  v_same_name integer;
  v_buyer_id uuid;
  v_new_buyer public.buyer_profiles;
begin
  select * into v_party from public.customs_record_parties where id = p_party_id;
  if not found then
    raise exception 'Không có bên nào với id %', p_party_id using errcode = 'no_data_found';
  end if;

  if v_party.side <> 'importer_side' then
    raise exception 'Bên "%" có vai % — chỉ tạo được hồ sơ khách hàng từ bên nhận hàng.',
      v_party.name_as_printed, v_party.role
      using errcode = 'check_violation';
  end if;

  if nullif(btrim(coalesce(v_party.country_as_printed, '')), '') is null then
    raise exception 'Bên "%" không có quốc gia trên tờ khai — không tạo hồ sơ khách hàng khi chưa biết ở đâu.',
      v_party.name_as_printed
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_existing_match from public.customs_entity_matches where customs_party_id = p_party_id;
  if found and v_existing_match.status in ('linked', 'created') then
    raise exception 'Bên này đã được nối với một hồ sơ khách hàng rồi.' using errcode = 'check_violation';
  end if;

  -- Đã có hồ sơ nào mang đúng tên đó chưa? Có đúng một → dùng lại. Nhiều hơn
  -- một → không đoán, chuyển cho người xem.
  select count(*) into v_same_name
  from public.buyer_profiles profile
  where profile.organization_id = v_party.organization_id
    and (lower(btrim(profile.legal_name)) = lower(btrim(v_party.name_as_printed))
      or lower(btrim(profile.display_name)) = lower(btrim(v_party.name_as_printed)));

  if v_same_name > 1 then
    return public.mark_customs_party(
      p_party_id, 'review', 'fuzzy_name', 30::smallint,
      array['nhiều hồ sơ khách hàng cùng tên trong workspace — cần người chọn đúng hồ sơ'],
      p_decided_by
    );
  end if;

  if v_same_name = 1 then
    select profile.id into v_buyer_id
    from public.buyer_profiles profile
    where profile.organization_id = v_party.organization_id
      and (lower(btrim(profile.legal_name)) = lower(btrim(v_party.name_as_printed))
        or lower(btrim(profile.display_name)) = lower(btrim(v_party.name_as_printed)))
    limit 1;

    return public.link_customs_party(
      p_party_id, v_buyer_id, 'exact_name', 80::smallint,
      array['hồ sơ khách hàng đã có, tên trùng khít với tên trên tờ khai'],
      p_decided_by
    );
  end if;

  select * into v_record from public.customs_records where id = v_party.customs_record_id;

  insert into public.buyer_profiles
    (organization_id, legal_name, display_name, country, address, domain, website, first_signal_at, last_signal_at)
  values
    (v_party.organization_id, v_party.name_as_printed, v_party.name_as_printed, v_party.country_as_printed,
     v_party.address_as_printed, null, null, v_record.shipment_date, v_record.shipment_date)
  returning * into v_new_buyer;

  return public.link_customs_party(
    p_party_id, v_new_buyer.id, 'created_from_customs', 70::smallint,
    array['hồ sơ được tạo từ tờ khai hải quan: nguồn nói công ty này đã nhập hàng, chưa xác minh website'],
    p_decided_by
  );
end;
$$;

comment on function public.create_buyer_from_customs_party is
  'Tạo hồ sơ khách hàng từ một bên nhận hàng trên tờ khai. Từ chối bên gửi hàng, từ chối khi thiếu quốc gia, dùng lại hồ sơ nếu tên trùng khít, và chuyển cho người xem nếu có nhiều hồ sơ cùng tên.';

revoke all on function public.customs_side_for(public.customs_party_role) from public, anon, authenticated;
revoke all on function public.record_customs_record(uuid, text, text, date, text, text, numeric, text, numeric, integer, numeric, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.link_customs_party(uuid, uuid, public.customs_match_method, smallint, text[], text) from public, anon, authenticated;
revoke all on function public.mark_customs_party(uuid, public.customs_match_status, public.customs_match_method, smallint, text[], text) from public, anon, authenticated;
revoke all on function public.create_buyer_from_customs_party(uuid, text) from public, anon, authenticated;

grant execute on function public.customs_side_for(public.customs_party_role) to service_role;
grant execute on function public.record_customs_record(uuid, text, text, date, text, text, numeric, text, numeric, integer, numeric, text, text, jsonb) to service_role;
grant execute on function public.link_customs_party(uuid, uuid, public.customs_match_method, smallint, text[], text) to service_role;
grant execute on function public.mark_customs_party(uuid, public.customs_match_status, public.customs_match_method, smallint, text[], text) to service_role;
grant execute on function public.create_buyer_from_customs_party(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- E. Đọc: tóm tắt nhập khẩu cho danh sách buyer, và hàng đợi cho người xem.
-- ---------------------------------------------------------------------------
-- Một dòng cho mỗi buyer đã nối với ít nhất một tờ khai. Mọi con số ở đây đều
-- đếm được từ dữ liệu nguồn — không có ô nào là suy đoán.
create view public.buyer_customs_summary
with (security_invoker = true) as
select
  match.organization_id,
  match.buyer_profile_id,
  count(distinct record.id)::int as records_count,
  min(record.shipment_date) as first_shipment,
  max(record.shipment_date) as last_shipment,
  -- Mã HS ở cấp 6 chữ số (HS6) — cấp dùng chung của bảng mã quốc tế. "0801.32.00"
  -- và "080132" cho cùng một mã; phần chữ số quốc gia thêm vào bị bỏ để gom nhóm
  -- được. Bản in đầy đủ vẫn nằm nguyên trong customs_records.hs_code.
  (array_agg(distinct left(regexp_replace(record.hs_code, '[^0-9]', '', 'g'), 6)
      order by left(regexp_replace(record.hs_code, '[^0-9]', '', 'g'), 6))
     filter (where nullif(left(regexp_replace(coalesce(record.hs_code, ''), '[^0-9]', '', 'g'), 6), '') is not null))[1:6] as hs_codes,
  (array_agg(distinct record.product_description order by record.product_description)
     filter (where record.product_description is not null))[1:4] as product_samples,
  (array_agg(distinct supplier.country order by supplier.country)
     filter (where supplier.country is not null))[1:8] as supplier_countries,
  (array_agg(distinct supplier.name order by supplier.name)
     filter (where supplier.name is not null))[1:4] as supplier_names,
  (array_agg(distinct source.display_name order by source.display_name))[1:4] as source_labels,
  (array_agg(distinct match.method::text) filter (where match.method is not null))[1:4] as match_methods,
  max(match.decided_at) as last_decided_at
from public.customs_entity_matches match
join public.customs_record_parties party on party.id = match.customs_party_id
join public.customs_records record on record.id = party.customs_record_id
join public.market_sources source on source.id = record.market_source_id
left join lateral (
  select counterparty.country_as_printed as country, counterparty.name_as_printed as name
  from public.customs_record_parties counterparty
  where counterparty.customs_record_id = record.id and counterparty.side = 'exporter_side'
) supplier on true
where match.buyer_profile_id is not null
group by match.organization_id, match.buyer_profile_id;

comment on view public.buyer_customs_summary is
  'Tóm tắt lịch sử nhập khẩu của mỗi buyer, đếm từ chính các tờ khai đã nối: số lô, khoảng thời gian, mã HS, mô tả hàng, nhà cung cấp, nguồn.';

-- Vai của chính công ty đó trên các tờ khai. Một công ty có thể vừa nhập vừa
-- xuất; đây là chỗ nói ra điều đó thay vì giả định.
create view public.buyer_customs_roles
with (security_invoker = true) as
select
  match.organization_id,
  match.buyer_profile_id,
  party.role,
  match.side,
  count(distinct record.id)::int as records_count,
  max(record.shipment_date) as last_shipment
from public.customs_entity_matches match
join public.customs_record_parties party on party.id = match.customs_party_id
join public.customs_records record on record.id = party.customs_record_id
where match.buyer_profile_id is not null
group by match.organization_id, match.buyer_profile_id, party.role, match.side;

comment on view public.buyer_customs_roles is
  'Vai của buyer trên từng tờ khai đã nối (importer/consignee/shipper...), kèm số lô. Chỉ hiện thứ có thật trong dữ liệu.';

-- Hàng đợi cho người xem: các bên nhận hàng chưa nối với hồ sơ nào, kèm bên đối
-- tác để người xem thấy bối cảnh. Chỉ bên nhận hàng vào đây — bên gửi hàng
-- không phải việc cần quyết.
create view public.customs_resolution_queue
with (security_invoker = true) as
select
  party.id as customs_party_id,
  party.organization_id,
  party.role,
  party.side,
  party.name_as_printed,
  party.name_normalized,
  party.country_as_printed,
  party.country_iso2,
  party.address_as_printed,
  party.website_declared,
  party.source_column,
  record.id as customs_record_id,
  record.record_reference,
  record.shipment_date,
  record.hs_code,
  record.product_description,
  source.display_name as source_label,
  source.key as source_key,
  match.status as match_status,
  match.method as match_method,
  match.confidence as match_confidence,
  match.reasons as match_reasons,
  (select counterparty.name_as_printed from public.customs_record_parties counterparty
    where counterparty.customs_record_id = record.id and counterparty.side = 'exporter_side' limit 1) as counterparty_name,
  (select counterparty.country_as_printed from public.customs_record_parties counterparty
    where counterparty.customs_record_id = record.id and counterparty.side = 'exporter_side' limit 1) as counterparty_country
from public.customs_record_parties party
join public.customs_records record on record.id = party.customs_record_id
join public.market_sources source on source.id = record.market_source_id
left join public.customs_entity_matches match on match.customs_party_id = party.id
where party.side = 'importer_side'
  and (match.id is null or match.status in ('review', 'unmatched'))
order by record.shipment_date desc nulls last, party.name_as_printed;

comment on view public.customs_resolution_queue is
  'Bên nhận hàng chưa nối với hồ sơ khách hàng nào: có ứng viên (review) hoặc chưa có (unmatched), kèm bên đối tác để người xem có bối cảnh.';

-- ---------------------------------------------------------------------------
-- F. Ai đọc được gì.
-- ---------------------------------------------------------------------------
alter table public.customs_records enable row level security;
alter table public.customs_record_parties enable row level security;
alter table public.customs_entity_matches enable row level security;

create policy "customs records readable by organization" on public.customs_records
for select using (public.is_organization_member(organization_id));

create policy "customs parties readable by organization" on public.customs_record_parties
for select using (public.is_organization_member(organization_id));

create policy "customs matches readable by organization" on public.customs_entity_matches
for select using (public.is_organization_member(organization_id));

revoke insert, update, delete on public.customs_records from anon, authenticated;
revoke insert, update, delete on public.customs_record_parties from anon, authenticated;
revoke insert, update, delete on public.customs_entity_matches from anon, authenticated;

revoke all on public.buyer_customs_summary from anon;
revoke all on public.buyer_customs_roles from anon;
revoke all on public.customs_resolution_queue from anon;
revoke insert, update, delete on public.buyer_customs_summary from anon, authenticated;
revoke insert, update, delete on public.buyer_customs_roles from anon, authenticated;
revoke insert, update, delete on public.customs_resolution_queue from anon, authenticated;

grant select on public.customs_records to authenticated, service_role;
grant select on public.customs_record_parties to authenticated, service_role;
grant select on public.customs_entity_matches to authenticated, service_role;
grant select on public.buyer_customs_summary to authenticated, service_role;
grant select on public.buyer_customs_roles to authenticated, service_role;
grant select on public.customs_resolution_queue to authenticated, service_role;
