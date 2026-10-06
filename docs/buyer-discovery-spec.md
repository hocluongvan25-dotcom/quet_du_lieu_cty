# Buyer Discovery — thị trường nước ngoài

Phạm vi: **chỉ tìm người mua ở nước ngoài** (Mỹ, Anh, EU, Nhật, Hàn, Trung Đông…), **không** tìm kiếm doanh nghiệp Việt Nam.

Mục tiêu sản phẩm:

```text
Sản phẩm tôi bán  →  ai đang mua?  →  ai ký?  →  liên hệ bằng gì?  →  có bằng chứng
```

---

## 1. Sự thật về dữ liệu (chốt trước khi code)

| Điều tưởng đúng | Thực tế |
| --- | --- |
| ImportYeti có thông tin người ra quyết định | **Không.** ImportYeti là bản ghi manifest tàu biển của US CBP: tên nhà nhập khẩu, địa chỉ, website, HS/HTS, nhà cung cấp, tuyến, số TEU, ngày lô hàng. Email/phone bị che sau gói trả phí và **gần như không có sẵn**: "US importer records almost never carry a phone or email — ImportYeti does not publish them" |
| Panjiva / ImportGenius có contact | **Không.** Cả hai ở mức company-level: "no decision-maker contacts… no contact data at any tier" |
| Có nền tảng bán kèm người ra quyết định | **Có** — Volza (và nhóm tương tự: TradeInt, Tendata, 52wmb) bán "verified decision-maker emails & phone", ~1.500 USD/năm. Nguồn gốc các email này là scrape web/LinkedIn → **rủi ro provenance**, không phải dữ liệu chính thống |
| Có API chính thức để lấy dữ liệu | ImportYeti/Panjiva **không** có API công khai cho SME. Muốn lấy tự động thường phải scrape → vi phạm ToS |
| Dữ liệu hải quan là công khai ở mọi thị trường | **Chỉ một số nước.** Mỹ: manifest tàu biển công khai (và được bán lại hợp pháp). Ấn Độ, Indonesia, Mexico, Brazil… có bán. **EU: dữ liệu hải quan theo lô không công khai** → tín hiệu mua ở EU yếu hơn hẳn |

**Kết luận kiến trúc:** nền tảng trade data cho *danh sách người mua + lịch sử mua*. Người ra quyết định phải lấy từ **nguồn chính thống**:

- **UK Companies House API** — miễn phí, chính thức, có **officers** (giám đốc/thư ký: chức danh, ngày bổ nhiệm, quốc tịch, nghề nghiệp, DOB một phần) và **PSC** (chủ sở hữu hưởng lợi). Dữ liệu Crown copyright theo Open Government Licence → **được dùng thương mại**. Giới hạn 600 request/5 phút.
- **US**: SEC EDGAR (công ty đại chúng) + sổ đăng ký doanh nghiệp cấp bang (officers; Delaware mờ) + trang Leadership trên website + press release.
- **EU**: đa số sổ đăng ký không có API miễn phí (Đức, Pháp, Tây Ban Nha, Ý, Ba Lan… phải trả phí/bản chính thức).
- Website công ty (trang About/Leadership/Contact) và tài liệu nhà cung cấp — nguồn do chính công ty công bố, an toàn nhất.

---

## 2. Bốn lớp dữ liệu

```text
1. trade_signals    — lô hàng: ai nhập, mặt hàng/HS, từ đâu, khi nào, bao nhiêu   (company-level)
2. buyer_profiles   — công ty người mua: định danh, website, HS, điểm phù hợp
3. decision_makers  — con người: họ tên, chức danh, bộ phận, nguồn, lần thấy cuối
4. contact_channels — kênh liên hệ: email/phone/form/portal, kèm provenance
```

Nguyên tắc xuyên suốt:

- **Company-level ≠ personal data.** `trade_signals` là dữ liệu doanh nghiệp, không phải dữ liệu cá nhân → retention dài hơn.
- **Personal data phải có hạn dùng.** `decision_makers`, `contact_channels` có `expires_at` và bị dọn tự động.
- **Provenance luôn đi kèm giá trị.** Mỗi kênh liên hệ ghi rõ nó đến từ đâu (registry / website công ty / press release / licensed db) để khách biết mức tin cậy.
- **Không đoán.** Không sinh email theo pattern, không suy di động từ tổng đài, không lấy Zalo/WeChat cá nhân. Ràng buộc này nằm trong schema (`is_guessed = false`), không chỉ trong tài liệu.

---

## 3. Phân hạng

| Hạng | Nghĩa | Ví dụ |
| --- | --- | --- |
| **A** | Có kênh công khai **của chính người đó** hoặc của bộ phận | `procurement@`, số phòng mua, form RFQ |
| **B** | Xác định được **người + chức danh**, nhưng chỉ có kênh chung của công ty | Giám đốc A — tổng đài công ty |
| **C** | Chỉ có **vai trò**, chưa có tên | "Có Procurement Manager, chưa xác định ai" |

`decision_makers` ràng buộc: hạng A/B **phải có tên**, hạng C **phải để trống tên** — không thể ghi nhập nhằng.

---

## 4. Luồng V1 (chỉ Mỹ + Anh trước)

```text
1. Người dùng nhập: sản phẩm / mã HS + thị trường + vai trò đích
2. Truy vấn trade data      → danh sách nhà nhập khẩu đang mua mặt hàng đó
3. Chấm điểm fit            → độ mới, tần suất, tăng trưởng, nhà cung cấp hiện tại
4. Resolve người ra quyết định → registry (UK CH / SEC / state) + website công ty
5. Gắn kênh liên hệ + provenance + hạng A/B/C
6. Xuất: danh sách + person card + CSV/CRM, kèm "last seen"
7. Theo dõi: người đổi chức danh, kênh đổi, có lô hàng mới → timeline
```

Thứ tự ưu tiên thị trường: **Mỹ** (B/L công khai, tiếng Anh, dữ liệu dày nhất) → **Anh** (registry miễn phí có officers) → EU qua sổ đăng ký trả phí → các thị trường có dữ liệu hải quan bán được.

---

## 5. Ma trận nguồn

| Nguồn | Cho gì | Người ra quyết định | Pháp lý | Chi phí |
| --- | --- | --- | --- | --- |
| US CBP manifest (qua ImportYeti / nhà bán dữ liệu) | Người mua, HS, nhà cung cấp, ngày, khối lượng | Không | Hồ sơ công khai, nhưng **scrape website bên thứ ba là vi phạm ToS** → nên mua từ nhà cung cấp dữ liệu gốc | Miễn phí (giới hạn) → ~1.300–5.000 USD/năm |
| Panjiva (S&P) | Như trên, entity matching tốt | Không | License thương mại | Enterprise ~1.000+ USD/tháng |
| ImportGenius | US chuyên sâu | Không | License thương mại | ~125–899 USD/tháng |
| Volza / TradeInt / Tendata | 60–209 nước + contact đi kèm | Có (provenance không rõ) | License thương mại | ~1.500 USD/năm |
| UK Companies House API | Officers, PSC, filings | **Có, chính thống** | OGL, dùng thương mại được | Miễn phí |
| SEC EDGAR | Ban điều hành công ty đại chúng | Có | Công khai | Miễn phí |
| Sổ đăng ký EU | Officers | Có | Trả phí/bản chính thức | Tùy nước |
| Website công ty, press release, hội chợ | Người + kênh do công ty tự công bố | Có | An toàn nhất | Miễn phí |

**Quy tắc:** đi tới **nguồn gốc của dữ liệu** (CBP manifest, sổ đăng ký nhà nước), không scrape nền tảng trung gian rồi bán lại.

---

## 6. Những điều không bao giờ làm

1. Không sinh email theo pattern (`ten.ho@congty.com`).
2. Không lấy email/số cá nhân từ LinkedIn hay mạng xã hội.
3. Không bán lại dữ liệu lấy từ nền tảng có ToS cấm.
4. Không hiển thị kênh chưa xác minh như thể đã xác minh — hạng và provenance luôn hiện.
5. Không giữ dữ liệu cá nhân quá hạn (`expires_at` + job dọn).

Lý do không chỉ là pháp lý: email sai làm hỏng reputation tên miền của khách, và khách mất luôn kênh email cho mọi chiến dịch sau.

---

## 7. KPI

- % danh sách có ≥1 người hạng A/B.
- Precision của hạng A (audit mẫu 20 dòng/tháng).
- Tỉ lệ kênh còn sống sau 30/90 ngày.
- Tỉ lệ khách tự báo "đã liên hệ được" trên mỗi danh sách.

## 8. Giá (đề xuất)

| Tác vụ | Credit |
| --- | ---: |
| Buyer list theo HS/sản phẩm (company-level) | 5 |
| + Person card hạng A/B | +5 |
| Deep (nhiều thị trường, nhiều nguồn) | 12–15 |
| Refresh (chỉ tính khi có thay đổi) | 2–4 |

Chỉ tính credit khi có kết quả mới; job lỗi phải hoàn credit (schema đã có `refund`).
