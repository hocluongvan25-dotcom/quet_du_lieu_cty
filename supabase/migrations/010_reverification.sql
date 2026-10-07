-- Seekora / Company Intelligence
-- 010: cổng Freshness — hàng đợi đọc lại, và kết quả của lần đọc lại.
--
-- Thiết kế chuẩn nói: `verified_at`, và đọc lại sau 90–180 ngày. 005 đã có
-- `last_seen_at` / `expires_at` (90 ngày) và 006 có `purge_expired_people`. Còn
-- thiếu đúng hai thứ:
--
--   1. Một danh sách những kênh **đã tới hạn đọc lại** (quá `refresh_after_days`
--      kể từ lần cuối thấy), để job biết phải mở lại trang nào.
--   2. Một chỗ ghi **kết quả của lần đọc lại**: còn thấy / không còn thấy /
--      giá trị đã đổi, kèm thời điểm và lý do.
--
-- Nguyên tắc không đổi: **không tìm thấy thì không phải là sai, và cũng không
-- tự động là xác minh.** Một lần đọc lại thấy lại đúng giá trị đó thì mới gọi
-- là còn tươi; không thấy nữa thì hạ xuống; thấy giá trị khác thì ghi cái mới
-- và để cái cũ hết hạn một cách lịch sự.

-- ---------------------------------------------------------------------------
-- A. Hàng đợi đọc lại: cái gì tới hạn, và vì sao.
-- ---------------------------------------------------------------------------
-- Chỉ đọc lại những kênh connector tự tìm được và có trang nguồn. Dòng đến từ
-- sổ đăng ký hay cơ sở dữ liệu mua thì không tự đọc lại được bằng cách mở một
-- trang web — chúng tươi theo nhịp của nguồn đó.
-- Chỉ đọc lại kênh **chưa bị đánh dấu là chết** và còn trong hạn.
create view public.contact_reverify_queue
with (security_invoker = true) as
select
  channel.id as channel_id,
  channel.organization_id,
  channel.buyer_profile_id,
  buyer.domain,
  channel.channel_type,
  channel.value,
  channel.source_url,
  channel.identity_match,
  channel.email_kind,
  channel.certainty,
  channel.is_verified,
  channel.last_seen_at,
  channel.expires_at,
  -- Số ngày kể từ lần cuối thấy. Job chọn ngưỡng (mặc định 90).
  floor(extract(epoch from (now() - channel.last_seen_at)) / 86400)::int as days_since_seen,
  -- Đọc lại sẽ thấy lại đúng giá trị này ở đúng trang kia.
  channel.evidence_snippet as expected_evidence
from public.contact_channels channel
join public.buyer_profiles buyer on buyer.id = channel.buyer_profile_id
where channel.provenance = 'company_site'
  and channel.source_url is not null
  and channel.expires_at > now()
  and channel.deliverability <> 'invalid';

comment on view public.contact_reverify_queue is
  'Kênh đã tới hạn đọc lại: đến từ website công ty, có trang nguồn, chưa bị đánh dấu là chết, còn trong hạn. Job chọn ngưỡng ngày trên view này.';

-- ---------------------------------------------------------------------------
-- B. Kết quả của lần đọc lại.
-- ---------------------------------------------------------------------------
create type public.reverify_outcome as enum (
  'still_present',  -- mở lại trang, vẫn thấy đúng giá trị đó
  'gone',           -- trang mở được, giá trị không còn ở đó nữa
  'changed',        -- trang mở được, nhưng giá trị đã khác
  'unreachable'     -- không mở được trang (mạng, 404, robots chặn) — không kết luận
);

comment on type public.reverify_outcome is
  'Kết quả một lần đọc lại. `unreachable` KHÔNG phải là "không còn": không mở được trang thì không biết gì thêm, nên không được hạ kênh.';

create table public.contact_reverifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null references public.contact_channels(id) on delete cascade,
  buyer_profile_id uuid not null references public.buyer_profiles(id) on delete cascade,
  outcome public.reverify_outcome not null,
  source_url text not null check (nullif(btrim(source_url), '') is not null),
  -- Nguyên văn dòng tìm thấy ở lần đọc này. Có khi vẫn còn thấy; không có khi
  -- không thấy nữa — nếu không thấy thì không có gì để trích.
  evidence_snippet text,
  previous_value text,
  new_value text,
  note text,
  checked_at timestamptz not null default now(),
  -- Chỉ được gọi là "vẫn còn" khi có câu chữ chứng minh.
  check (outcome <> 'still_present' or nullif(btrim(coalesce(evidence_snippet, '')), '') is not null),
  -- "Đổi thành giá trị khác" thì phải nói giá trị mới là gì.
  check (outcome <> 'changed' or nullif(btrim(coalesce(new_value, '')), '') is not null)
);

comment on table public.contact_reverifications is
  'Sổ append-only của mỗi lần đọc lại: thấy gì, ở trang nào, lúc nào. Không sửa dòng cũ, để đọc được lịch sử của một kênh.';

create index contact_reverifications_channel_idx on public.contact_reverifications (channel_id, checked_at desc);
create index contact_reverifications_org_idx on public.contact_reverifications (organization_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- C. Ghi kết quả: mỗi kết quả một hệ quả, viết bằng SQL chứ không để tầng ứng
--    dụng tự nhớ.
-- ---------------------------------------------------------------------------
create function public.record_contact_reverification(
  p_channel_id uuid,
  p_outcome public.reverify_outcome,
  p_source_url text,
  p_evidence_snippet text default null,
  p_new_value text default null,
  p_note text default null,
  p_refresh_days integer default 90
)
returns public.contact_reverifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel public.contact_channels;
  v_event public.contact_reverifications;
begin
  select * into v_channel from public.contact_channels where id = p_channel_id;
  if not found then
    raise exception 'Không có kênh nào với id %', p_channel_id using errcode = 'no_data_found';
  end if;

  insert into public.contact_reverifications
    (organization_id, channel_id, buyer_profile_id, outcome, source_url, evidence_snippet, previous_value, new_value, note)
  values
    (v_channel.organization_id, p_channel_id, v_channel.buyer_profile_id, p_outcome, p_source_url,
     nullif(btrim(coalesce(p_evidence_snippet, '')), ''),
     v_channel.value,
     nullif(btrim(coalesce(p_new_value, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_event;

  if p_outcome = 'still_present' then
    -- Vẫn thấy đúng giá trị đó: làm mới cả lần thấy lẫn hạn. Đây là trường hợp
    -- duy nhất được đẩy `verified_at` tiến lên, vì nó là lần thứ hai đọc lại
    -- đúng nguồn cũ và thấy lại đúng giá trị.
    update public.contact_channels
       set last_seen_at = now(),
           expires_at = now() + make_interval(days => greatest(coalesce(p_refresh_days, 90), 1)),
           verified_at = now()
     where id = p_channel_id;

  elsif p_outcome = 'gone' then
    -- Trang vẫn mở được nhưng giá trị không còn ở đó. Kênh chết, nhưng dòng dữ
    -- liệu ở lại (lịch sử vẫn là sự thật). Hạn về ngay để nó rơi khỏi danh sách
    -- xuất ở lần sweep kế tiếp.
    update public.contact_channels
       set expires_at = least(expires_at, now() - interval '1 second'),
           is_verified = false,
           verification_note = 'Lần đọc lại ngày ' || to_char(now(), 'YYYY-MM-DD') || ': không còn thấy giá trị này trên trang nguồn.'
     where id = p_channel_id;

  elsif p_outcome = 'changed' then
    -- Giá trị đã khác. Kênh cũ hết hiệu lực; kênh mới là một dòng mới, do lần
    -- chạy connector tạo ra. Ghi chú lại để người đọc biết vì sao có hai dòng.
    update public.contact_channels
       set expires_at = least(expires_at, now() - interval '1 second'),
           is_verified = false,
           verification_note = 'Lần đọc lại ngày ' || to_char(now(), 'YYYY-MM-DD') || ': trang đã đổi thành ' || coalesce(p_new_value, '(không rõ)') || '.'
     where id = p_channel_id;

  else
    -- 'unreachable': không mở được trang. Không có gì để kết luận — cố ý để
    -- nguyên hạn và trạng thái. Lần chạy sau sẽ thử lại.
    null;
  end if;

  return v_event;
end;
$$;

comment on function public.record_contact_reverification is
  'Ghi một lần đọc lại và áp hệ quả: still_present → làm mới last_seen_at/expires_at/verified_at; gone hoặc changed → kênh hết hạn và mất cờ xác minh; unreachable → không đổi gì.';

revoke all on function public.record_contact_reverification(uuid, public.reverify_outcome, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_contact_reverification(uuid, public.reverify_outcome, text, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- D. Ai đọc được gì.
-- ---------------------------------------------------------------------------
alter table public.contact_reverifications enable row level security;

create policy "reverifications readable by organization" on public.contact_reverifications
for select using (public.is_organization_member(organization_id));

revoke insert, update, delete on public.contact_reverifications from anon, authenticated;

revoke all on public.contact_reverify_queue from anon;
revoke insert, update, delete on public.contact_reverify_queue from anon, authenticated;
grant select on public.contact_reverify_queue to authenticated, service_role;

grant select on public.contact_reverifications to authenticated, service_role;
