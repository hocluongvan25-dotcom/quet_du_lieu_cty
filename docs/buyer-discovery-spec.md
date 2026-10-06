# Buyer Discovery — thị trường nước ngoài

> Tên feature: **Contact Candidate & Verification Pipeline**. Không gọi là "tìm email người mua hàng": thứ được bán là một quy trình có bằng chứng và có kiểm tra, không phải một danh sách email.

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
| "Không đăng nhập thì scrape là hợp pháp" | **Đúng nhưng rất hẹp — không được biến thành nguyên tắc kỹ thuật.** Meta v. Bright Data (N.D. Cal., 01/2024) chỉ nói: bên scrape khi **chưa đăng nhập** thì không bị ràng buộc bởi user agreement của Meta và không vi phạm CFAA; Meta rút đơn 02/2024. Phán quyết phụ thuộc điều khoản cụ thể của nền tảng, hành vi, bằng chứng và jurisdiction, và **không** giải quyết: copyright, database rights, luật bảo vệ dữ liệu (GDPR/PDP Law), luật chống vượt access control, hay quyền lưu cache/bán lại dữ liệu. Nguyên tắc đúng: chỉ đọc nguồn công khai, không vượt access control, không tài khoản giả, không phá CAPTCHA, tôn trọng license/terms, và **đánh giá riêng từng nguồn**. |
| Dữ liệu hải quan là công khai ở mọi thị trường | **Chỉ một số nước.** Mỹ: manifest tàu biển công khai (và được bán lại hợp pháp). Ấn Độ, Indonesia, Mexico, Brazil… có bán. **EU: dữ liệu hải quan theo lô không công khai** → tín hiệu mua ở EU yếu hơn hẳn |
| "Agent AI tự tìm được LinkedIn và số điện thoại công ty" (như Manus) | **Đúng một phần.** Agent đọc được: trang công ty trên LinkedIn, số điện thoại/tổng đài trên website, form liên hệ, email phòng ban (`sales@`, `procurement@`), và **URL profile công khai** nếu người đó để công khai. Agent **không** lấy được: email riêng của một người cụ thể, số di động, hay lịch sử làm việc đầy đủ (nằm sau login wall — xem mục 6) |
| "Sai vài phần trăm thì không sao" | **Đúng ở khâu tìm, sai ở khâu gửi.** Bounce rate là chỉ số thương mại, không phải định luật: các benchmark marketing hay dẫn (list đã verify ~1,2% — chưa verify ~7,8% — mua sẵn ~18,5%) chỉ dùng để tham khảo, không phải chuẩn phổ quát. Điều chắc chắn hơn: **Amazon SES khuyến nghị giữ dưới 2%**, xem xét tài khoản từ ~5%, tạm dừng từ ~10% — và mỗi ESP có policy riêng, còn phụ thuộc complaint rate, engagement, tuổi domain và volume. Vì vậy: **cho phép đoán ở khâu nghiên cứu, bắt buộc kiểm tra mailbox trước khi export/send** |

**Kết luận kiến trúc:** nền tảng trade data cho *danh sách người mua + lịch sử mua*. Người ra quyết định phải lấy từ **nguồn chính thống**:

- **UK Companies House API** — miễn phí, chính thức, có **officers** (giám đốc/thư ký: chức danh, ngày bổ nhiệm, quốc tịch, nghề nghiệp, DOB một phần) và **PSC** (chủ sở hữu hưởng lợi). Dữ liệu Crown copyright theo Open Government Licence → **được dùng thương mại**. Giới hạn 600 request/5 phút.
- **US**: SEC EDGAR (công ty đại chúng) + sổ đăng ký doanh nghiệp cấp bang (officers; Delaware mờ) + trang Leadership trên website + press release.
- **EU**: đa số sổ đăng ký không có API miễn phí (Đức, Pháp, Tây Ban Nha, Ý, Ba Lan… phải trả phí/bản chính thức).
- Website công ty (trang About/Leadership/Contact) và tài liệu nhà cung cấp — nguồn do chính công ty công bố, an toàn nhất.

---

## 2. Các lớp dữ liệu

```text
Bên công ty (company-level, retention dài):
1. trade_signals    — lô hàng: ai nhập, HS, từ đâu, khi nào, bao nhiêu
2. buyer_profiles   — công ty người mua: định danh, website, HS, điểm phù hợp
3. buyer_routes     — đường vào công ty: vendor registration, supplier portal, RFQ, trang procurement

Pipeline liên hệ (dữ liệu cá nhân, có hạn dùng):
4. contact_channels            — kênh QUAN SÁT ĐƯỢC: thấy công bố ở đâu (source_url + evidence_snippet)
5. contact_candidates          — GIẢ THUYẾT sinh theo pattern: bắt buộc ghi pattern + cơ sở, hết hạn 30 ngày
6. contact_verification_events — log từng lần kiểm tra mailbox, append-only (không ghi đè kết quả cũ)
7. contact_export_policy       — lớp quyết định: visible_in_app / exportable / outreach_eligible / blocked_reason
```

**Quan sát được và suy luận không nằm chung một bảng.** Một số điện thoại in trên trang "Contact us" và một email sinh từ pattern `first.last@` là hai loại vật thể khác nhau: khác bằng chứng, khác tuổi thọ, khác luật xuất. Trộn chúng vào nhau là cách chắc chắn nhất để một ngày nào đó email đoán bị gửi đi như email thật.

Bảng quyết định (được ép trong SQL, không nằm rải rác ở UI):

| Loại | Xem trong app | Export CSV | Dùng outreach |
| --- | ---: | ---: | ---: |
| Email/số công ty công bố, có source | Có | Có | Sau khi kiểm tra mailbox |
| Profile URL công khai | Có | Có link | Không auto (liên hệ thủ công) |
| Candidate chưa verify | Có nhãn cảnh báo | Không | Không |
| Inferred + mailbox valid | Có nhãn | Có, kèm cờ override | Cần khách xác nhận |
| Catch-all | Có nhãn risky | **Không** (mặc định) | Không |
| Invalid / hết hạn | Chỉ trong audit | Không | Không |

Nguyên tắc xuyên suốt:

- **Company-level ≠ personal data.** `trade_signals` là dữ liệu doanh nghiệp, không phải dữ liệu cá nhân → retention dài hơn.
- **Personal data phải có hạn dùng.** `decision_makers`, `contact_channels` có `expires_at` và bị dọn tự động.
- **Provenance luôn đi kèm giá trị.** Mỗi kênh liên hệ ghi rõ nó đến từ đâu (registry / website công ty / press release / licensed db) để khách biết mức tin cậy.
- **Được phép đoán, nhưng đoán là một loại vật thể riêng.** Kênh quan sát được (`contact_channels`) có `certainty` = `confirmed`/`probable` và phải có `source_url`. Giả thuyết sinh theo pattern nằm ở `contact_candidates`, **bắt buộc** ghi `pattern_used` + `inference_basis`, hết hạn sau 30 ngày và **không bao giờ** được export trực tiếp — muốn thành kênh thật thì phải qua kiểm tra rồi promote. Riêng **URL profile không được suy diễn**: bịa handle là gõ cửa nhà người lạ.
- **Ba câu hỏi khác nhau, ba cột khác nhau.** `deliverability` = hộp thư có tồn tại (SMTP). `identity_match` = địa chỉ đó là của ai (`person`/`department`/`company_general`/`unknown`). `is_verified` = ta đã buộc được nó với đúng người chưa. Một email `valid` + `identity_match = unknown` vẫn chưa phải "contact đã xác minh".
- **Catch-all không phải valid.** Tên miền catch-all nhận mọi địa chỉ, nên kết quả catch-all không chứng minh hộp thư tồn tại. Mặc định **không export**; muốn dùng phải có override của khách, và UI phải nói rõ lý do.
- **Find và Send là hai bước.** Quyền xem ≠ quyền xuất ≠ quyền gửi tự động. Cả ba được tính trong `contact_export_policy` cùng `blocked_reason`.

---

## 3. Phân hạng

| Hạng | Nghĩa | Ví dụ |
| --- | --- | --- |
| **A** | Có kênh công khai **của chính người đó** hoặc của bộ phận | `procurement@`, số phòng mua, form RFQ |
| **B** | Xác định được **người + chức danh**, nhưng chỉ có kênh chung của công ty | Giám đốc A — tổng đài công ty |
| **C** | Chỉ có **vai trò**, chưa có tên | "Có Procurement Manager, chưa xác định ai" |

`decision_makers` ràng buộc: hạng A/B **phải có tên**, hạng C **phải để trống tên** — không thể ghi nhập nhằng.

Song song với hạng, mỗi kênh mang **nhãn tin cậy** (`verified` / `confirmed` / `probable` / `inferred`) và **trạng thái mailbox** (`valid` / `catch_all` / `risky` / `invalid` / `unknown`). Hạng trả lời "biết ai", nhãn trả lời "chắc đến đâu" — khách cần cả hai để quyết định gọi hay gửi.

---

## 4. Luồng V1 (chỉ Mỹ + Anh trước)

```text
1. Người dùng nhập: sản phẩm / mã HS + thị trường + vai trò đích
2. Truy vấn trade data       → danh sách nhà nhập khẩu đang mua mặt hàng đó
3. Chấm điểm fit             → độ mới, tần suất, tăng trưởng, nhà cung cấp hiện tại
4. Tìm buyer route công khai → vendor registration / supplier portal / RFQ / trang procurement   ← bước đầu tiên, chưa cần biết tên ai
5. Tìm email & số phòng ban  → procurement@, tổng đài phòng mua
6. Resolve con người         → registry (UK CH / SEC / state) + website + agent đọc trang công khai
7. Chỉ khi cần mới sinh candidate theo pattern → ghi pattern + cơ sở, hạn 30 ngày, KHÔNG export
8. Verify mailbox            → valid / catch_all / invalid, mỗi lần là một event được ghi log
9. Export theo policy        → confirmed xuất được; candidate chỉ xuất sau khi valid, kèm cờ override
10. Theo dõi: người đổi chức danh, kênh đổi, có lô hàng mới → timeline
```

> **Department route trước, person sau.** Với một nhà xuất khẩu, đường ngắn nhất vào một công ty mua thường không phải là email của giám đốc mua hàng, mà là form "Become a supplier" hoặc cổng đăng ký nhà cung cấp. Route là dữ liệu công ty, không phải dữ liệu cá nhân: ít rủi ro hơn, không hết hạn theo GDPR, và nhiều khả năng đúng quy trình của người mua.

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
| LinkedIn (profile công khai, chưa đăng nhập) | Tên, chức danh, công ty, lịch sử làm việc | Có, ở mức danh tính | Xem công khai thì được, nhưng chỉ được tới login wall (khoảng 3–5 profile) và không được thu thập tự động | Miễn phí (rất giới hạn) |
| Nhà cung cấp enrichment (Apollo, ZoomInfo, Volza…) | Email, số điện thoại, người liên hệ — từ **database riêng của họ**, không phải từ LinkedIn | Có | Phải có căn cứ pháp lý khi dùng; dữ liệu không phải do mình thu thập nên không kiểm chứng được nguồn | Trả phí |
| Agent đọc web của Seekora | Người, chức danh, profile URL, kênh do công ty công bố | Có (nếu được công bố) | Đọc trang công khai khi **chưa đăng nhập**: theo hiQ và Meta v. Bright Data, việc này không vi phạm CFAA và không ràng buộc bởi user agreement (chỉ áp dụng cho người đã đăng nhập). GDPR/PDP Law vẫn áp dụng cho dữ liệu cá nhân | Chi phí hạ tầng |
| Email verifier (MillionVerifier, NeverBounce, ZeroBounce, DeBounce) | Hộp thư còn sống hay không (SMTP handshake) | Không | Chỉ kiểm tra hộp thư, không thu thập dữ liệu cá nhân | ~2–10 USD/1.000 |

**Quy tắc:** đi tới **nguồn gốc của dữ liệu** (CBP manifest, sổ đăng ký nhà nước), không scrape nền tảng trung gian rồi bán lại.

**Số điện thoại:** LinkedIn **không** cho số điện thoại — profile không có trường này, dưới ~5% thành viên có công khai và thường chỉ mở cho kết nối cấp 1; công cụ nào quảng cáo "lấy số trực tiếp từ LinkedIn" thực chất đang tra database riêng của họ. Đường đi thật của số điện thoại: trang liên hệ của công ty (số văn phòng), press release / PDF có chữ ký, danh bạ hội chợ, Google Business, hoặc mua từ nhà cung cấp dữ liệu. Vì vậy report tách rõ **số của công ty** (thấy trên web công ty) và **số của cá nhân** (hầu như không có; nếu có thì phải kèm đúng trang đã thấy).

---

## 6. Những điều không bao giờ làm

1. **Không đăng nhập** vào bất kỳ nền tảng nào để thu thập dữ liệu. Đăng nhập là chấp nhận user agreement → rơi đúng vào chỗ hiQ và các bên bị kiện thua (vi phạm hợp đồng). Dùng Voyager API ngầm của LinkedIn thì tài khoản bị ban trong 3–7 ngày.
2. **Không tài khoản giả, không phá CAPTCHA, không vượt login wall.** Mọi vụ LinkedIn kiện đều có hai yếu tố: tài khoản giả sau login wall và bán lại dữ liệu. Tránh hai thứ đó là tránh phần lớn rủi ro.
3. **Không sinh URL profile.** Chỉ lưu URL tìm thấy, kèm trang đã thấy nó.
4. **Không bán lại** dữ liệu lấy từ nền tảng có ToS cấm bán lại.
5. **Không hiển thị hay xuất kênh chưa kiểm tra** như thể đã xác minh — nhãn tin cậy và `deliverability` luôn đi kèm giá trị.
6. **Không giữ dữ liệu cá nhân quá hạn** (`expires_at` + job dọn; riêng `inferred` tối đa 30 ngày).

Ghi chú pháp lý — chính xác đến đâu:

- **Meta v. Bright Data (N.D. Cal., 01/2024)**: Bright Data thắng ở claim vi phạm hợp đồng liên quan tới việc scrape dữ liệu công khai khi **chưa đăng nhập** (toà: không phải "user" của Meta thì không bị ràng buộc bởi user agreement), và Meta rút đơn 02/2024. Đây là phán quyết theo luật California, phụ thuộc điều khoản của Meta lúc đó và bộ bằng chứng của vụ án.
- **hiQ v. LinkedIn không đơn giản là "public thì thắng, login thì thua"**: Ninth Circuit từng có phán quyết sơ bộ có lợi cho hiQ về CFAA, nhưng phần tranh chấp User Agreement/fake accounts đi theo hướng bất lợi, và hiQ cuối cùng dàn xếp, chấp nhận lệnh cấm, xoá dữ liệu/code và trả 500.000 USD.
- Vì vậy **không** có nguyên tắc "không đăng nhập là đủ an toàn". Cách đúng là đánh giá riêng từng nguồn: điều khoản, license, robots, dữ liệu có phải dữ liệu cá nhân không, jurisdiction nào, và có được bán lại không.
- Phần luôn đúng bất kể nguồn: dữ liệu cá nhân (kể cả lấy từ trang công khai) vẫn cần cơ sở pháp lý, phải có hạn dùng, và phải trả lời được câu "khách dùng nó để làm gì".

Lý do không chỉ là pháp lý: email sai làm hỏng reputation tên miền của khách, và khách mất luôn kênh email cho mọi chiến dịch sau.

---

## 7. KPI

- % danh sách có ≥1 người hạng A/B.
- Precision của hạng A (audit mẫu 20 dòng/tháng).
- **Bounce rate thực tế trên mỗi danh sách đã xuất — mục tiêu <2%.**
- **Tỉ lệ kênh `inferred` được verify thành `valid`/`catch_all`** (đo độ chính xác của pattern).
- Tỉ lệ kênh còn sống sau 30/90 ngày.
- Tỉ lệ khách tự báo "đã liên hệ được" trên mỗi danh sách.

## 8. Giá (đề xuất)

| Tác vụ | Credit |
| --- | ---: |
| Buyer list theo HS/sản phẩm (company-level) | 5 |
| + Person card hạng A/B | +5 |
| Deep (nhiều thị trường, nhiều nguồn) | 12–15 |
| Kiểm tra mailbox cả danh sách (verifier) | +2 |
| Refresh (chỉ tính khi có thay đổi) | 2–4 |

Chỉ tính credit khi có kết quả mới; job lỗi phải hoàn credit (schema đã có `refund`).

---

## 9. Định dạng output chuẩn (đã chốt 06/10/2026)

Mọi report trả cho khách có 4 khối, theo thứ tự này. Đây là hợp đồng với người dùng, không phải gợi ý trình bày.

**1. Khối công ty** — tên, website, LinkedIn, ngành, **năm thành lập, quy mô nhân sự, địa chỉ**, mô tả 1–2 câu. Kèm **kênh chung của công ty** (website, LinkedIn, điện thoại, email chung): chỉ giá trị, hai kênh một hàng, mỗi giá trị là link tới trang đã thấy nó.

**2. Khối người liên quan** — mỗi người một thẻ: tên, chức danh, bộ phận, chức danh trước đây nếu có, **mọi kênh gắn với người đó** (profile LinkedIn, email công bố kèm tên, điện thoại nếu có) và ngày thấy lần cuối. Một email công bố kèm tên **không được đứng riêng**: người dùng phải biết mình đang viết cho ai, nên email đó được gắn vào thẻ của người ấy — nếu người đó đã có thẻ từ LinkedIn thì gắn vào đúng thẻ đó. **Không xếp hạng, không khuyến nghị nên gặp ai, không hướng dẫn cách tiếp cận.**

**3. Khối email bộ phận** — chỉ còn email bộ phận / email không gắn được tên, cùng bố cục thẻ như khối người liên quan. **Không lên đầu**: đây không phải thông tin chính của công ty.

**4. Khối nguồn** — danh sách URL đã đối chiếu, kèm ngày.

**Giao diện report: nội dung, không nhãn trạng thái.** Trong report **không hiển thị các icon thông báo**: nhãn tin cậy (`certainty`), người/bộ phận (`identity_match`), quyền (`policy`), dấu đã xác minh, dòng "nguồn: hồ sơ LinkedIn". Các nhãn đó **vẫn là một phần của model** và vẫn hiển thị đầy đủ ở danh sách buyer và trong file CSV. Các icon còn lại giữ nguyên: icon loại kênh (mail / điện thoại / hồ sơ / website), nút sao chép, icon trang nguồn. Mỗi giá trị là một link tới trang đã thấy nó và **link phải có màu link ngay từ đầu** (không phải màu chữ thường) để nhìn là biết bấm được; số điện thoại để dạng chữ vì không bấm được. Khối nguồn liệt kê lại toàn bộ trang đã kiểm và cũng tô màu link.

Không hiển thị danh sách "không tìm thấy" cho người dùng. Việc **loại trừ** vẫn phải diễn ra (giá trị của bên thứ ba, số điện thoại của đơn vị vận hành web store, email đuôi tên file ảnh…) nhưng là việc của hệ thống, không phải nội dung để đọc: người dùng cần danh sách đã sạch, không cần biết hệ thống đã bỏ qua những gì.

Quy tắc bắt buộc:

- Không giá trị nào được xuất hiện mà thiếu nguồn hoặc thiếu nhãn tin cậy.
- Thiếu thì để trống. Không suy diễn, không sinh email theo pattern ở tầng này, và cũng không liệt kê những gì không tìm được.
- **Ranh giới sản phẩm:** hệ thống chỉ TÌM thông tin liên quan và ghi nguồn. Chọn ai, liên hệ thế nào, thứ tự ưu tiên ra sao là việc của người dùng — report không chứa lời khuyên bán hàng.
- Mỗi kênh vẫn mang đúng một nhãn tin cậy và một quyền trong model (và trong CSV); report không hiển thị chúng.

Ví dụ chuẩn đang chạy: `src/lib/demo-mariani.ts` (Mariani Packing, đối chiếu 06/10/2026) — gõ `Mariani` trong demo để mở.

---

## 10. Nguyên tắc: chỉ dữ liệu, không lời khuyên

Nền tảng **tìm thông tin và ghi nguồn**. Nó không đưa ra cẩm nang bán hàng, không xếp hạng nên gặp ai, không hướng dẫn cách tiếp cận.

Phép thử một dòng, dùng cho mọi trường được thêm vào report:

> **Trường này trả lời được câu "giá trị đó thấy ở đâu?" không?**
> Không trả lời được thì không thuộc về report.

Lý do không chỉ là "đúng phạm vi sản phẩm", mà là **niềm tin**:

- Thực tế vận hành thay đổi theo công ty, thị trường và thời điểm. Một cẩm nang soạn sẵn kiểu gì cũng sai ở đâu đó.
- Khi nền tảng phán sai một lần, người dùng không đánh giá "khối lời khuyên đó sai" — họ kết luận **cả nền tảng là phán bừa**, kể cả phần dữ liệu đúng.
- Trong report, lời khuyên và dữ liệu trông giống hệt nhau: cùng font, cùng vị trí, cùng vẻ chắc chắn. Người dùng không có cách nào phân biệt. Trộn hai loại là tự làm hỏng giá trị của loại kia.

Thiếu dữ liệu thì người dùng tự đi tìm — không mất gì. Lời khuyên sai thì mất niềm tin, và mất luôn những dữ liệu đúng đi kèm.

Chốt chặn kỹ thuật: `npm run check:content` quét `src/lib` và `src/components`, báo lỗi nếu xuất hiện trường mang tính khuyên bảo (xếp hạng, "vì sao nên gặp", mức ưu tiên, cẩm nang). Ngoài ra TypeScript đã chặn ở tầng kiểu: các trường đó không còn tồn tại trong `CompanyReport`, nên viết lại sẽ lỗi biên dịch ngay.

---

## 11. Connector: chỉ đọc nguồn công khai, và chỉ ghi lại thứ đã thấy

Connector biến một tên miền thành danh sách kênh liên hệ công khai. Nó chạy ở nơi có internet (máy người dùng hoặc server), không chạy trong sandbox.

### Đọc gì (cập nhật 06/10/2026)

Ngoài trang HTML, connector đọc thêm **tài liệu PDF cùng tên miền** — nơi chứa thứ trang web không có: báo cáo thường niên, press release, catalogue, tài liệu hướng dẫn nhà cung cấp. Đường dẫn cố định được mở rộng thành các nhóm: liên hệ; nhà cung cấp/mua hàng (`/suppliers`, `/vendor`, `/procurement`, `/become-a-supplier`…); báo chí (`/press`, `/newsroom`, `/media`); nhà đầu tư (`/investors`, `/annual-report`); chứng nhận/chất lượng; catalogue.

PDF được chọn theo mức liên quan của tên file (nhà cung cấp > báo cáo tài chính > press release > catalogue > chứng nhận), tối đa 3 file mỗi lần chạy (`--max-documents`), chỉ cùng tên miền, tôn trọng robots.txt.

Giới hạn đã biết và cách xử lý: **PDF scan ảnh không có lớp chữ, hoặc PDF dùng font bảng mã riêng** → ghi vào "không đọc được" kèm lý do và **không đoán giá trị**; PDF có mật khẩu bị bỏ qua; file quá lớn (mặc định 12 MB) bị bỏ qua.

### Cam kết, và chỗ được kiểm trong test

| Cam kết | Được kiểm bằng |
| --- | --- |
| Chỉ đọc trang công khai: không đăng nhập, không cookie, không giải CAPTCHA | Trang trả 401/403/429 hoặc chuyển hướng tới trang đăng nhập thì dừng, ghi vào danh sách "bỏ qua" |
| Tôn trọng robots.txt | `/cart` bị chặn thì không được gọi — test khẳng định không có request nào tới URL đó |
| Chỉ đi trong tên miền của công ty | Link Facebook, link ngoài đều bị bỏ; test khẳng định mọi request đều thuộc tên miền gốc |
| Không sinh email theo pattern | Test khẳng định mọi email trả về đều có **nguyên văn** trong HTML |
| Mọi giá trị có nguồn và bằng chứng | Không giá trị nào thiếu `sourceUrl` hoặc `evidenceSnippet` |
| Thứ của bên thứ ba không lọt vào danh sách | Email khác tên miền vào mục "đã loại trừ"; số điện thoại nằm cùng khối với email bên thứ ba cũng bị loại, **trừ khi** email của chính công ty cũng ở ngay đó |
| Không tự thêm mã quốc gia | Số `707.452.2800` giữ nguyên `7074522800`, không thành `+17074522800` |
| Không tự bịa WhatsApp | Không thấy `wa.me` thì ghi "chưa thấy", kèm ghi chú nếu trang chỉ có chat trực tuyến |
| Chặn SSRF | `localhost`, `.internal`, `127.0.0.1`, `169.254.169.254`, `file://` đều bị chặn **trước khi mở kết nối**, cả khi tên miền công cộng nhưng phân giải vào IP nội bộ |

### Cái connector không làm

- **Không lấy tên người từ LinkedIn.** Hồ sơ cá nhân nằm sau login wall; connector không đăng nhập nên không đọc. Nó chỉ lấy **URL profile nếu trang công ty tự công bố**, và luôn ở mức "liên hệ thủ công".
- **Không đoán email** theo pattern `ten.ho@congty.com`, kể cả khi rất chắc. Muốn có thì phải đi qua bảng `contact_candidates` + kiểm tra mailbox (migration 006).
- **Không tìm người qua mạng xã hội hay nguồn trả tiền chưa mua license.**
- **Không lưu vào database ở bước này.** Kết quả trả về API, chưa ghi bảng nào — cần apply migration 002–006 trước.

### Cách chạy

```bash
npm run connector:test          # 71 check trên fixture HTML thật, không cần internet
npm run connector:run mariani.com            # chạy thật, in dạng người đọc
npm run connector:run mariani.com -- --json  # in JSON đầy đủ
```

Hoặc qua API: `POST /api/connector` với `{ "domain": "mariani.com" }`.

### Kết quả trên fixture Mariani (dùng đúng câu chữ đã đối chiếu)

- 4 email công bố: `productinfo@`, `ssousa@`, `tgarcia@`, `ingredients@` (email bộ phận nguyên liệu);
- điện thoại công ty + fax tách nhãn riêng (fax không phải kênh liên hệ);
- LinkedIn công ty, ở mức liên hệ thủ công;
- 2 người công bố kèm email: Steve Sousa, Todd Garcia;
- loại trừ đúng: `mariani@worldpantry.com` và số `989-514-1459` của đơn vị vận hành web store;
- "chưa thấy": WhatsApp, kèm ghi chú trang chỉ có chat trực tuyến (Gorgias).

---

## 12. Danh sách buyer & xuất CSV

Màn hình `/[locale]/buyers` là chế độ list-first: nhiều công ty trên một bảng, mở rộng một dòng để xem kênh liên hệ đã tìm được.

| Cột | Ý nghĩa |
| --- | --- |
| Công ty | tên, quốc gia, ngành |
| Kênh xuất được | số kênh đã qua policy (kèm số đã xác minh) |
| Người liên hệ | số người tìm được tên |
| Thấy lần cuối | lần cuối hệ thống thấy dữ liệu liên hệ |

Bấm một dòng để xem từng kênh: giá trị, người + chức danh (nếu có), `identity_match`, nhãn tin cậy, và link nguồn.

### CSV

`GET /api/export/buyers` (nút "Xuất CSV" trên màn hình gọi endpoint này).

- Dữ liệu lấy từ view `outreach_ready_contacts` — **đã áp policy**, nên CSV không cần lọc lại: kênh chưa kiểm mailbox, catch-all, hết hạn đều không nằm trong view.
- Cột: `company, country, website, person_name, job_title, department, channel_type, channel_value, confidence, identity_match, deliverability, verified, export_scope, source_url, last_seen`.
- **Không có cột xếp hạng, điểm, mức ưu tiên hay khuyến nghị** — có test khẳng định điều này.
- BOM UTF-8 + xuống dòng CRLF để Excel mở tiếng Việt không lỗi font.
- Bộ lọc trên màn hình truyền xuống endpoint (`country`, `q`, `people`), nên file tải về đúng bằng những gì đang nhìn thấy.
- Số dòng bị giữ lại hiển thị ngay trên màn hình (ví dụ "3 kênh bị giữ lại") để file không bị hiểu là thiếu dữ liệu một cách âm thầm.

Kiểm chứng: `npm run export:test` — 43 check, gồm đọc lại CSV bằng parser RFC 4180 để chắc dấu nháy và dấu phẩy sống sót, và kiểm không có cột khuyến nghị.

---

## 13. Hệ thống tìm những gì (trạng thái đang chạy, 06/10/2026)

Đây là danh mục đúng theo những gì pipeline hiện tại trích được, không phải danh sách mong muốn.

**Về công ty** — đọc từ trang công khai của chính công ty và hồ sơ LinkedIn công ty:

| Trường | Ghi chú |
| --- | --- |
| Tên công ty, quốc gia, thành phố | dùng để định danh, không suy diễn |
| Ngành, mô tả 1–2 câu | rút từ nội dung trang |
| Website chính thức | link công ty tự dùng |
| LinkedIn công ty | chỉ khi công ty tự liên kết ra |
| Email kinh doanh công bố | **nguyên văn trên trang**, không sinh theo pattern |
| Điện thoại văn phòng | tách khỏi fax; fax ghi nhãn riêng và không tính là kênh liên hệ |
| WhatsApp doanh nghiệp | chỉ khi công ty công bố |
| Biểu mẫu liên hệ | form trên website — đường vào công ty không cần tên ai |
| Tín hiệu | ví dụ "có bộ phận mua nguyên liệu riêng" — đọc từ nội dung trang |
| Confidence, ngày chụp, ngày hết hạn | do hệ thống tính và ghi |
| Bằng chứng | mỗi giá trị có URL trang đã thấy nó **và câu chữ đã thấy** |
| Trong PDF công khai | cùng loại dữ liệu (email, điện thoại, tên + chức danh), đọc từ báo cáo thường niên / press release / tài liệu nhà cung cấp / catalogue cùng tên miền |

**Về người** — từ hồ sơ LinkedIn công khai và từ các khối liên hệ công bố trên trang công ty:

| Trường | Ghi chú |
| --- | --- |
| Tên, chức danh, bộ phận | |
| Chức danh trước đây | nếu nguồn công bố |
| Kênh của chính người đó | hồ sơ LinkedIn, email công bố kèm tên, điện thoại nếu công bố ngay cạnh tên |
| Ngày thấy lần cuối + nguồn | |

**Về kênh liên hệ**: email (chung / bộ phận / theo vùng hoặc cá nhân), điện thoại, fax, LinkedIn (công ty và cá nhân), biểu mẫu, WhatsApp. Mỗi kênh mang theo nguồn, `certainty`, `identity_match` và `policy` trong model — report chỉ hiển thị nội dung, các nhãn nằm ở danh sách buyer và CSV.

**Về nguồn**: danh sách URL đã đối chiếu; mỗi trường chỉ tới trang đã thấy nó.

**Ghi nội bộ, không hiển thị cho người dùng**: thứ không tìm thấy, giá trị bị loại trừ (email/số của bên thứ ba, số của đơn vị vận hành web store, email đuôi tên file ảnh), trang bị chặn (401/403/429), trang bị robots.txt chặn.

### Những gì hệ thống **không** tìm được hôm nay

| Thứ | Vì sao |
| --- | --- |
| Số di động cá nhân | LinkedIn không có trường số điện thoại; dưới ~5% thành viên công khai và thường chỉ mở cho kết nối cấp 1. Muốn có phải cắm nguồn trả phí, và phải ghi rõ nguồn |
| Email suy luận theo pattern | chưa bật ở report; giai đoạn sau, phải có nhãn, hạn 30 ngày, không export trực tiếp |
| Nội dung sau đăng nhập / login wall / CAPTCHA | không bao giờ vượt |
| Dữ liệu thương mại trả phí (CBP manifest qua ImportYeti / Volza / Panjiva) | chưa cắm; đây là nguồn trade signal, không phải nguồn contact |
| Sổ đăng ký nhà nước (UK Companies House, SEC EDGAR) | chưa cắm — miễn phí, là lớp tiếp theo nên làm |
| Hội chợ / hiệp hội ngành | chưa cắm — không có API, phải đọc trang danh sách nhà triển lãm |
| Checklist giấy tờ / điều khoản nhà cung cấp phải đáp ứng | **đã làm (06/10/2026)** — xem §15 |
| Vai trò nhà sản xuất hay thương lái (`shipper_role`) | chưa làm (đang nợ) |
| Năm thành lập, quy mô nhân sự, địa chỉ | **mới chỉ có trong dữ liệu demo**; connector chưa trích và view thật chưa map — cần làm |
| Checklist giấy tờ trong PDF | **đã làm** — xem §15 |

**Giới hạn kỹ thuật đang áp:** chỉ trang công khai · tôn trọng `robots.txt` · chỉ cùng domain · không đăng nhập, không tài khoản giả, không giải CAPTCHA · chặn SSRF trước khi kết nối · mọi giá trị phải xuất hiện nguyên văn trên trang.

---

## 14. Các lớp nguồn, và AI làm gì trong dự án này

### 14.1 "Tự vào tự tìm" được đến đâu

Công bằng mà nói: phần **dễ** thì người dùng tự làm được, và họ nói đúng. Website, số tổng đài, email chung của một công ty lớn — 5 phút Google là ra. Nếu sản phẩm chỉ dừng ở đó thì không có lý do tồn tại.

Phần người dùng **không** tự làm được:

- **Đọc chéo ngôn ngữ và ngữ cảnh**: biết trang "Supplier Requirements" của một nhà nhập khẩu Mỹ nói gì, biết hội chợ nào mới là hội chợ ngành, biết sổ đăng ký nào của bang nào có officers.
- **Tìm *ai đang mua*** chứ không phải *ai có website*: đó là dữ liệu vận tải/hải quan, không nằm trên Google.
- **Đi đúng cửa**: vendor registration / supplier portal / RFQ — thường không phải email của giám đốc mua hàng mà là một form mà nhà cung cấp Việt không biết đường tới.
- **Làm đủ nhiều công ty, và làm lại**: 30 buyer, mỗi tháng kiểm lại người đổi chức, kênh đổi, có lô hàng mới. Người tự tìm được 3 công ty rồi dừng.

### 14.2 Các lớp nguồn — cái gì thêm được gì

| Lớp | Cho thêm | Chi phí | Trạng thái |
| --- | --- | --- | --- |
| **Trang công khai của chính công ty** | email, điện thoại, LinkedIn, form, tín hiệu | miễn phí | **đang chạy** |
| **Nhiều nguồn công khai hơn**: press release, PDF/báo cáo thường niên, catalogue, tài liệu nhà cung cấp | người (kèm chức danh), email bộ phận, số điện thoại, ngày | miễn phí (tốn công đọc) | **đã cắm một phần (06/10/2026)**: đọc PDF cùng tên miền + mở rộng đường dẫn; danh bạ hội chợ / hiệp hội ngành còn thiếu |
| **Sổ đăng ký nhà nước**: UK Companies House (API free, có officers/PSC, OGL cho phép dùng thương mại), SEC EDGAR (công ty đại chúng) | officers **chính thống**, không phải scrape | miễn phí | chưa cắm |
| **Dữ liệu vận tải/hải quan**: US CBP manifest qua ImportYeti / Volza / Panjiva / ImportGenius | **ai đang mua mặt hàng này, từ ai, khối lượng, tần suất** — đây mới là tín hiệu người mua thật | ImportYeti có bản free giới hạn; Volza ~1.500 USD/năm; Panjiva/ImportGenius ~125–1.000+ USD/tháng | chưa cắm (cần API key/ngân sách) |
| **Nhà cung cấp enrichment** (Apollo, ZoomInfo, Volza contact) | email, số điện thoại cá nhân | trả phí | chưa cắm — dữ liệu là của họ, mình **không kiểm chứng được nguồn gốc**, và nghĩa vụ dữ liệu cá nhân (PDP Law 91/2025, GDPR) vẫn thuộc về mình |
| **Kiểm tra mailbox** (MillionVerifier, NeverBounce…) | biến "tìm thấy" thành "gửi được": valid / catch-all / invalid | ~2–10 USD/1.000 | chưa cắm — rẻ, nên làm |
| **Theo dõi thay đổi** | người đổi chức, kênh đổi, hợp đồng mới | hạ tầng | có bảng `report_changes`, chưa chạy định kỳ |

Ba điều **không** đổi dù cắm thêm nguồn nào:

1. Không đăng nhập, không tài khoản giả, không giải CAPTCHA.
2. Đi tới **nguồn gốc** của dữ liệu (manifest, sổ đăng ký) hoặc mua từ nhà cung cấp — không scrape nền tảng trung gian rồi bán lại.
3. Mỗi giá trị vẫn phải kèm nguồn; giá trị mua từ bên thứ ba phải ghi rõ là mua, không được trình bày như tự tìm được.

### 14.3 AI làm gì ở đây

Hôm nay AI mới làm phần **nhỏ nhất**, và nên nói thẳng như vậy:

| Việc | Hôm nay | Cần AI làm |
| --- | --- | --- |
| Đọc hiểu một trang | rule + ngữ cảnh: chọn email nào là của công ty, số nào là fax, tên nào đi với email nào, loại số của web store | mở rộng khi trang lạ hơn |
| **Chọn nguồn để đọc** | cố định vài đường dẫn (`/contact`, `/about`, `/suppliers`…) | tự quyết định: công ty thực phẩm Mỹ thì đọc tiếp trang vendor/supplier, PDF annual report, press release, hội chợ nào |
| **Hợp nhất thực thể** | chưa có | cùng một công ty ở website + sổ đăng ký + dữ liệu hải quan + báo chí → một hồ sơ, không nhân bản, không lẫn công ty trùng tên |
| **Đọc tài liệu dài** | **đã có bước đầu**: đọc chữ trong PDF, nhận diện chứng nhận/giấy tờ/điều khoản và giữ nguyên câu gốc (§15) | rút gọn thành checklist nhóm theo loại, và đọc được cả bảng biểu trong PDF |
| **Đối chiếu mâu thuẫn** | ghi cả hai, không phán | hai nguồn nói khác nhau → giữ cả hai kèm ngày, biết cái nào mới hơn |
| **Theo dõi thay đổi** | có bảng `report_changes` | đọc lại đúng thứ đã đổi, không đọc lại tất cả |
| **Khớp sản phẩm ↔ người mua** | chưa có | HS code + sản phẩm của nhà cung cấp Việt ↔ mặt hàng buyer đang nhập ↔ nhà máy phù hợp |

**Tóm lại:** giá trị không nằm ở việc đọc một trang web — việc đó ai cũng làm được. Nó nằm ở **đọc nhiều nguồn, hợp nhất thành một hồ sơ đúng, chỉ ra cửa vào đúng, và giữ nó tươi** — cộng thêm lớp dữ liệu mà Google không có (hải quan, sổ đăng ký). Nguồn nào cắm thêm là quyết định về ngân sách và pháp lý, không phải quyết định kỹ thuật.

---

## 15. Điều kiện & giấy tờ nhà cung cấp phải đáp ứng (06/10/2026)

Tiêu chí "điền đủ" từ đầu dự án: mọi điều khoản/giấy tờ nhà cung cấp phải đáp ứng đều phải hiện trong report. Phần này giờ đã chạy.

### Tìm ở đâu

Trong mọi nguồn đã đọc — trang HTML **và** PDF (báo cáo thường niên, press release, catalogue, tài liệu nhà cung cấp). Đây là lý do phần đọc PDF được làm trước: yêu cầu nhà cung cấp hầu như luôn nằm trong tài liệu, không nằm trên trang chủ.

### Điều kiện để một câu thành một mục

Một dòng chỉ được ghi nhận khi có **cả hai**:

1. **Có ký hiệu của một loại giấy tờ/chứng nhận** trong danh mục (BRCGS, SQF, HACCP, ISO 22000/9001, FSSC 22000, GMP/GHP, GlobalG.A.P., Kosher, Halal, hữu cơ, FDA, FSVP, SMETA/Sedex, BSCI, SA8000, COA, COO, kiểm dịch thực vật, hun trùng, health certificate, bảo hiểm trách nhiệm sản phẩm, W-9, kế hoạch an toàn thực phẩm, truy xuất nguồn gốc, phiếu thông số, MRL/dư lượng, aflatoxin/kim loại nặng, nhãn mác, dị ứng, audit bên thứ ba, MOQ, điều khoản thanh toán, lead time, mẫu trước khi giao);
2. **Có dấu hiệu yêu cầu** (`must`, `shall`, `required`, `comply`, `provide`, `submit`, `approved`, `audited`, `prior to shipment`, "yêu cầu", "phải", "đáp ứng"…), **hoặc** dòng nằm ngay dưới một tiêu đề yêu cầu (`Supplier requirements`, `Required documents`, `Vendor approval`… trong vòng 4 dòng).

Điều khoản thương mại tự nó là dữ liệu: câu "Our minimum order quantity is one container and payment terms are net 30 days" không có chữ `must` nào nhưng chính là thứ nhà cung cấp cần biết, nên các cụm MOQ / payment terms / L/C / net N days / lead time / sample cũng được tính là dấu hiệu.

### Chống đọc nhầm

Câu nói về **chính nhà nhập khẩu** không phải yêu cầu đối với nhà cung cấp. Nếu câu khớp `we are / we have / our plant / our facility / our company / our brand` **và** không hướng tới nhà cung cấp (`suppliers`, `vendors`, "nhà cung cấp", `you must`), câu đó bị bỏ. Ví dụ bị bỏ đúng: "We are BRCGS certified since 1998", "Our own facility is audited to BRCGS standard".

### Lưu và hiển thị gì

Mỗi mục gồm: nhãn tiếng Việt (bản dịch tên loại giấy tờ), **nguyên văn câu của nhà nhập khẩu** (bằng chứng, không viết lại), nhóm (chứng nhận / giấy tờ / kiểm tra / điều khoản / nhãn mác), URL nguồn, và nguồn là trang hay PDF. Không có lời khuyên, không xếp hạng, không suy diễn thêm: đây là chính sách của nhà nhập khẩu, không phải khuyến nghị của nền tảng.

Report hiển thị theo thứ tự: chứng nhận → kiểm tra → giấy tờ → điều khoản → nhãn mác. **Không tìm thấy thì không hiện gì** — không có mục "không tìm thấy" cho người dùng.

Yêu cầu được lưu vào `report_data.requirements` cùng report, nên mở lại report là còn nguyên.

Kiểm chứng: `npm run requirements:test` — 24 check, gồm: bỏ câu tự khoe chứng nhận, giữ nguyên văn câu, mỗi mục có nguồn, gạch đầu dòng dưới tiêu đề vẫn được tính, trang không có yêu cầu thì ra 0 mục, đọc được từ PDF, và không mục nào chứa lời khuyên.
