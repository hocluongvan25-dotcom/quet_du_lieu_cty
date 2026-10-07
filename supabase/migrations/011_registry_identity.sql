-- Seekora / Company Intelligence
-- 011: bước 1 của thiết kế chuẩn có chỗ đứng — đối chiếu pháp nhân với sổ đăng ký.
--
-- Thiết kế chuẩn nói: bước 1 là **Resolve Entity & Domain** — biết chắc đang đọc
-- website của ai trước khi đọc bất cứ thứ gì khác. Từ vòng trước, connector đã
-- tra được sổ đăng ký (UK Companies House, US SEC EDGAR), nhưng kết quả chỉ nằm
-- trong JSON trả về: không có chỗ trong database, nên không hiện được cho người
-- dùng, và không đọc lại được ở lần sau.
--
-- ## Ba quyết định của migration này
--
-- 1. **Chỉ ghi thứ tìm thấy.** Không có dòng nào cho "đã tra nhưng không thấy".
--    Không tìm thấy thì không có gì để nói, và spec §9 đã chốt: thứ không tìm
--    thấy không bao giờ được hiển thị — kể cả dưới dạng một dòng trống.
--
-- 2. **Sổ đăng ký không tạo ra kênh liên hệ.** Sổ không có email, không có điện
--    thoại; nó trả lời câu "đúng pháp nhân này chưa". Vì vậy kết quả nằm ở bảng
--    riêng (`buyer_registry_matches` + `buyer_registry_officers`), **không** đi
--    vào `contact_channels`/`decision_makers`. Người đương nhiệm trong sổ là
--    người của pháp nhân, không phải đầu mối liên hệ của phòng mua hàng.
--
-- 3. **Chạy lại cùng kết quả thì không thêm dòng.** Cùng một sổ, cùng pháp nhân,
--    cùng danh sách người đương nhiệm → chỉ làm mới `checked_at`. Khác đi (đổi
--    tên, đổi tình trạng, thêm/bớt người) → thêm dòng mới, để đọc được lịch sử.
--    Giống hệt cách `contact_channels` xử lý lần chạy lặp.
--
-- ## Vì sao có hàm `record_registry_match` thay vì insert thẳng
--
-- `organization_id` được suy từ chính `buyer_profiles` trong hàm, không nhận từ
-- tham số — người gọi không thể ghi lệch tenant. Hàm cũng từ chối dòng thiếu
-- trang nguồn, thiếu nhãn sổ, hoặc không nêu được tên pháp nhân lẫn số đăng ký;
-- và nó tra `market_sources` để lấy `market_source_id`, nên nguyên tắc "không
-- nguồn nào được lưu nếu chưa có dòng trong `market_sources`" được giữ ở tầng DB.

-- ---------------------------------------------------------------------------
-- A. Từ vựng mới.
-- ---------------------------------------------------------------------------
create type public.registry_source as enum (
  'companies_house', -- UK Companies House (dữ liệu mở theo OGL)
  'sec_edgar'        -- US SEC EDGAR (hồ sơ công khai)
);

comment on type public.registry_source is
  'Sổ đăng ký doanh nghiệp đã đối chiếu. Mỗi sổ có một dòng trong `market_sources` với cùng khoá.';

-- ---------------------------------------------------------------------------
-- B. Lần đối chiếu, và người đương nhiệm theo sổ.
-- ---------------------------------------------------------------------------
create table public.buyer_registry_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_profile_id uuid not null references public.buyer_profiles(id) on delete cascade,
  market_source_id uuid not null references public.market_sources(id) on delete restrict,
  registry public.registry_source not null,
  -- Nhãn hiển thị kèm tên cơ quan ("UK Companies House"). Ghi ở đây để người đọc
  -- sau không phải suy từ enum ra tên cơ quan.
  registry_label text not null check (nullif(btrim(registry_label), '') is not null),
  -- Trang đã đọc để ra kết quả này. Bắt buộc: không có trang thì không có gì.
  source_url text not null check (nullif(btrim(source_url), '') is not null),
  -- Tên mình đã dùng để tra (tên trên tờ khai / tên người dùng nhập) — để đọc
  -- lại biết vì sao sổ trả về pháp nhân này chứ không phải pháp nhân khác.
  queried_name text not null check (nullif(btrim(queried_name), '') is not null),
  registered_name text,
  company_number text,
  -- Tình trạng pháp lý nguyên văn của sổ ("active", "dissolved"…). Không dịch.
  status text,
  -- Ngày thành lập / ngày nộp hồ sơ, giữ dạng chuỗi: sổ trả về ngày thiếu
  -- ("1998-04") và ép thành `date` là tự bịa thêm một ngày không ai công bố.
  incorporated_on text,
  industry text,
  former_names text[] not null default '{}',
  checked_at timestamptz not null default now(),
  -- Một lần đối chiếu phải nêu được ít nhất một thứ định danh pháp nhân.
  constraint buyer_registry_matches_identifies_something
    check (coalesce(nullif(btrim(registered_name), ''), nullif(btrim(company_number), '')) is not null)
);

comment on table public.buyer_registry_matches is
  'Mỗi lần đối chiếu pháp nhân với sổ đăng ký, kèm trang nguồn và thời điểm. Append-only theo kết quả: chạy lại cùng kết quả chỉ làm mới checked_at, kết quả khác thì thêm dòng.';

create index buyer_registry_matches_buyer_idx on public.buyer_registry_matches (buyer_profile_id, checked_at desc);
create index buyer_registry_matches_org_idx on public.buyer_registry_matches (organization_id, checked_at desc);

create table public.buyer_registry_officers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  registry_match_id uuid not null references public.buyer_registry_matches(id) on delete cascade,
  full_name text not null check (nullif(btrim(full_name), '') is not null),
  role_title text,
  appointed_on text
);

comment on table public.buyer_registry_officers is
  'Người đương nhiệm theo sổ đăng ký, gắn với một lần đối chiếu. Chỉ người còn đương nhiệm được ghi — người đã từ nhiệm không phải đầu mối liên hệ và không cần lưu (tối thiểu hoá dữ liệu cá nhân).';

-- Bảng không có cột email/điện thoại, và đó không phải là thiếu sót: sổ đăng ký
-- không công bố hai thứ đó. Có cột ở đây là mở đường cho việc bịa.
create unique index buyer_registry_officers_unique
  on public.buyer_registry_officers (registry_match_id, full_name, coalesce(role_title, ''));
create index buyer_registry_officers_match_idx on public.buyer_registry_officers (registry_match_id);

-- ---------------------------------------------------------------------------
-- C. View đọc: lần đối chiếu mới nhất của mỗi buyer.
-- ---------------------------------------------------------------------------
create view public.buyer_registry_latest
with (security_invoker = true) as
select distinct on (match.buyer_profile_id)
  match.id as registry_match_id,
  match.organization_id,
  match.buyer_profile_id,
  match.registry,
  match.registry_label,
  match.source_url,
  match.queried_name,
  match.registered_name,
  match.company_number,
  match.status,
  match.incorporated_on,
  match.industry,
  match.former_names,
  match.checked_at,
  (select count(*) from public.buyer_registry_officers officer where officer.registry_match_id = match.id)::int as officer_count
from public.buyer_registry_matches match
order by match.buyer_profile_id, match.checked_at desc;

comment on view public.buyer_registry_latest is
  'Lần đối chiếu pháp nhân mới nhất của mỗi buyer — một dòng, để danh sách buyer đọc thẳng không phải tự chọn.';

-- ---------------------------------------------------------------------------
-- D. Ghi: một hàm, ba việc — kiểm, chống trùng, ghi người.
-- ---------------------------------------------------------------------------
create function public.record_registry_match(
  p_buyer_profile_id uuid,
  p_registry public.registry_source,
  p_registry_label text,
  p_source_url text,
  p_queried_name text,
  p_registered_name text default null,
  p_company_number text default null,
  p_status text default null,
  p_incorporated_on text default null,
  p_industry text default null,
  p_former_names text[] default '{}',
  -- [{ "name": "...", "role": "...", "appointed_on": "..." }] — chỉ người đương nhiệm.
  p_officers jsonb default '[]'::jsonb
)
returns public.buyer_registry_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer public.buyer_profiles;
  v_source_id uuid;
  v_previous public.buyer_registry_matches;
  v_previous_officers text[];
  v_new_officers text[];
  v_officers jsonb;
  v_match public.buyer_registry_matches;
begin
  ------------------------------------------------------------------ kiểm ----
  if nullif(btrim(coalesce(p_source_url, '')), '') is null then
    raise exception 'Thiếu trang nguồn: không ghi một lần đối chiếu mà không có trang đã đọc.'
      using errcode = 'invalid_parameter_value';
  end if;

  if nullif(btrim(coalesce(p_registry_label, '')), '') is null then
    raise exception 'Thiếu nhãn sổ đăng ký (tên cơ quan): người đọc phải biết kết quả đến từ sổ nào.'
      using errcode = 'invalid_parameter_value';
  end if;

  if nullif(btrim(coalesce(p_queried_name, '')), '') is null then
    raise exception 'Thiếu tên đã dùng để tra: không đọc lại được vì sao sổ trả về pháp nhân này.'
      using errcode = 'invalid_parameter_value';
  end if;

  if coalesce(nullif(btrim(p_registered_name), ''), nullif(btrim(p_company_number), '')) is null then
    raise exception 'Không có tên pháp nhân lẫn số đăng ký: đây không phải một lần đối chiếu.'
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_typeof(coalesce(p_officers, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách người đương nhiệm phải là một mảng JSON.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Người thiếu tên bị bỏ qua ngay tại đây, thay vì để ràng buộc của bảng ném lỗi
  -- và làm hỏng cả lần ghi — phần còn lại của kết quả vẫn có giá trị.
  v_officers := coalesce((
    select jsonb_agg(element)
    from jsonb_array_elements(coalesce(p_officers, '[]'::jsonb)) as element
    where nullif(btrim(coalesce(element ->> 'name', '')), '') is not null
  ), '[]'::jsonb);

  ------------------------------------------------------------- pháp nhân ----
  select * into v_buyer from public.buyer_profiles where id = p_buyer_profile_id;
  if not found then
    raise exception 'Không có buyer_profile nào với id % — không rõ đối chiếu cho công ty nào.', p_buyer_profile_id
      using errcode = 'no_data_found';
  end if;

  -- Nguyên tắc của 005: không nguồn nào được lưu nếu chưa có dòng trong
  -- `market_sources`. Khoá của sổ trùng tên với enum, nên tra thẳng.
  select id into v_source_id from public.market_sources where key = p_registry::text;
  if v_source_id is null then
    raise exception 'Chưa có market_sources khoá "%" — không ghi được vì thiếu nguồn.', p_registry
      using errcode = 'no_data_found';
  end if;

  ------------------------------------------- lần đối chiếu trước đó ----------
  select * into v_previous
  from public.buyer_registry_matches
  where buyer_profile_id = p_buyer_profile_id and registry = p_registry
  order by checked_at desc
  limit 1;

  if found then
    select coalesce(array_agg(officer.name_key order by officer.name_key), '{}')
      into v_previous_officers
    from (
      select distinct
        officer.full_name || '|' || coalesce(officer.role_title, '') || '|' || coalesce(officer.appointed_on, '') as name_key
      from public.buyer_registry_officers officer
      where officer.registry_match_id = v_previous.id
    ) officer;

    select coalesce(array_agg(entry.name_key order by entry.name_key), '{}')
      into v_new_officers
    from (
      select distinct
        btrim(element ->> 'name') || '|' || coalesce(element ->> 'role', '') || '|' || coalesce(element ->> 'appointed_on', '') as name_key
      from jsonb_array_elements(v_officers) element
    ) entry;

    if v_previous.registered_name is not distinct from nullif(btrim(p_registered_name), '')
       and v_previous.company_number is not distinct from nullif(btrim(p_company_number), '')
       and v_previous.status is not distinct from nullif(btrim(p_status), '')
       and v_previous.incorporated_on is not distinct from nullif(btrim(p_incorporated_on), '')
       and v_previous.industry is not distinct from nullif(btrim(p_industry), '')
       and v_previous.former_names = coalesce(p_former_names, '{}')
       and v_previous_officers = v_new_officers
    then
      -- Cùng pháp nhân, cùng người, cùng tình trạng: đây chỉ là lần đối chiếu
      -- mới nhất. Không thêm dòng nào, chỉ làm mới ngày và trang nguồn.
      update public.buyer_registry_matches
         set checked_at = now(),
             source_url = btrim(p_source_url),
             registry_label = btrim(p_registry_label)
       where id = v_previous.id
      returning * into v_match;

      return v_match;
    end if;
  end if;

  --------------------------------------------------------------- ghi --------
  insert into public.buyer_registry_matches
    (organization_id, buyer_profile_id, market_source_id, registry, registry_label, source_url,
     queried_name, registered_name, company_number, status, incorporated_on, industry, former_names)
  values
    (v_buyer.organization_id, p_buyer_profile_id, v_source_id, p_registry, btrim(p_registry_label), btrim(p_source_url),
     btrim(p_queried_name), nullif(btrim(p_registered_name), ''), nullif(btrim(p_company_number), ''),
     nullif(btrim(p_status), ''), nullif(btrim(p_incorporated_on), ''), nullif(btrim(p_industry), ''),
     coalesce(p_former_names, '{}'))
  returning * into v_match;

  insert into public.buyer_registry_officers (organization_id, registry_match_id, full_name, role_title, appointed_on)
  select distinct
    v_match.organization_id,
    v_match.id,
    btrim(element ->> 'name'),
    nullif(btrim(coalesce(element ->> 'role', '')), ''),
    nullif(btrim(coalesce(element ->> 'appointed_on', '')), '')
  from jsonb_array_elements(v_officers) element
  on conflict do nothing;

  return v_match;
end;
$$;

comment on function public.record_registry_match is
  'Ghi một lần đối chiếu pháp nhân: kiểm dữ liệu bắt buộc, suy organization_id từ buyer_profiles (không nhận từ tham số), tra market_sources theo sổ, và chống trùng — cùng pháp nhân thì chỉ làm mới checked_at.';

revoke all on function public.record_registry_match(
  uuid, public.registry_source, text, text, text, text, text, text, text, text, text[], jsonb
) from public, anon, authenticated;
grant execute on function public.record_registry_match(
  uuid, public.registry_source, text, text, text, text, text, text, text, text, text[], jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- E. Ai đọc được gì.
-- ---------------------------------------------------------------------------
alter table public.buyer_registry_matches enable row level security;
alter table public.buyer_registry_officers enable row level security;

create policy "registry matches readable by organization" on public.buyer_registry_matches
for select using (public.is_organization_member(organization_id));

create policy "registry officers readable by organization" on public.buyer_registry_officers
for select using (public.is_organization_member(organization_id));

revoke insert, update, delete on public.buyer_registry_matches from anon, authenticated;
revoke insert, update, delete on public.buyer_registry_officers from anon, authenticated;

revoke all on public.buyer_registry_latest from anon;
revoke insert, update, delete on public.buyer_registry_latest from anon, authenticated;

grant select on public.buyer_registry_matches to authenticated, service_role;
grant select on public.buyer_registry_officers to authenticated, service_role;
grant select on public.buyer_registry_latest to authenticated, service_role;
