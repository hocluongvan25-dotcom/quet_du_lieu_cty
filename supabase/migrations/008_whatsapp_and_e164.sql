-- Seekora / Company Intelligence
-- 008: số điện thoại chuẩn E.164, và WhatsApp.
--
-- Yêu cầu (07/10/2026): WhatsApp quan trọng với khách B2B xuất nhập khẩu, nên
--   (1) số điện thoại phải được chuẩn hoá về E.164,
--   (2) database phải có trường `has_whatsapp`,
--   (3) sau này cắm API kiểm tra WhatsApp thì UI mở được nút `wa.me/<phone>`.
--
-- Nguyên tắc giữ nguyên như 007: cột nào cũng phải nói được nó đến từ đâu.
--
--   * `phone_e164` chỉ là **bản chuẩn hoá** của số đã công bố; `value` vẫn giữ
--     nguyên như trên trang. Số nội địa mà chưa biết quốc gia thì `phone_e164`
--     để trống — tự thêm mã quốc gia là đoán, và một mã sai sẽ mở cuộc trò
--     chuyện với người lạ qua `wa.me`.
--   * `has_whatsapp` là boolean **ba trạng thái**: `null` = chưa ai kiểm,
--     `true` = đã kiểm và có, `false` = đã kiểm và không. Không có mặc định
--     `false`, vì "chưa kiểm" khác "đã kiểm và không có".

-- ---------------------------------------------------------------------------
-- A. Số chuẩn hoá + trạng thái WhatsApp.
-- ---------------------------------------------------------------------------
alter table public.contact_channels
  add column phone_e164 text
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  add column has_whatsapp boolean,
  add column whatsapp_checked_at timestamptz,
  add column whatsapp_checked_by text;

comment on column public.contact_channels.phone_e164 is
  'Số đã chuẩn hoá E.164. Chỉ điền khi số đã là quốc tế trên trang, hoặc khi biết quốc gia của công ty để cắt số 0 đầu và ghép mã quốc gia.';
comment on column public.contact_channels.has_whatsapp is
  'NULL = chưa kiểm (mọi dòng connector ghi ra đều vậy). TRUE = đã kiểm bằng một dịch vụ và có WhatsApp. FALSE = đã kiểm và không có. Một dòng channel_type = ''whatsapp'' là kênh công bố sẵn, khác với trường này.';
comment on column public.contact_channels.whatsapp_checked_by is
  'Tên dịch vụ đã trả lời. Bắt buộc khi has_whatsapp = true — nếu không thì "có WhatsApp" là một lời khẳng định không có ai chịu trách nhiệm.';

-- ---------------------------------------------------------------------------
-- B. Ràng buộc: ba câu hỏi phải trả lời được.
-- ---------------------------------------------------------------------------
alter table public.contact_channels
  -- Chỉ số điện thoại mới có bản E.164.
  add constraint contact_channels_e164_is_phone
    check (phone_e164 is null or channel_type = 'phone'),
  -- Nói "có WhatsApp" thì phải có lần kiểm.
  add constraint contact_channels_whatsapp_needs_check
    check (has_whatsapp is null or whatsapp_checked_at is not null),
  -- Và lần kiểm đó phải do một dịch vụ cụ thể thực hiện.
  add constraint contact_channels_whatsapp_needs_provider
    check (has_whatsapp is not true or nullif(btrim(coalesce(whatsapp_checked_by, '')), '') is not null),
  -- Không mở nút wa.me bằng một số chưa biết mã quốc gia.
  add constraint contact_channels_whatsapp_needs_e164
    check (has_whatsapp is not true or phone_e164 is not null);

-- ---------------------------------------------------------------------------
-- C. Nút WhatsApp cho UI — view riêng, không đụng vào view policy của 006.
-- ---------------------------------------------------------------------------
-- `contact_export_policy` đã có ba view phụ thuộc; sửa nó là phải bỏ ra dựng
-- lại cả cụm. Thay vào đó một view nhỏ chỉ trả những số **đã kiểm là có
-- WhatsApp**, kèm link dựng từ chính `phone_e164`.
create view public.contact_whatsapp_links
with (security_invoker = true) as
select
  channel.id as channel_id,
  channel.organization_id,
  channel.buyer_profile_id,
  channel.decision_maker_id,
  channel.value as published_value,
  channel.phone_e164,
  -- wa.me cần đúng chữ số quốc tế, không có dấu +.
  'https://wa.me/' || substr(channel.phone_e164, 2) as whatsapp_url,
  channel.source_url,
  channel.whatsapp_checked_at,
  channel.whatsapp_checked_by,
  channel.last_seen_at
from public.contact_channels channel
where channel.has_whatsapp is true
  and channel.phone_e164 is not null
  and channel.expires_at > now();

comment on view public.contact_whatsapp_links is
  'Số đã kiểm là có WhatsApp, kèm link wa.me dựng từ phone_e164. Chỉ những dòng có lần kiểm mới xuất hiện, nên UI có thể tin view này.';

revoke all on public.contact_whatsapp_links from anon;
revoke insert, update, delete on public.contact_whatsapp_links from anon, authenticated;
grant select on public.contact_whatsapp_links to authenticated, service_role;
