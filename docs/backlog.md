# Backlog — việc đã ghi nhận, chưa làm xong

Mỗi mục ghi rõ: ai yêu cầu, đang ở đâu, còn thiếu gì, và điều kiện để làm được.
Không phải danh sách mong muốn — chỉ những thứ đã được nói ra và chưa xong.

---

## 1. WhatsApp cho khách B2B xuất nhập khẩu

**Người yêu cầu:** người dùng, 07/10/2026.
**Lý do:** khách B2B xuất nhập khẩu dùng WhatsApp như kênh chính, không phải email.

Yêu cầu gồm ba phần. Trạng thái từng phần:

| # | Yêu cầu | Trạng thái |
| --- | --- | --- |
| 1 | Cào được `phone` thì parse về **E.164** (có mã quốc gia `+…`) | ✅ **xong** — `src/lib/connector/phone.ts`, cột `contact_channels.phone_e164` (migration 008) |
| 2 | Thêm trường **`has_whatsapp`** (boolean) trong DB | ✅ **xong** — migration 008, kèm `whatsapp_checked_at` + `whatsapp_checked_by` |
| 3 | Cắm API kiểm WhatsApp + nút `wa.me/<phone>` trên UI | 🟡 **một nửa** — DB + view + nút đã sẵn; **chờ dịch vụ kiểm** để điền `has_whatsapp = true` |

### Phần 3 còn thiếu đúng một thứ: dịch vụ kiểm WhatsApp

Nút `wa.me` **đã có** ở danh sách buyer, nhưng nó chỉ hiện khi `has_whatsapp = true`, và hiện tại **chưa có gì điền giá trị đó** — nên nút đang nằm im, đúng như thiết kế: không kiểm thì không hiện.

Để bật, cần một trong hai:

- **API kiểm số có WhatsApp** (ví dụ một dịch vụ kiểm WhatsApp Business, hoặc tự gọi endpoint công khai của WhatsApp — cần đánh giá điều khoản trước), hoặc
- **Nguồn công bố**: trang công ty để link `wa.me/…` → khi đó số đó là số WhatsApp do chính công ty công bố, và được ghi thành một kênh `whatsapp` với URL nguyên văn (đường này **đã chạy** — `extract.ts` đọc link `wa.me`/`whatsapp.com`).

Khi cắm dịch vụ kiểm, việc phải làm là một bước ghi:

```sql
update public.contact_channels
   set has_whatsapp = true, whatsapp_checked_at = now(), whatsapp_checked_by = '<tên dịch vụ>'
 where id = '<channel-id>';
```

Ràng buộc trong DB đã sẵn: `has_whatsapp = true` mà thiếu `whatsapp_checked_by` hoặc thiếu `phone_e164` thì bị từ chối. Sau đó `public.contact_whatsapp_links` tự trả `whatsapp_url`, và UI tự hiện nút — không phải sửa thêm dòng code nào.

### Điều đã phải quyết khi làm phần 1 (và lý do)

Yêu cầu "parse về E.164" xung đột một phần với quy tắc đã thống nhất từ đầu dự án: **không tự thêm mã quốc gia chưa từng thấy** (có test riêng trong `connector:test`).

Cách dung hoà, đã chốt trong `phone.ts`:

- Số đã có `+` hoặc viết theo lối `00` → **đã là quốc tế**, chỉ làm sạch. Luôn làm được.
- Số nội địa **và biết quốc gia** (người dùng nhập, sau này là tờ khai hải quan) → cắt số đầu theo đúng thông lệ nước đó rồi ghép mã quốc gia. Đây là suy ra từ dữ kiện đang có, không phải đoán.
- Số nội địa **mà không biết quốc gia** → **không** thêm mã quốc gia; ghi lại lý do.

Lý do không nới quy tắc: số E.164 là thứ mở `wa.me/<số>`. Một mã quốc gia sai **không chỉ là dữ liệu xấu** — nó mở cuộc trò chuyện với một người lạ. Thà thiếu một trường hơn là có một trường dẫn tới nhầm người.

`value` (số như đã công bố) và `phone_e164` (số chuẩn hoá) là **hai trường riêng**. Cái hiện cho người dùng vẫn là cái đã công bố; cái dùng để gọi/nhắn là cái đã chuẩn hoá.

---

## Chưa ghi vào backlog

Những việc đang dở nhưng đã nằm trong tài liệu khác thì không lặp lại ở đây:

- 5 bước / 5 cổng của thiết kế chuẩn → `docs/contact-candidate-pipeline-audit.md` (mục E).
- Các lớp nguồn và chi phí → `docs/buyer-discovery-spec.md` §14.
- Việc còn thiếu sau khi khép vòng lưu dữ liệu → spec §17.
