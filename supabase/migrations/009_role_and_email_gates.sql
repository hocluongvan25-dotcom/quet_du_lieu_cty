-- Seekora / Company Intelligence
-- 009: hai cổng còn thiếu có chỗ đứng — Role và Email.
--
-- Thiết kế chuẩn (06/10/2026) yêu cầu:
--   * Cổng Role: người này có phải đầu mối mua hàng không?
--   * Cổng Email: `published_named` / `published_role_mailbox` /
--     `inferred_unverified` — và `inferred_unverified` bị loại.
--
-- Trước migration này cả hai câu chỉ được suy lại từ chuỗi chức danh ở mỗi chỗ
-- dùng, nên mỗi nơi trả lời một kiểu, và không có gì để chặn.
--
-- ## Không đổi tên thứ đang chạy
--
-- `identity_match` (006) đã trả lời câu "địa chỉ này của ai" và đang được dùng
-- ở view, loader và CSV. Nó **được giữ nguyên**. `email_kind` trả lời câu khác:
-- "địa chỉ này được công bố thế nào". Hai trục khác nhau, nên hai cột:
--
--   identity_match = person          + email_kind = published_named
--   identity_match = department      + email_kind = published_role_mailbox
--   identity_match = company_general + email_kind = published_role_mailbox
--   email_kind = inferred_unverified + identity_match = unknown   (bị loại, 006)
--
-- Không có bảng nào bị đổi tên; cột mới mặc định `unknown` nên dữ liệu cũ đọc
-- được y như trước.

-- ---------------------------------------------------------------------------
-- A. Từ vựng mới.
-- ---------------------------------------------------------------------------
create type public.role_kind as enum (
  'procurement',   -- thu mua
  'purchasing',    -- mua hàng
  'sourcing',      -- tìm nguồn hàng
  'supply_chain',  -- chuỗi cung ứng (nhiều công ty thực phẩm đặt quyết định ở đây)
  'quality',       -- chất lượng / kỹ thuật / an toàn thực phẩm
  'logistics',     -- logistics, xuất nhập khẩu, hải quan
  'sales',         -- kinh doanh
  'management',    -- ban lãnh đạo
  'other',         -- có chức danh nhưng không thuộc nhóm nào ở trên
  'unknown'        -- chưa tìm được chức danh
);

comment on type public.role_kind is
  'Nhóm chức danh suy từ chính chữ đã công bố. `other` (có chức danh, không khớp nhóm) khác `unknown` (chưa có chức danh) — hai câu hỏi khác nhau.';

create type public.email_kind as enum (
  'published_named',        -- email công bố ngay cạnh tên một người
  'published_role_mailbox', -- hộp thư công bố của bộ phận hoặc của công ty
  'inferred_unverified',    -- email tự đoán theo pattern, chưa ai kiểm
  'unknown'                 -- không phải email, hoặc chưa đủ dữ kiện để nói
);

comment on type public.email_kind is
  'Cách một địa chỉ được công bố. Trực giao với identity_match: cái sau nói "của ai", cái này nói "công bố thế nào".';

-- ---------------------------------------------------------------------------
-- B. Gắn vào hai bảng đang chạy.
-- ---------------------------------------------------------------------------
alter table public.decision_makers
  add column role_kind public.role_kind not null default 'unknown';

comment on column public.decision_makers.role_kind is
  'Phân loại một lần lúc ghi, để cổng Role đọc cùng một giá trị thay vì mỗi chỗ suy lại từ chuỗi chức danh.';

alter table public.contact_channels
  add column email_kind public.email_kind not null default 'unknown';

comment on column public.contact_channels.email_kind is
  'Với email: cách địa chỉ được công bố. Hộp thư bộ phận công bố (published_role_mailbox) vẫn là kênh hợp lệ và xuất được — nó không phải "đoán".';

-- Luật ba nhãn của Email Gate, ghi thẳng vào schema:
create function public.email_kind_for(p_identity public.identity_match, p_certainty public.channel_certainty)
returns public.email_kind
language sql
immutable
as $$
  select case
    when p_certainty = 'inferred' then 'inferred_unverified'::public.email_kind
    when p_identity = 'person' then 'published_named'::public.email_kind
    when p_identity in ('department', 'company_general') then 'published_role_mailbox'::public.email_kind
    else 'unknown'::public.email_kind
  end;
$$;

comment on function public.email_kind_for(public.identity_match, public.channel_certainty) is
  'Ba nhãn của Email Gate, suy từ hai trục đã có: inferred → inferred_unverified; công bố cạnh tên người → published_named; công bố của bộ phận/công ty → published_role_mailbox.';

alter table public.contact_channels
  -- Ba nhãn phải khớp với hai trục đang có, không được nói ngược nhau.
  add constraint contact_channels_email_kind_consistent
  check (
    email_kind = 'unknown'
    or channel_type <> 'email'
    or email_kind = public.email_kind_for(identity_match, certainty)
  );

-- ---------------------------------------------------------------------------
-- C. Cổng Role và cổng Email, mỗi cổng một view.
-- ---------------------------------------------------------------------------
-- Tách khỏi `contact_export_policy` (006) là cố ý: `contact_export_policy` là
-- luật xuất dữ liệu (được ra CSV hay không). Cổng là luật **chọn** (có phải
-- đầu mối mua hàng không — có được gọi không). Hai câu hỏi khác nhau, và người
-- dùng cuối quyết định cái thứ hai.

create view public.contact_role_gate
with (security_invoker = true) as
select
  channel.id as channel_id,
  channel.organization_id,
  channel.buyer_profile_id,
  channel.decision_maker_id,
  channel.channel_type,
  channel.value,
  person.full_name,
  person.job_title,
  person.department,
  coalesce(person.role_kind, 'unknown'::public.role_kind) as role_kind,
  -- Kênh của bộ phận/công ty không có người: không có chức danh để xét, và theo
  -- thiết kế thì đi cửa bộ phận trước khi cần tên người.
  (channel.decision_maker_id is null or coalesce(person.role_kind, 'unknown'::public.role_kind)
     in ('procurement', 'purchasing', 'sourcing', 'supply_chain')) as passes_role_gate
from public.contact_channels channel
left join public.decision_makers person on person.id = channel.decision_maker_id;

comment on view public.contact_role_gate is
  'Cổng Role: một kênh qua được khi nó không gắn với người nào (đường bộ phận), hoặc gắn với người có role_kind thuộc nhóm mua hàng.';

create view public.contact_email_gate
with (security_invoker = true) as
select
  channel.id as channel_id,
  channel.organization_id,
  channel.buyer_profile_id,
  channel.channel_type,
  channel.value,
  channel.certainty,
  channel.identity_match,
  channel.email_kind,
  -- Ba nhãn ở đây, và chỉ nhãn `inferred_unverified` bị loại.
  channel.channel_type <> 'email'
    or channel.email_kind in ('published_named', 'published_role_mailbox') as passes_email_gate,
  case
    when channel.channel_type <> 'email' then null
    when channel.email_kind = 'inferred_unverified' then 'inferred_unverified'
    when channel.email_kind = 'unknown' then 'email_kind_unknown'
    else null
  end as blocked_reason
from public.contact_channels channel;

comment on view public.contact_email_gate is
  'Cổng Email: nhận published_named và published_role_mailbox; loại inferred_unverified. Địa chỉ thuộc bộ phận hay công ty vẫn qua được — nó được công bố, không phải đoán.';

-- ---------------------------------------------------------------------------
-- D. Ai đọc được gì.
-- ---------------------------------------------------------------------------
alter table public.contact_channels enable row level security;
-- (đã bật từ 005; câu này để migration đọc được như một tài liệu khép kín)

revoke all on public.contact_role_gate from anon;
revoke all on public.contact_email_gate from anon;
revoke insert, update, delete on public.contact_role_gate from anon, authenticated;
revoke insert, update, delete on public.contact_email_gate from anon, authenticated;
grant select on public.contact_role_gate to authenticated, service_role;
grant select on public.contact_email_gate to authenticated, service_role;

revoke all on function public.email_kind_for(public.identity_match, public.channel_certainty) from public, anon, authenticated;
grant execute on function public.email_kind_for(public.identity_match, public.channel_certainty) to service_role;
