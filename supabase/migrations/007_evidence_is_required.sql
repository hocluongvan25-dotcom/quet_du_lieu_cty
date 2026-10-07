-- Seekora / Company Intelligence
-- 007: bằng chứng là điều kiện bắt buộc, và đường duy nhất để một kênh thành "đã xác minh".
--
-- Thiết kế chuẩn (06/10/2026) nói hai điều mà 005/006 chưa buộc được ở tầng dữ liệu:
--   1. Một liên hệ chỉ được lưu khi có câu trích dẫn nguyên văn + trang nguồn.
--      005 đã buộc `source_url` cho dòng `confirmed`; `evidence_snippet` thì vẫn
--      cho phép NULL, nên vẫn lọt được một giá trị mà không ai chỉ ra được nó
--      nằm ở đâu. Migration này đóng nốt lỗ đó.
--   2. `is_verified` phải là kết quả của một lần kiểm tra thứ hai, không phải cờ
--      ai cũng bật được. Trước đây chỉ có ràng buộc "không được verified nếu
--      biết là hỏng", còn đường bật thì mở.
--
-- Không có bảng nào bị đổi tên, không có enum nào bị viết lại: dữ liệu đã lưu
-- vẫn đọc được bằng đúng những câu SQL cũ.

-- ---------------------------------------------------------------------------
-- A. Câu trích dẫn: từ "nên có" thành "bắt buộc".
-- ---------------------------------------------------------------------------
-- `evidence_url` chỉ là bản sao có tên rõ ràng của `source_url`, để câu SQL đọc
-- bằng chứng không phải biết tên cột cũ. Không phải cột thứ hai để ghi vào.
alter table public.contact_channels
  add column evidence_url text generated always as (nullif(btrim(coalesce(source_url, '')), '')) stored;

comment on column public.contact_channels.evidence_url is
  'Trang đã đọc ra giá trị này, dưới tên gọi rõ nghĩa. Là bản sao của source_url (cột cũ vẫn giữ để tương thích).';
comment on column public.contact_channels.evidence_snippet is
  'Nguyên văn dòng trên trang nguồn chứa giá trị. Bắt buộc với mọi dòng confirmed: giá trị không chỉ ra được chỗ thì không phải là một liên hệ.';

alter table public.contact_channels
  add constraint contact_channels_confirmed_needs_quote
  check (certainty <> 'confirmed' or nullif(btrim(coalesce(evidence_snippet, '')), '') is not null);

-- ---------------------------------------------------------------------------
-- B. Hồ sơ LinkedIn cá nhân không bao giờ là kênh của công ty.
-- ---------------------------------------------------------------------------
-- Đây là quy tắc đã có trong code (extract.ts bỏ /in/ ngay từ đầu, persist.ts
-- chặn lần hai). Đưa vào database để một thay đổi sau này không âm thầm phá nó:
-- một URL /in/ chỉ được tồn tại khi nó thuộc về một người có tên trong hệ thống.
alter table public.contact_channels
  add constraint contact_channels_personal_profile_needs_person
  check (channel_type <> 'linkedin_url' or value not like '%linkedin.com/in/%' or decision_maker_id is not null);

comment on constraint contact_channels_personal_profile_needs_person on public.contact_channels is
  'Hồ sơ /in/ chỉ là kênh của một người cụ thể đã có trong decision_makers; nó không được đứng một mình như kênh của công ty.';

-- ---------------------------------------------------------------------------
-- C. Đường duy nhất để một kênh thành "đã xác minh".
-- ---------------------------------------------------------------------------
-- Không có policy update nào trên contact_channels, và insert/update/delete đã
-- bị thu hồi khỏi anon/authenticated (005). Nghĩa là từ nay `is_verified = true`
-- chỉ đến từ đây: một lần kiểm tra thứ hai, tự chối câu trả lời mơ hồ.
create function public.verify_contact_channel(p_channel_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.contact_channels
     set is_verified = true,
         verified_at = now(),
         verified_by = 'verifier',
         last_seen_at = now()
   where id = p_channel_id
     -- Bốn điều kiện, đúng bốn câu hỏi của một lần kiểm tra thật:
     and certainty <> 'inferred'                                              -- không xác minh một phỏng đoán
     and deliverability <> 'invalid'                                          -- không xác minh một hộp thư đã biết là chết
     and nullif(btrim(coalesce(source_url, '')), '') is not null              -- phải chỉ ra được trang
     and nullif(btrim(coalesce(evidence_snippet, '')), '') is not null        -- và câu chữ đã thấy nó
  returning true into v_ok;

  -- Không đủ điều kiện thì trả false, không ném lỗi: người gọi cần biết là
  -- "chưa xác minh được", không phải một ngoại lệ khó hiểu.
  return coalesce(v_ok, false);
end;
$$;

comment on function public.verify_contact_channel(uuid) is
  'Lần kiểm tra thứ hai: bật is_verified cho một kênh, nếu kênh đó không phải phỏng đoán, không phải hộp thư hỏng, và có đủ trang nguồn + câu trích dẫn. Trả false khi chưa đủ điều kiện.';

revoke all on function public.verify_contact_channel(uuid) from public, anon, authenticated;
grant execute on function public.verify_contact_channel(uuid) to service_role;
