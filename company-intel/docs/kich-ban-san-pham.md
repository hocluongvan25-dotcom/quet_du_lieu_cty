# Kịch bản sản phẩm — Seekora Company Intelligence

## Mục tiêu

Giúp đội sales, sourcing và market research tìm hiểu **một công ty tại một thời điểm** từ tên hoặc một đường link công khai, mà không phải tự mở nhiều tab. Sản phẩm bán giá trị của một **Company Report có evidence**, không bán hay suy đoán dữ liệu cá nhân.

## Kịch bản chính: tìm một công ty bằng tên

1. Người dùng vào Dashboard và nhập `Nova Distribution Ltd.`.
2. Người dùng chọn quốc gia để giảm trường hợp trùng tên.
3. Hệ thống hiển thị tiến trình: tạo truy vấn → đối chiếu nguồn → chuẩn hoá evidence.
4. Nếu có nhiều entity, người dùng chọn đúng công ty trước khi tạo report.
5. Hệ thống trừ 5 credits khi report được tạo thành công.
6. Người dùng nhận Company Report gồm:
   - tên, quốc gia, ngành và website có khả năng/chính thức;
   - LinkedIn/company social nếu có evidence;
   - email chung, điện thoại doanh nghiệp, WhatsApp Business **chỉ khi công khai**;
   - confidence score, URL nguồn, ngày capture.
7. Snapshot mặc định còn 30 ngày. Người dùng có thể export, refresh hoặc lưu archive dài hạn.

## Kịch bản phụ: dán link từ nguồn khác

1. Người dùng dán website, directory listing, profile xuất nhập khẩu hoặc company page công khai.
2. URL được kiểm tra an toàn trước khi gọi crawler.
3. Hệ thống sử dụng link như một `seed`, không coi nó là sự thật duy nhất.
4. Agent trích xuất tên, quốc gia, domain, sản phẩm và tìm nguồn độc lập để đối chiếu.
5. Kết quả trả về cùng cấu trúc Company Report.

## Quy tắc tính credits

| Tình huống | Hành vi | Credit |
| --- | --- | ---: |
| Chưa chọn được entity tin cậy | Trả candidate / yêu cầu thêm ngữ cảnh | 0 |
| Company Report tiêu chuẩn tạo thành công | Tạo snapshot + evidence | 5 |
| Technical failure | Hoàn toàn không tạo report | 0 / hoàn credit |
| Report đúng entity nhưng không tìm thấy WhatsApp/email | Trả `not_found`, không bịa dữ liệu | 5 |
| Refresh report | Quét lại, tạo snapshot mới | 1–3 |
| Source có phí/license đặc biệt | Hiển thị add-on trước khi chạy | Theo nguồn |

## Retention và gói bán hàng

### Starter
- Raw artifacts và report snapshot: 30 ngày.
- Có thể export report trong thời hạn.
- Dữ liệu hết hạn được đánh dấu rõ ràng, không hiển thị như dữ liệu hiện tại.

### Pro Archive
- Lưu snapshot và evidence trong 12 tháng.
- So sánh các lần quét: website/contact/catalog thay đổi ra sao.
- Không tự động biến snapshot cũ thành dữ liệu mới.

### Monitoring
- Tạo research job mới theo chu kỳ 30/60/90 ngày.
- So sánh snapshot mới/cũ và gửi alert khi có thay đổi có ý nghĩa.

## UX principles

- Một ô input chính, hai mode rõ ràng: **Tên công ty** / **Dán link**.
- Một CTA rõ ràng: `Research · 5 credits`.
- Không che giấu credit hoặc thời hạn lưu trữ.
- Report nhìn được ngay evidence, confidence, ngày capture và expiry.
- Khi không chắc, hệ thống nói `Cần xác minh` thay vì trả dữ liệu có vẻ hợp lý.
- Mọi contact phải là kênh kinh doanh công khai; không suy đoán số WhatsApp từ phone number.

## Quy tắc nguồn và an toàn

- Chỉ dùng nguồn/API có quyền sử dụng phù hợp.
- Tôn trọng điều khoản nguồn, robots, rate limits và licensing/re-distribution restrictions.
- User-supplied URL chỉ chạy trong sandbox; chặn private IP, localhost, redirect nguy hiểm và cloud metadata endpoints.
- Không chia sẻ raw data giữa tenant nếu không có quyền rõ ràng.
- Retention phải tuân theo cả plan của khách và quyền lưu cache từ từng nguồn.
