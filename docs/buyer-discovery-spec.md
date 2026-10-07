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

### Sai sót là bình thường — nhưng "tự tin mà sai" thì không (07/10/2026)

Người dùng thật **không kỳ vọng đúng 100%**. Họ tự kiểm dòng quan trọng trước khi gọi hay gửi email, và họ quen với việc dữ liệu ngoài thị trường có sai số. Vì vậy mục tiêu của hệ thống **không phải** "không bao giờ sai" — mục tiêu là **sai sót tự lộ ra, và sửa rẻ**.

Bộ lọc dùng khi quyết định sửa gì, sửa ngay hay để sau:

| Mức | Ví dụ thật | Xử lý |
| --- | --- | --- |
| **1. Sai, nhưng trông như đúng** | Số tổng đài của American Arbitration Association thành "Điện thoại công bố" của Mariani, kèm nhãn **đã thấy công bố** | Sửa ngay. Đây là loại duy nhất phá niềm tin |
| **2. Chưa kiểm được, và nói rõ là chưa kiểm** | SEC trả về định dạng lạ; chưa có tài khoản Cloud API nên chưa kiểm WhatsApp; 0 kết quả search | **Chấp nhận.** Chỉ cần câu chữ đừng giả vờ là kết luận |
| **3. Thiếu dữ liệu mà nói rõ là thiếu** | Không tìm được cửa mua hàng; trang bị robots.txt chặn | **Chấp nhận.** Người dùng tự đi tìm — không mất gì |
| **4. Không đọc được, nhưng bị viết thành "không có"** | Đọc CIK thất bại → in "không tìm thấy hồ sơ theo tên này" | Sửa ngay — đây là mức 1 trá hình |

Ranh giới duy nhất phải giữ, và nó không phải là đòi hỏi hoàn hảo:

> **Không được nói "chắc chắn" khi chưa biết. Không được giấu việc mình chưa kiểm.**

Đó chính là điều làm cho mức sai sót bình thường trở nên **dùng được**: một dòng sai mà có kèm nguồn và câu văn trích dẫn thì người dùng sửa trong năm giây; một dòng sai mà tự tin thì họ mất một cuộc gọi, hoặc gửi email cho nhầm người. Vì vậy mọi thứ đã có trong dự án đều phục vụ đúng việc này: nhãn tin cậy, câu văn thấy trên trang, danh sách "đã loại trừ kèm lý do", ba trạng thái của `has_whatsapp`, và câu "0 kết quả không có nghĩa là khoá hỏng".

**Hệ quả ngược lại cũng phải nhớ:** luật chặt để tránh mức 1 sẽ **bỏ sót dữ liệu thật**. Luật số điện thoại mới (nhãn phải nằm ngay trước số) sẽ bỏ vài số thật trên trang viết ẩu — chấp nhận được, vì số bị bỏ **nằm trong "đã loại trừ" nên lấy lại được**, còn cuộc gọi nhầm cho bên thứ ba thì không lấy lại được. Nguyên tắc: khi phải chọn giữa "bỏ sót" và "nói sai", chọn bỏ sót — nhưng **phải ghi lại cái đã bỏ sót**.

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

### Dòng "gần đúng — người xem lại" (07/10/2026)

Một báo cáo nói *"chưa có kênh nào thuộc nhóm mua hàng"* trong khi trên trang có `ingredients@mariani.com` là câu **đúng nhưng vô dụng**. Hộp thư đó **có thể** là cửa vào bộ phận thu mua — cũng có thể là bộ phận **bán** nguyên liệu; tên hộp thư không cho biết bên nào. Người dùng nhìn một giây là quyết, nên hệ thống không tự quyết thay họ và cũng không im lặng: nó nêu ra kèm lý do.

`nearMissBuyingDoors` (trong `gate.ts`) tìm những hộp thư như vậy và trả về `value` + từ khoá khớp + lý do. Kết quả nằm ở trường `reviewHints` của `ConnectorResult`, CLI in thành mục **"GẦN ĐÚNG — NGƯỜI XEM LẠI"**, API trả trong JSON.

Ba hàng rào giữ cho danh sách này không thành nhiễu:

| Hàng rào | Vì sao |
| --- | --- |
| Chỉ xét **email** | Số điện thoại và biểu mẫu không có tên hộp thư để đọc |
| Bỏ qua kênh gắn với **một người** | Đã có tên để tra chức danh, không cần "gần đúng" |
| Bỏ qua kênh **đã thuộc nhóm mua hàng** | Đó là cửa thật, không phải gần đúng |

**Điều quan trọng nhất:** danh sách này **không** tham gia vào cổng quyết định. `coverageOf` giữ nguyên, nên một dòng "gần đúng" không bao giờ chặn bước 3 — và ngược lại, nó chỉ được nêu khi **đã thử mọi bước mà vẫn chưa tới cửa**: tìm được cửa thật rồi thì danh sách rỗng, vì lúc đó nêu thêm chỉ làm loãng thứ đã tìm được.

Danh sách từ khoá (`NEAR_MISS_WORDS`: `ingredient`, `raw material`, `rawmaterials`, `materials`, `nguyen lieu`, `nguyenlieu`) **cố ý giữ ngắn và ở một chỗ**. Mỗi từ thêm vào là một lần hệ thống tự cho mình quyền đoán thêm — nguyên tắc chung của dự án là mở rộng danh sách này chỉ khi có ca thật, và khi mở thì sửa đúng một dòng.

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

---

## 16. Đối chiếu với thiết kế chuẩn của người dùng (06/10/2026)

Người dùng đưa một thiết kế 5 bước + 5 cổng + 3 trạng thái đầu ra và hỏi code đã theo chưa. Kết quả đối chiếu đầy đủ (kèm `file:dòng`) nằm ở [`docs/contact-candidate-pipeline-audit.md`](./contact-candidate-pipeline-audit.md). Tóm tắt:

- **Đã có:** bước 2 (nguồn cấp 1, kể cả PDF), bước 4 (trích xuất có `source_url` + `evidence_snippet`, không bao giờ sinh email theo pattern), cổng Domain, và phần lớn cổng Entity.
- **Một phần:** cổng Role (có nhận diện, chưa có cổng chặn), cổng Email (chỉ email công bố, nhưng chưa có ba nhãn `published_named` / `published_role_mailbox` / `inferred_unverified`), cổng Freshness (có `verified_at` + hạn 90 ngày, chưa có job re-verify).
- **Chưa có:** bước 1 (resolve pháp nhân từ tờ khai hải quan — chưa có dữ liệu hải quan), bước 3 (nguồn cấp 2), và **tầng ghi kết quả connector vào database**.
- **Chỗ lệch model:** thiết kế muốn `contact_candidates` mang `evidence_quote` + `source_urls`. Hệ thống đang tách đúng theo bản chất dữ liệu: bằng chứng nằm ở `contact_channels` (`source_url` + `evidence_snippet`, DB buộc `confirmed` phải có `source_url`), còn `contact_candidates` là **giả thuyết** với `pattern_used` + `inference_basis` bắt buộc và hạn 30 ngày. Muốn theo đúng chữ của thiết kế thì cần thêm cột, nhưng thêm bằng chứng vào bảng giả thuyết sẽ làm mờ đúng ranh giới mà migration 006 dựng lên — nên ghi lại để người dùng chọn.

---

---

## 17. Ghi kết quả vào database — vòng lưu đã khép (07/10/2026)

Trước phần này, connector đọc xong là xong: kết quả nằm trong response, đóng tab là mất, và danh sách buyer không bao giờ có công ty vừa tra. Đây là việc #1 trong bản đối chiếu (§16). Giờ đã có `src/lib/connector/persist.ts`.

### Ghi gì, vào đâu

| Kết quả connector | Bảng | Ghi chú |
| --- | --- | --- |
| Công ty (theo tên miền) | `buyer_profiles` | khoá `(organization_id, domain)`; chạy lại thì cập nhật, không thêm dòng mới |
| Người tìm được (tên + chức danh) | `decision_makers` | hạng `b` — có tên, một nguồn công khai; hạng `a` để dành cho nguồn chính thức đối chiếu được |
| Kênh liên hệ | `contact_channels` | `provenance = 'company_site'`, `discovered_by = 'web_research_agent'` |
| Trang mua hàng / đăng ký nhà cung cấp / email bộ phận | `buyer_routes` | chỉ khi đường dẫn trang **đã đọc thật** khớp nghĩa — không suy từ trang liên hệ chung |

### Bốn điều tuyệt đối không ghi

1. **`contact_candidates` luôn trống** sau mỗi lần ghi. Bảng đó dành cho email đoán theo pattern; connector không đoán, nên nó không có gì để ghi vào đó. Test SQL khẳng định bảng trống sau khi ghi.
2. **`is_verified` luôn `false`.** Connector chứng minh được "giá trị này có trên trang công khai", không chứng minh được "hộp thư này là của đúng người". Database phân biệt hai chuyện đó, và tầng ghi không được trộn.
3. **Thiếu trang nguồn hoặc thiếu câu chữ thì không ghi.** Mỗi dòng phải mang `source_url` + `evidence_snippet` là nguyên văn câu chứa giá trị; thiếu một trong hai thì dòng đó bị bỏ và ghi vào `skipped` kèm lý do (không hiện cho người dùng).
4. **Hồ sơ LinkedIn cá nhân (`/in/…`) không thành kênh của công ty.** Bị bỏ ngay từ lúc tách dữ liệu, và tầng ghi chặn lần thứ hai.

### Thứ không được phép tự bịa

`buyer_profiles.country` là cột bắt buộc, và tầng ghi **không suy quốc gia từ đuôi tên miền** (`.com` không nói lên gì). Thiếu `country` thì API trả `persisted: false` kèm đúng lý do, chứ không lưu một dòng nửa vời.

### Ghi bằng service role

Migration 005/006 thu hồi `insert/update/delete` trên các bảng buyer khỏi `authenticated`: trình duyệt không có quyền ghi dữ liệu buyer. Vì vậy tầng ghi chạy bằng service role ở server, và `organization_id` lấy từ **phiên đăng nhập**, không bao giờ lấy từ body request.

### Người dùng thấy gì sau khi tra

Công ty vừa tra xuất hiện trong `/vi/buyers` (view `buyer_outreach_summary` + `outreach_ready_contacts`), kèm số kênh và số người. Cái gì xuất được là do `contact_export_policy` quyết định, không do UI:

- Email công bố nhưng chưa kiểm mailbox → `blocked_reason = 'deliverability_unchecked'` → **xuất được, chưa `outreach_eligible`**.
- LinkedIn công ty → `manual_contact_only` → xuất được, không dùng để gửi tự động.
- Hết hạn 90 ngày thì rơi khỏi danh sách xuất, không cần ai nhớ.

### Kiểm chứng

`npm run persist:test` — 46 check, hai phần: (1) dựng dữ liệu thuần, (2) ghi vào Postgres thật (PGlite, đủ 6 migration) rồi đọc lại bằng chính các view của ứng dụng. Trong đó có: chạy lần hai chỉ làm mới `last_seen_at` chứ không nhân đôi kênh/người/đường vào, `contact_candidates` trống, mọi dòng có nguồn, và workspace khác không đọc được dòng nào.

### Còn thiếu

Đúng như bản đối chiếu: enum `role_kind` / `email_kind` để Role và Email thành cổng chặn thật; job re-verify 90–180 ngày; nguồn cấp 2 (search API, sổ đăng ký); resolve pháp nhân từ dữ liệu hải quan.

---

## 18. Bằng chứng thành ràng buộc cứng, và lần kiểm thứ hai (07/10/2026)

Migration 007 đóng nốt khoảng cách giữa "đã biết phải làm gì" và "database bắt buộc phải làm thế".

### Câu trích dẫn: từ "nên có" thành bắt buộc

005 đã buộc mọi dòng `confirmed` phải có `source_url`. Nhưng `evidence_snippet` vẫn cho phép NULL, nên vẫn lọt được một giá trị mà không ai chỉ ra được nó nằm ở đâu. 007 thêm ràng buộc:

```sql
check (certainty <> 'confirmed' or nullif(btrim(coalesce(evidence_snippet, '')), '') is not null)
```

Nghĩa là: **một dòng `confirmed` mà không có câu trích dẫn thì database từ chối thẳng**, không phải chỉ code cẩn thận. Thêm cột `evidence_url` — bản sao có tên rõ nghĩa của `source_url`, để câu SQL đọc bằng chứng không phải biết tên cột cũ.

### Hồ sơ LinkedIn cá nhân cũng bị chặn ở tầng dữ liệu

Quy tắc "hồ sơ `/in/` không phải kênh của công ty" trước đây nằm ở code (`extract.ts`) và tầng ghi (`persist.ts`). Giờ nó thành ràng buộc: một URL `/in/` chỉ tồn tại được khi nó thuộc về một người có tên trong `decision_makers`.

### `is_verified` chỉ đến từ một đường

Không có policy update nào trên `contact_channels`, và quyền ghi đã bị thu hồi khỏi `authenticated`. 007 thêm hàm duy nhất được bật cờ đó:

```sql
select public.verify_contact_channel('<channel-id>');  -- chỉ service role gọi được
```

Hàm chỉ trả `true` khi hội đủ: không phải phỏng đoán (`certainty <> 'inferred'`), hộp thư không phải loại đã biết là hỏng, và có **cả** trang nguồn lẫn câu trích dẫn. Không đủ thì trả `false`, không ném lỗi — người gọi cần biết "chưa xác minh được", không cần một ngoại lệ khó hiểu.

### Một điểm hệ thống làm chặt hơn thiết kế

Thiết kế đặt Email Gate ở chỗ "công bố hay tự đoán". Hệ thống còn một câu hỏi nữa, và tách hẳn ra: **hộp thư có tồn tại không**. Kể cả khi đã xác minh chủ sở hữu, một email chưa kiểm mailbox vẫn **chưa** `outreach_eligible` — vì gửi vào đó có thể trả về bounce. Nó vẫn xuất được (`exportable`), chỉ chưa dùng để gửi tự động. Muốn dùng thì chạy bước kiểm mailbox (≈2–10 USD/1.000, spec §14).

Chuỗi trạng thái đầy đủ, kiểm trong `npm run persist:test`:

| Bước | `exportable` | `outreach_eligible` | `blocked_reason` |
| --- | --- | --- | --- |
| Vừa đọc được trên trang công khai | ✅ | ❌ | `deliverability_unchecked` |
| Xác minh chủ sở hữu (`verify_contact_channel`) | ✅ | ❌ | `deliverability_unchecked` |
| Kiểm mailbox xong (`deliverability = 'valid'`) | ✅ | ✅ | — |

### Kiểm chứng

- `npm run db:verify` — 7 migration, thêm 7 check: dòng `confirmed` thiếu câu trích dẫn bị từ chối, `evidence_url` phản chiếu đúng trang đã đọc, `/in/` đứng một mình bị từ chối, hàm xác minh nhận dòng đủ điều kiện và từ chối phỏng đoán lẫn hộp thư đã biết là hỏng, và `authenticated` không gọi được hàm đó.
- `npm run persist:test` — 54 check, gồm cả chuỗi ba trạng thái ở bảng trên và hai ràng buộc mới bị database từ chối thi hành.

---

## 19. Số điện thoại chuẩn E.164 và WhatsApp (07/10/2026)

WhatsApp là kênh chính của khách B2B xuất nhập khẩu, nên số điện thoại phải dùng được, không chỉ để đọc. Yêu cầu gồm ba phần; hai phần đã chạy, phần thứ ba chờ dịch vụ kiểm (xem [`docs/backlog.md`](./backlog.md)).

### E.164 — làm được, nhưng không phải bằng cách đoán

`src/lib/connector/phone.ts` chuẩn hoá số theo ba tình huống:

| Trên trang | Kết quả | Ví dụ |
| --- | --- | --- |
| Đã có `+` | Làm sạch, giữ nguyên | `+84 28 3822 1234` → `+842838221234` |
| Viết lối `00` | Đổi thành `+` | `00 84 28 3822 1234` → `+842838221234` |
| Số nội địa, **biết quốc gia** | Bỏ số đầu theo thông lệ nước đó, ghép mã quốc gia | `(028) 3822 1234` + Việt Nam → `+842838221234` |
| Số nội địa, **chưa biết quốc gia** | **Không** thêm mã quốc gia; ghi lý do | `707-452-2800` → để trống `phone_e164` |

Bảng mã quốc gia phủ ~55 nước (thị trường xuất khẩu chính + láng giềng Việt Nam), kèm số đầu phải bỏ: `0` với phần lớn các nước, **không có** với Mỹ/Canada/Ý/Tây Ban Nha, `8` với Nga. Ý là ví dụ đáng nhớ: `06 …` **giữ** số 0 (`+3906…`), không cắt như `+44`/`+49`.

**Vì sao không nới quy tắc "không tự thêm mã quốc gia":** số E.164 là thứ mở `wa.me/<số>`. Một mã quốc gia sai không chỉ là dữ liệu xấu — nó mở cuộc trò chuyện với một người lạ. Vì vậy `value` (số như đã công bố) và `phone_e164` (số chuẩn hoá) là hai trường riêng, và số nội địa không rõ quốc gia thì để trống trường thứ hai.

### `has_whatsapp`: boolean ba trạng thái

| Giá trị | Nghĩa |
| --- | --- |
| `null` | **Chưa ai kiểm.** Mọi dòng connector ghi ra đều ở trạng thái này. |
| `true` | Đã kiểm bằng một dịch vụ và **có** WhatsApp. |
| `false` | Đã kiểm và **không** có. |

Không mặc định `false`, vì "chưa kiểm" khác "đã kiểm và không có". Database bắt ba điều: `true` phải có `whatsapp_checked_at`, phải nêu `whatsapp_checked_by`, và phải có `phone_e164` (không mở nút chat bằng số chưa biết mã quốc gia). `phone_e164` chỉ dành cho `channel_type = 'phone'`.

Một dòng `channel_type = 'whatsapp'` là **kênh công bố sẵn** (link `wa.me` trên trang) — khác hẳn trường `has_whatsapp` (kết quả của một lần kiểm). Cả hai đều có chỗ và không lẫn nhau.

### Vì sao chỗ kiểm vẫn còn trống — và cái gì thật sự cắm được (kiểm lại 07/10/2026)

Người dùng hỏi có tích hợp luôn dịch vụ kiểm không. Câu trả lời ngắn: **có, nhưng phải chọn giữa một đường chính thức tốn tiền theo tin nhắn và một đường không chính thức có rủi ro khoá số.** Ba mươi phút tra lại tài liệu cho ra đúng bức tranh này:

| Đường | Kiểm được trước khi gửi? | Chi phí | Rủi ro |
| --- | --- | --- | --- |
| **Meta WhatsApp Cloud API — endpoint `/contacts`** | Có, nếu endpoint tồn tại với tài khoản của mình | Theo tin nhắn/hội thoại của Cloud API | Không rủi ro khoá; nhưng **không có tài liệu chính thức**: URL `developers.facebook.com/docs/whatsapp/cloud-api/reference/contacts/` trả 404, còn báo cáo cộng đồng (02/2026) dùng `POST /{phone_number_id}/contacts` với `contacts` + `force_check`. Đường này **phải tự thử với tài khoản thật** trước khi tin |
| **Gửi một template rồi đọc trạng thái** (Cloud API chính thức) | Không phải "kiểm" — gửi thật rồi đọc webhook: `sent` nghĩa là số có WhatsApp, `delivered` nghĩa là máy đã nhận; mã `131026` là nhóm "số xấu" nhưng nhiễu | Mỗi lần kiểm là **một tin nhắn thật**; Meta chỉ tính tiền tin gửi được (tin tới số không tồn tại không bị tính), nhưng Twilio thu thêm 0,001 USD/tin lỗi | Không rủi ro kỹ thuật, nhưng phải có cơ sở liên hệ (opt-in) và đúng loại template — không thể dùng làm máy quét hàng loạt |
| **Twilio** | **Không.** Twilio không có API kiểm số có WhatsApp; tài liệu của họ tự chỉ người dùng mở `wa.me/<số>` bằng tay, hoặc đọc Error Logs | — | — |
| **Gateway không chính thức** (Green API `checkWhatsapp`, Whapi.Cloud, các dịch vụ "bulk checker") | Có, theo lô | Green API từ ~12 USD/tháng/instance; hạn mức `checkWhatsapp` 100 lượt/tháng ở gói Developer, 30.000 ở gói Business | **Trái điều khoản của Meta.** Các gateway này chạy qua một phiên WhatsApp Web đã đăng nhập; số dùng để kiểm **có thể bị khoá**, và dịch vụ bên thứ ba đọc được danh sách số mình đưa vào |

Ghi chú đã bỏ đi một điều sai từng được lặp lại: **On-Premises API từng có `/contacts` để kiểm trước, Cloud API bỏ nó** — nhưng không phải "Meta không có cách nào": vẫn còn đường gửi-thật-đọc-trạng-thái, và endpoint `/contacts` có dấu vết trở lại trên Cloud API qua báo cáo cộng đồng (chưa có tài liệu chính thức).

**Điều đáng nói nhất về chi phí:** Meta chỉ tính tiền tin **gửi được**, nên một tin tới số không tồn tại không bị Meta tính (Twilio vẫn thu 0,001 USD/tin lỗi) — "gửi thật rồi đọc trạng thái" vì thế rẻ hơn vẻ ngoài của nó. Nhưng nó vẫn là một tin nhắn thật tới một người thật, kèm nghĩa vụ opt-in.

### Nếu số đang chạy WhatsApp Business app: Coexistence (07/10/2026)

Một số muốn vừa giữ app vừa cắm Cloud API thì Meta có **Coexistence** (mở từ 06/05/2025): app ≥ 2.24.17, bật qua Tech Provider / Solution Partner (không tự bật trong app), sync tối đa **6 tháng** chat 1:1 (nhóm không sync), phải mở app ít nhất **mỗi 13 ngày** và **không được gỡ app**, trần **20 tin/giây**, một vài tính năng bị tắt trong lúc chạy chung. Đường còn lại — chuyển hẳn số sang API — thì số đó không dùng được trên app nữa và lịch sử ở lại app.

**Thông tin đăng nhập cần đúng ba thứ**, đều lấy từ tài khoản của mình: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (token của **System user**, expiry *Never*, quyền `whatsapp_business_messaging` + `whatsapp_business_management`; token ở API Setup chỉ sống 24 giờ nên không dùng cho việc này), và tuỳ chọn `WHATSAPP_API_VERSION` (mặc định `v26.0` — bản v20.0 đã hết hạn 24/09/2026).

`npm run whatsapp:check` là đường kiểm: **không gửi tin nhắn nào**, chỉ hỏi tài khoản đang gọi là số nào rồi hỏi Meta các số được đưa vào. Kết quả đọc theo đúng ba trạng thái của `has_whatsapp`. Chưa có thông tin đăng nhập thì lệnh in ra các bước lấy rồi thoát 0 — thiếu phần này là trạng thái bình thường.

### Ba bài học từ lần chạy thật đầu tiên (07/10/2026, mariani.com)

Lần chạy thật đầu tiên bằng khoá Tavily đã lộ ra ba lỗi mà không bài test nào bắt được, vì cả ba đều cần dữ liệu thật của một website thật.

**1. Số điện thoại của bên thứ ba bị ghi thành số của công ty.** Trang điều khoản có câu "…the AAA Rules are available by calling the AAA at 1-800-778-7879…". Luật cũ chỉ đòi *một từ khoá liên hệ ở đâu đó trong dòng* — chữ "calling" đủ để số tổng đài của American Arbitration Association thành "Điện thoại công bố" của Mariani, kèm mức tin cậy **đã thấy công bố** và chính sách **dùng được**.

Luật mới: nhãn phải nằm **ngay trước** số (`Phone:`, `Fax`, `Hotline:`…), **hoặc** cả dòng phải là một dòng liên hệ ngắn (chân trang, khối liên hệ). Số đã có `+`/`00` thì vẫn nhận mà không cần nhãn — dạng đó tự nó đã nói rõ là số quốc tế. Số bị loại vì nằm giữa câu văn dài thì **được ghi vào "đã loại trừ" kèm lý do**, không biến mất im lặng.

**2. Biểu mẫu liên hệ nhân lên theo số trang.** Một biểu mẫu ở chân trang xuất hiện trên 12 trang đã đọc → 12 dòng "Biểu mẫu liên hệ trên website" giống hệt nhau, che mất những kênh thật sự khác. Biểu mẫu là thuộc tính của **website**, không phải của từng trang: `collapseFormChannels` giữ **một** cửa vào — trang sát việc mua bán nhất (nguồn hàng/mua hàng → liên hệ → giới thiệu) — và log của lần chạy nói ra số trang đã gộp.

**3. SEC EDGAR trả 403 vì User-Agent thiếu cách liên hệ.** Chính sách fair-access của SEC đòi header nhận diện được **kèm cách liên hệ**; User-Agent cũ chỉ có tên bot và URL nên bị chặn. Giờ `SEC_USER_AGENT` (ví dụ `Tên anh <email@congty.vn>`) đi từ `.env.local` xuyên qua API tới tận request, và thông báo lỗi 403 tự nói ra việc cần làm thay vì chỉ "SEC trả HTTP 403". Không bịa email liên hệ.

**4. Header HTTP không nhận chữ có dấu — và chính User-Agent mặc định của mình vướng lỗi này.** Sau khi sửa (3), lần chạy kế tiếp vẫn hỏng phần sổ Mỹ, nhưng ở tầng khác:

> `sổ đăng ký không cho kết quả: lỗi khi tra: Cannot convert argument to a ByteString because the character at index 42 has a value of 273 which is greater than 255.`

Index 42 là chữ **`đ`** (U+0111 = 273) — nằm trong **chuỗi mặc định của chính mình**: `"SeekoraBot/0.1 (public supplier research; đặt SEC_USER_AGENT kèm email liên hệ)"`. Header HTTP là **ByteString (Latin-1)**, không phải UTF-8; `fetch` ném lỗi ngay **trước khi gửi**. Nghĩa là request chưa từng rời máy, và câu lỗi chẳng nói gì về việc cần đặt `SEC_USER_AGENT` — tệ hơn cả lỗi 403 mà nó định hướng dẫn.

Cách sửa: `asciiHeaderValue` (trong `fetch.ts`) bỏ dấu rồi bỏ nốt ký tự ngoài ASCII, và **mọi** giá trị header do người dùng cấp đi qua đó — `SEC_USER_AGENT` (đặt tiếng Việt vẫn dùng được, tự chuyển thành `Nguyen Van A <a@congty.vn>`) lẫn `userAgent` truyền cho `fetchPage`. Khi phải bỏ dấu, lần chạy nói ra.

**Bài học về cách tìm lỗi:** câu lỗi "ByteString… value of 273" này **đã từng xuất hiện** trong một phép thử nội bộ trước đó (em dùng token giả có ký tự tiếng Việt), và lúc đó bị đọc là "token giả thì không tính". Đúng ra nó là một lỗi thật đang chờ: **lỗi chỉ được coi là "không tính" khi đã chứng minh được rằng dữ liệu thật không bao giờ rơi vào tình huống đó** — chứ không phải vì dữ liệu thử trông giả.

**5. "Không tìm thấy hồ sơ" phải là một kết luận, không phải một lần đọc thất bại.** Lần chạy thứ ba đã sạch (biểu mẫu gộp 1, số AAA bị loại, SEC không còn lỗi gửi), và sổ Mỹ trả về:

> `sổ đăng ký không cho kết quả: không tìm thấy hồ sơ theo tên này`

Câu trả lời **đúng** — Mariani là công ty tư nhân, family-owned từ 1906, không nộp hồ sơ cho SEC (kiểm qua hai nguồn độc lập). Nhưng khi soi lại cách mình ra câu trả lời đó thì thấy chưa chắc: theo tài liệu SEC, mã CIK nằm trong thẻ `<cik>` bên trong khối `<company-info>` mà `browse-edgar` thêm vào, còn code chỉ tìm dạng `CIK=0000320193` trong liên kết. Nghĩa là **cùng một câu được in cho hai tình huống khác hẳn nhau**: sổ thật sự không có công ty, và mình không đọc được phản hồi.

Một chỗ in như vậy biến **"chưa kiểm được"** thành **"đã kiểm, không có"** — đúng loại sai mà cả dự án đang chống (xem ba trạng thái của `has_whatsapp`). Sửa: `readCikFromEdgarFeed` đọc cả hai dạng (`<cik>` và `CIK=`), đệm mã cho đủ 10 chữ số, và tách **ba** kết cục — `found` / `none` (sổ nói "No matching companies") / `unreadable`. Chỉ `none` mới được phát biểu thành "không tìm thấy hồ sơ theo tên này"; `unreadable` nói thẳng là chưa kiểm được.

**Bài học:** câu trả lời đúng chưa chứng minh đường đi đúng. Khi một kết quả trùng với điều mình tin, đó chính là lúc phải kiểm cơ chế — vì "đúng vì may" sẽ hỏng ở ca tiếp theo, khi công ty **có** trong sổ.

Điểm chung của cả năm: **một lần chạy xanh không chứng minh dữ liệu đúng** — nó chỉ chứng minh không có lỗi nào bị ném ra. Ba lỗi này đều là "dữ liệu sai nhưng trông hợp lệ", đúng loại lỗi mà các cổng và nhãn tin cậy sinh ra để chặn.

### Nút WhatsApp trên UI

`public.contact_whatsapp_links` (008) chỉ trả những số **đã kiểm là có WhatsApp**, kèm `whatsapp_url = 'https://wa.me/' || <số không dấu +>`. Danh sách buyer đọc view này và hiện nút "Nhắn WhatsApp"; số chưa kiểm thì không có nút, không có suy đoán. View rỗng khi chưa cắm dịch vụ kiểm — và đó là trạng thái đúng.

### Kiểm chứng

- `npm run connector:test` — 258 check ở vòng 012 (120 ở vòng này), thêm 19 check E.164: số Việt Nam (di động và cố định), Mỹ, Anh, **Ý giữ số 0**, lối viết `00`, số đã có `+`, và hai trường hợp **từ chối** (không biết quốc gia / quốc gia không nhận ra). Kiểm cả việc `value` không bị đổi khi có `phone_e164`.
- `npm run persist:test` — 63 check: E.164 được lưu đúng, `has_whatsapp` là `null` sau khi connector ghi, view WhatsApp trống khi chưa kiểm, rồi mô phỏng kết quả kiểm → view trả `https://wa.me/17074522800`, và hai ràng buộc mới bị database từ chối thi hành.

---

## 20. Cổng Role và cổng Email thành ràng buộc (07/10/2026)

Hai cổng còn lại của thiết kế chuẩn giờ có chỗ đứng trong dữ liệu. Trước đây cả hai câu hỏi chỉ được suy lại từ chuỗi chức danh ở mỗi chỗ dùng — `TITLE_WORDS` trong `extract.ts`, `search-roles.ts`, rồi tới UI — nên mỗi nơi trả lời một kiểu, và **không có gì để chặn**.

### Cổng Role: `role_kind` trên `decision_makers`

`src/lib/roles.ts` phân loại một lần lúc ghi, lưu vào cột, và mọi chỗ đọc cùng một giá trị.

| Nhóm | Gồm |
| --- | --- |
| **Mua hàng** (qua cổng) | `procurement`, `purchasing`, `sourcing`, `supply_chain` |
| Khác | `quality`, `logistics`, `sales`, `management` |
| Không kết luận | `other` (có chức danh, không khớp nhóm), `unknown` (chưa có chức danh) |

Ba giá trị đầu đúng như thiết kế nêu; `supply_chain` được cộng vào vì ở nhiều công ty thực phẩm người quyết định mua nằm ở bộ phận này.

**Thứ tự ưu tiên là chỗ dễ sai nhất, nên nó được khoá bằng test:** kiểm nhóm cụ thể trước nhóm chung, nếu không thì "Procurement Director" thành `management` và "Sales Director" thành `management`. Một chi tiết nữa: chức danh cụ thể thắng bộ phận ("Sales Manager" ở bộ phận Procurement vẫn là `sales`), nhưng chức danh chung chung thì **không** ("Manager" ở bộ phận Procurement là `procurement`) — đó là lúc bộ phận mới nói lên điều gì.

`other` và `unknown` **không được gộp**: một cái là "có dữ liệu, không dùng được", cái kia là "thiếu dữ liệu". Người đọc cần phân biệt.

### Cổng Email: `email_kind`, và vì sao không đổi tên `identity_match`

Ba nhãn của thiết kế được thêm dưới dạng enum `email_kind`, nhưng **`identity_match` (006) được giữ nguyên** — nó đang chạy ở view, loader và CSV. Hai cột trả lời hai câu khác nhau:

| Câu hỏi | Cột |
| --- | --- |
| Địa chỉ này **của ai**? | `identity_match` — `person` / `department` / `company_general` / `unknown` |
| Địa chỉ này **được công bố thế nào**? | `email_kind` — `published_named` / `published_role_mailbox` / `inferred_unverified` / `unknown` |

Ánh xạ (được viết thành hàm `email_kind_for` trong SQL, và một ràng buộc buộc cột phải khớp với nó):

```
certainty = inferred                      → inferred_unverified
identity_match = person                  → published_named
identity_match = department|company_general → published_role_mailbox
```

Nhãn `inferred_unverified` là nhãn duy nhất bị cổng Email chặn — đúng như thiết kế. Hộp thư bộ phận công bố **không** bị chặn: nó được công bố, không phải đoán.

### Hai cổng, hai view

`contact_role_gate` và `contact_email_gate` **tách khỏi** `contact_export_policy` (006) là cố ý: `contact_export_policy` là luật **xuất** (được ra CSV hay không), cổng là luật **chọn** (có phải đầu mối mua hàng không — có nên gọi không). Cái thứ hai là quyết định của người dùng, không phải của hệ thống (spec §10).

Trong `contact_role_gate`, kênh **không gắn với người nào** tự động qua cổng: đó là đường bộ phận, và thiết kế đã chốt là đi cửa bộ phận trước khi cần tên người.

### Kiểm chứng

- `npm run roles:test` (**33 check**, bộ mới): các ca dễ sai — "Procurement Director" vs "Sales Director" vs "Import Manager", chức danh chung chung + bộ phận cụ thể, tiếng Việt có dấu, `other` ≠ `unknown`, và nhãn hiển thị không mang lời khuyên.
- `npm run persist:test` (**71 check**): chức danh được phân loại lúc ghi (`Procurement Manager` → `procurement`); email cạnh tên người → `published_named`, email bộ phận → `published_role_mailbox`; email tự đoán bị cổng Email chặn; DB từ chối một `email_kind` nói ngược với cách địa chỉ được công bố.
- `npm run db:verify` (9 migration): hàm `email_kind_for` trả đúng ba nhãn; cổng Role đổi kết quả khi chức danh đổi từ `sales` sang `procurement`; kênh không gắn người vẫn qua; email chưa phân loại được thì bị giữ lại kèm lý do; hai view mới vẫn cách ly theo workspace.

---

## 21. Cổng Freshness: đọc lại định kỳ (07/10/2026)

Cổng cuối cùng của thiết kế chuẩn. 005/006 đã có `last_seen_at`, `expires_at` (90 ngày) và lượt dọn dữ liệu hết hạn — nhưng **chưa có lần đọc lại nào**: dữ liệu cũ chỉ được xoá, chưa bao giờ được kiểm lại. Migration 010 và `src/lib/connector/reverify.ts` làm nốt phần đó.

### Ba câu trả lời, không phải hai

| Kết quả | Nghĩa | Hệ quả |
| --- | --- | --- |
| `still_present` | Mở được trang, **vẫn thấy đúng giá trị đó** | Làm mới `last_seen_at`, `expires_at`, và đẩy `verified_at` tiến lên |
| `gone` | Mở được trang, giá trị **không còn ở đó** | Hạn về ngay → rơi khỏi danh sách xuất; mất cờ xác minh; ghi lại lý do |
| `unreachable` | **Không mở được trang** (mạng, 404, robots, đăng nhập) | **Không thay đổi gì** |

**`unreachable` không phải là "không còn".** Một lần mạng lỗi mà hạ kênh của khách hàng xuống là dùng sự cố của mình để nói dối về dữ liệu của họ. Lần chạy sau sẽ thử lại, và hạn vẫn tính theo lần cuối **thực sự** thấy nó.

### Vì sao không có trạng thái "đã đổi"

Việc "giá trị đã đổi" không được đoán trong lúc đọc lại. Lần đọc lại chỉ trả lời **còn hay không còn** — câu hỏi mà nó trả lời chắc được. Nếu trang đổi sang giá trị khác thì giá trị cũ thành `gone`, và connector (chạy theo nhịp riêng) sẽ tìm ra giá trị mới như một kênh mới. Nhờ vậy mỗi lần chạy chỉ có một việc để làm sai, thay vì hai.

So khớp cũng theo loại kênh: số điện thoại so **theo dãy chữ số** (`707-452-2800` và `(707) 452 2800` là cùng một số — nếu so thô thì lần nào cũng báo "không còn"), email so đúng chuỗi, LinkedIn bỏ dấu `/` cuối.

### Chạy thế nào

```bash
npm run reverify:run                        # 90 ngày, 200 kênh
npm run reverify:run -- --days 180 --limit 50
```

hoặc `POST /api/maintenance/reverify` với `{ "days": 90, "limit": 200 }`, kèm `Authorization: Bearer $CRON_SECRET` — cùng bí mật với lượt dọn dữ liệu hết hạn, nên một lịch chạy lo được cả hai.

Hàng đợi (`contact_reverify_queue`) **chỉ** gồm kênh đến từ website công ty, có trang nguồn, chưa bị đánh dấu là chết, còn trong hạn. Dòng đến từ sổ đăng ký hay cơ sở dữ liệu mua không tự đọc lại được bằng cách mở một trang web — chúng tươi theo nhịp của nguồn đó.

### Sổ đọc lại

`contact_reverifications` là sổ **append-only**: mỗi lần đọc lại một dòng, ghi thấy gì, ở trang nào, lúc nào. Không sửa dòng cũ, nên đọc được lịch sử của một kênh. Hai ràng buộc chặn việc nói suông: `still_present` **bắt buộc** có câu chữ chứng minh, `changed` bắt buộc nói giá trị mới là gì.

Dòng dữ liệu **không bị xoá** khi kênh hết hạn — lịch sử là sự thật, chỉ là nó không còn được dùng để liên hệ nữa.

### Kiểm chứng

`npm run reverify:test` — **37 check**, hai phần: (1) so khớp và ba câu trả lời, gồm ca `unreachable` vì HTTP 500 và vì trang đăng nhập; (2) trên Postgres thật (10 migration): hàng đợi chọn đúng kênh (bỏ kênh mua dữ liệu và kênh đã chết), `still_present` làm mới, `gone` hạ kênh khỏi danh sách xuất **nhưng dòng vẫn còn**, `unreachable` không đổi gì, và hai ràng buộc của sổ đọc lại từ chối thi hành.

## 22. Nguồn cấp 2 — bước 3 của thiết kế chuẩn (07/10/2026)

Bước 1 (biết đang đọc website của ai) và bước 2 (đọc thẳng nguồn của công ty) đã có từ trước. Đây là bước 3, và nó có một luật duy nhất: **chỉ chạy khi cần**.

### Thêm một tầng giữa bước 2 và bước 3: sitemap

Trước khi đi ra ngoài, có một nguồn vẫn thuộc về công ty mà hệ thống chưa dùng: **sitemap**. Danh sách đường dẫn đoán trước (`/contact`, `/suppliers`, `/vendor`…) bỏ sót đúng những trang đáng giá nhất, vì trang mua hàng hay đặt tên không đoán được: `/vi/doi-tac-cung-ung`, `/en/partners/become-vendor`, `/supplier-quality-hub`.

Sitemap là **bản đồ công ty tự công bố về website của mình**, nên nó tốt hơn mọi nguồn cấp 2 ở mọi mặt: không cần khoá, không có bên thứ ba phải tin, không thêm lượt gọi nào ra ngoài tên miền. Vì vậy nó được đọc **trong bước 2**, song song với trang chủ (`src/lib/connector/sitemap.ts`).

Giới hạn có chủ ý: chỉ cùng tên miền; chỉ nhận URL khớp từ khoá (supplier/vendor/procurement/sourcing/contact/about/quality/certificat/tender/rfq…); sitemap index thì đọc file con **trước** những đường dẫn gốc còn lại (file con mới là bản đồ thật); trần 3 file; và **đã đọc được một bản đồ dùng được thì dừng**, không thử thêm đường dẫn gốc khác — mỗi lượt thử là một yêu cầu gửi tới máy chủ của họ. Sitemap cũng phải qua `robots.txt` như mọi URL khác.

### Cổng quyết định (`src/lib/connector/gate.ts`)

"Cần" phải kiểm được, không phải cảm giác:

| Tình trạng sau bước 2 | Đi tiếp? |
| --- | --- |
| Đã có kênh thuộc **nhóm mua hàng** (procurement / purchasing / sourcing / supply chain) | **Không** — đã tới đúng cửa |
| Chỉ có `info@`, tổng đài, biểu mẫu liên hệ | **Có** — kênh chung không phải cửa vào phòng mua hàng |
| Chỉ có người ngoài nhóm mua hàng (ví dụ giám đốc kinh doanh) | **Có** — có tên người thì còn tra được chức danh thật |
| Không có kênh nào | **Có** |

Nhóm nghề đọc từ chính chữ đã công bố: chức danh đi kèm, nhãn của kênh, và với email thì cả **local part** (`procurement@` là chữ in trên trang, không phải suy đoán). Hàm này thuần, kiểm được không cần mạng.

### Hai nguồn được cắm

**1. Search API** (tuỳ chọn, `SEARCH_API_KEY` — Serper / Tavily / Brave). Câu truy vấn **luôn** có `site:<tên miền công ty>`, nên phạm vi vẫn là website của họ; search chỉ có nhiệm vụ chỉ đường tới những trang mà sitemap và đường dẫn đoán trước bỏ sót. Kết quả ngoài tên miền bị loại ngay cả khi nhà cung cấp search trả về (đã có hàng rào thứ hai). **Snippet của search không bao giờ là bằng chứng** — bằng chứng vẫn phải là câu chữ trên trang mà chính hệ thống mở ra. Khoá gửi qua header, không nhét vào URL.

**Google và Bing không còn là lựa chọn (kiểm lại 07/10/2026).** Người dùng hỏi có cắm Google/Bing Search API được không. Câu trả lời là không, vì cả hai đã đóng với khách mới:

- **Bing Search API (gồm cả Custom Search) đã bị khai tử ngày 11/08/2025** — Microsoft thông báo toàn bộ instance cũ bị ngừng và không nhận khách mới; thứ thay thế ("Grounding with Bing Search") là một tính năng của Azure AI Agents, không phải search API trả về danh sách URL, nên không cắm vào pipeline này được.
- **Google Programmable Search (Custom Search JSON API) đã đóng với khách mới** và có lịch ngừng hẳn **01/01/2027**; mức giá công bố cho khách cũ là 100 câu/ngày miễn phí rồi 5 USD/1.000 câu, trần 10.000 câu/ngày. Xây vào một API đang chết là tự tạo việc phải đổi lần nữa.

Vì vậy ba nhà cung cấp ở trên là đường còn sống, và **đổi nhà cung cấp không cần sửa code**: `buildSearchRequest` + `parseSearchHits` biết hình dạng request/kết quả của cả ba (Serper: POST + `x-api-key`; Tavily: POST + khoá trong body; Brave: GET + `x-subscription-token`), có test cho từng cái.

**`npm run search:check`** gọi **đúng request mà connector dựng** (cùng hai hàm đó) tới một tên miền công khai để trả lời "khoá có chạy không" bằng phép đo, không bằng niềm tin. Không có khoá: in ra ba nhà cung cấp kèm gói miễn phí và hai dòng cần thêm vào `.env.local`, rồi thoát 0 — vì chạy thiếu bước 3 là trạng thái bình thường. Có khoá mà lỗi (401/403/429/mạng): thoát 1 kèm lý do.

**Khoá Tavily tự nhận ra (07/10/2026).** `resolveProvider` đọc `SEARCH_PROVIDER` trước (chuẩn hoá chữ thường, chỉ nhận ba tên hợp lệ); không có thì suy từ tiền tố khoá — `tvly-` là Tavily, còn lại mặc định serper. Lý do: một khoá Tavily dán vào mà quên `SEARCH_PROVIDER` sẽ bị gửi tới `google.serper.dev`, và cái sai đó dễ bị đọc thành "khoá hỏng". Lệnh kiểm còn **cảnh báo** khi người dùng đặt rõ một nhà cung cấp khác với tiền tố khoá.

**Tavily không lọc theo `site:`.** Toán tử `site:` là quy ước của Google/Brave; Tavily lọc tên miền bằng tham số riêng. Vì vậy request gửi tới Tavily mang theo `include_domains: [<tên miền công ty>]` bên cạnh `site:` trong câu truy vấn — luật "chỉ trong tên miền của họ" được nói thêm một lần nữa ở phía nhà cung cấp, còn hàng rào thứ hai trong `parseSearchHits` không đổi.

**HTTP 200 chưa phải bằng chứng đã nối được.** Một nhà cung cấp có thể trả 200 kèm thân lỗi (sai khoá, sai endpoint), và khi đó mảng kết quả rỗng rất dễ bị đọc thành "nối được nhưng không có kết quả". `hasSearchShape` bắt đúng ca đó: không có mảng kết quả đúng hình dạng (`organic` / `results` / `web.results`) thì kết luận là **chưa nối được**, kèm thân phản hồi nguyên văn.

**Đã kiểm bằng khoá thật (07/10/2026):** một khoá Tavily trong `.env.local` cho ra `HTTP 200`, đúng hình dạng `results: [...]`, 10 dòng kết quả. Trước đó lệnh kiểm in ra một chữ `undefined` — không phải lỗi khoá mà là lỗi gom module trên Windows (`spawnSync("npx", …)` không spawn được `npx.cmd`; sau khi thất bại, `build.stderr` và `build.stdout` đều `undefined`). Đã sửa bằng esbuild API chạy trong cùng tiến trình, và ghi lại vì bài học lặp lại được: **một lệnh chết trước khi gọi mạng vẫn có thể trông như đã gọi mạng.**

**Luật đọc biến môi trường:** mọi lệnh (`connector:run`, `search:check`, `whatsapp:check`, `reverify:run`, `retention:run`) đọc `.env.local` trước rồi mới tới biến môi trường shell — một file, một cách đọc. `connector:run` in ra khoá được lấy từ đâu, và **cảnh báo khi bước 3 không có khoá nào**, để "chạy xanh" không bị nhầm với "đã bật nguồn cấp 2".

Gói miễn phí để bắt đầu, theo công bố của chính các nhà cung cấp (09/2026): Serper ~2.500 câu thử rồi ~1 USD/1.000 câu; Tavily 1.000 credit/tháng; Brave 5 USD credit/tháng (~1.000 câu, tức về sau 5 USD/1.000 câu). **Serper rẻ nhất nhưng không phải index độc lập** — nó trả kết quả Google; Brave có index riêng. Với cùng một lớp chỉ-dùng-URL, cả ba đều đủ.


**2. Sổ đăng ký doanh nghiệp** — trả lời câu hỏi của bước 1: *có đúng công ty này không*.

| Sổ | Quốc gia | Lấy được | Điều kiện |
| --- | --- | --- | --- |
| UK Companies House | Anh | tên pháp nhân, số đăng ký, tình trạng, ngày thành lập, mã SIC, tên cũ, **người đương nhiệm** | API miễn phí; dữ liệu mở theo OGL, được dùng thương mại **khi ghi nguồn** (nhãn nguồn luôn được ghi) |
| US SEC EDGAR | Mỹ | tên pháp nhân, mã CIK, ngành theo SIC, tên cũ, hồ sơ gần nhất | hồ sơ công khai; **bắt buộc User-Agent kèm cách liên hệ** — thiếu thì 403 (xem ghi chú dưới) |

Hai điều cố ý:

- **Sổ đăng ký không tạo ra kênh liên hệ nào.** Sổ không có email, không có điện thoại. Vì vậy kết quả của sổ đi vào một khối riêng (`ConnectorResult.registry`) — tên người kèm chức danh và nguồn, không bao giờ thành một dòng trong danh sách kênh. (`test-connector` kiểm đúng điều này.)
- **EDGAR không trả về danh sách người.** Tên và chức danh người ký nằm *bên trong* từng hồ sơ; đọc ra là việc nặng hơn và dễ gán nhầm một cái tên cho một công ty. Thà thiếu.
- Quốc gia chưa có sổ miễn phí (trong đó có **Việt Nam**) thì hệ thống nói thẳng là chưa có sổ, **không** lấy nguồn khác thay thế. Sổ Anh/Mỹ chỉ được tra khi quốc gia của công ty là Anh/Mỹ.

### Không có khoá thì không có gì xảy ra

Bước 3 là tuỳ chọn. Không có `SEARCH_API_KEY` thì phần search không chạy; không có `COMPANIES_HOUSE_API_KEY` thì không tra sổ Anh; không có tên pháp nhân thì không tra sổ nào. Mỗi lần như vậy, `ConnectorResult.secondary.reason` nói rõ vì sao — người kiểm đọc được mà không phải đoán. `secondary: false` tắt hẳn. **Không có khoá nào đi vào mã nguồn**, tất cả đọc từ biến môi trường phía server.

### Chạy thế nào

```bash
npm run connector:run acmespices.co.uk -- --company "Acme Spices Ltd" --country "United Kingdom"
npm run connector:run acmespices.co.uk -- --no-secondary      # chỉ đọc website công ty
```

Với `SEARCH_API_KEY` / `SEARCH_PROVIDER` / `COMPANIES_HOUSE_API_KEY` đặt trong môi trường. `/api/connector` cũng truyền các khoá này (đọc từ `process.env`, **không** nhận từ body request) và trả thêm `registry` + `secondary` trong JSON.

### Kiểm chứng

`npm run connector:test` — **258 check** ở vòng 012 (182 ở vòng này, 120 trước đó): sitemap (kể cả sitemap index, trần file, và chốt robots), cổng quyết định, search API (chỉ tên miền, `site:`, khoá trong header, không gọi mạng khi thiếu khoá, hình dạng request/kết quả của cả ba nhà cung cấp, kết quả hỏng bị bỏ), hai sổ đăng ký (chỉ người đương nhiệm, giữ nguyên tên như sổ ghi, không sinh kênh liên hệ, thiếu khoá thì không gọi mạng), và một lần chạy đầu-cuối trên website mỏng: bước 2 chỉ ra `info@` → cổng mở → search chỉ đường tới `/suppliers/register` → đọc thật trang đó → có `procurement@` kèm câu chữ trên trang, trong khi đường dẫn bị robots.txt chặn và kết quả ngoài tên miền **không** được tải.

### Kèm theo: `info@` không còn bị xếp là email bộ phận

Trước vòng này `DEPARTMENT_LOCALS` gộp cả hộp thư chung (`info`, `hello`, `contact`, `sales`…) lẫn hộp thư bộ phận (`procurement`, `accounts`, `hr`…) vào một nhóm, nên `info@` hiện lên ở khối "Email bộ phận". Đã tách thành hai nhóm: hộp thư chung của công ty (`GENERAL_LOCALS`) và hộp thư bộ phận. Chưa rõ thì mặc định là **hộp thư chung** — hướng an toàn, không gán một hộp thư chung cho một bộ phận nào khi trang không nói vậy.

### Còn lại của bước 3

- **Hội chợ / hiệp hội ngành**: chưa cắm, và sẽ chỉ cắm khi có nguồn thật để đọc (xem `docs/backlog.md`).
- **Kết quả sổ đăng ký chưa được lưu vào DB**: hiện đi kèm JSON trả về và hiện trên CLI, chưa có bảng/cột để hiển thị trong danh sách buyer. Việc này cần migration 011 — ghi trong `docs/backlog.md`.

## 23. Đối chiếu pháp nhân vào database và lên danh sách buyer (07/10/2026)

Bước 1 của thiết kế chuẩn là **Resolve Entity & Domain**: biết chắc đang đọc website của ai. §22 đã cắm phần tra sổ đăng ký, nhưng kết quả chỉ nằm trong JSON trả về — không có chỗ trong database, nên người dùng không thấy được, và lần chạy sau không đọc lại được. Migration 011 và khối "Đối chiếu pháp nhân" trên danh sách buyer làm nốt phần đó.

### Ba bảng, ba việc

| Đối tượng | Việc |
| --- | --- |
| `buyer_registry_matches` | Một lần đối chiếu: sổ nào, trang nguồn, tên đã dùng để tra, tên pháp nhân, số đăng ký, tình trạng, ngày thành lập, ngành (SIC), tên cũ, thời điểm tra |
| `buyer_registry_officers` | Người **còn đương nhiệm** theo sổ: tên, chức danh nguyên văn, ngày bổ nhiệm |
| `buyer_registry_latest` | View: lần đối chiếu mới nhất của mỗi buyer, kèm số người — để danh sách đọc thẳng, không phải tự chọn |

### Bốn quyết định, và lý do

**1. Sổ đăng ký không bao giờ tạo ra kênh liên hệ.** Sổ công bố tên pháp nhân, số đăng ký, tình trạng và người đương nhiệm — **không** có email, không có điện thoại. Vì vậy kết quả nằm ở bảng riêng, không đi vào `contact_channels`, và bảng người đương nhiệm **không có cột liên hệ nào**: một cột email ở đó là mở đường cho việc bịa. Người đương nhiệm theo sổ là người của pháp nhân, không phải đầu mối của phòng mua hàng — hai câu hỏi khác nhau.

**2. Không ghi thứ không tìm thấy.** Không có dòng nào cho "đã tra nhưng không có kết quả". Không tìm thấy thì không có gì để nói, và §9 đã chốt: thứ không tìm thấy không bao giờ được hiển thị — kể cả dưới dạng một dòng trống.

**3. Chạy lại không nhân đôi, nhưng lịch sử không mất.** Cùng sổ, cùng pháp nhân, cùng danh sách người → chỉ làm mới `checked_at` và trang nguồn. Kết quả **khác** (tình trạng chuyển sang `liquidation`, một giám đốc rời đi) → thêm dòng mới, dòng cũ vẫn nằm đó. Đọc lại là biết sổ đã đổi lúc nào. Giống hệt cách `contact_channels` xử lý lần chạy lặp.

**4. Một hàm ghi, không phải insert thẳng.** `record_registry_match(...)` (service-role only): suy `organization_id` từ chính `buyer_profiles` — người gọi không thể ghi lệch tenant; tra `market_sources` theo sổ nên nguyên tắc "không nguồn nào được lưu nếu chưa có dòng trong `market_sources`" (005) vẫn giữ ở tầng DB; và từ chối dòng thiếu trang nguồn, thiếu nhãn cơ quan, thiếu tên đã dùng để tra, hoặc không nêu được tên pháp nhân lẫn số đăng ký. Người thiếu tên trong danh sách bị **bỏ qua** thay vì làm hỏng cả lần ghi.

### Ngày tháng giữ nguyên chuỗi

`incorporated_on` là `text`, không phải `date`. Sổ trả về ngày thiếu (`1998-04`) và không phải lúc nào cũng có ngày; ép sang `date` là tự thêm một ngày không ai công bố. Đây là cùng một nguyên tắc với `value` của số điện thoại: giữ đúng thứ nguồn đưa.

### Trên danh sách buyer

Khối **"Đối chiếu pháp nhân"** nằm trong dòng mở rộng của công ty, phía trên danh sách kênh — nêu sổ nào, tra ngày nào, nguồn, tên pháp nhân, số đăng ký, tình trạng, thành lập, ngành, tên cũ, **tên đã dùng để tra**, và người đương nhiệm kèm chức danh. Dòng cuối của khối nói thẳng: *"Sổ đăng ký không công bố email hay điện thoại."* — để không ai đọc khối này thành danh sách liên hệ.

CSV **không đổi**: vẫn 15 cột đã chốt. Đối chiếu pháp nhân là thông tin định danh công ty, không phải một dòng liên hệ, và trộn nó vào CSV là làm hỏng hợp đồng cột đang chạy với người dùng.

Chưa chạy migration 011, hoặc chưa tra sổ lần nào → hai truy vấn trả rỗng, khối không hiện, danh sách chạy y như trước. Danh sách mẫu có một công ty **hư cấu** (`Thames Valley Foods Ltd.`) mang khối này, để thấy giao diện ngay cả khi chưa có khoá API: gán một số đăng ký giả cho một công ty có thật là bịa một dữ kiện về pháp nhân đó.

### Kiểm chứng

- `npm run persist:test` — **108 check** ở vòng 011, nay **144 check** (xem §24): batch mang kết quả sổ, chặn dữ liệu không phải lần đối chiếu; ghi vào Postgres thật (PGlite, 12 migration), chống trùng, thêm dòng khi kết quả khác, `organization_id` suy từ buyer, người thiếu tên bị bỏ, ranh giới tenant, người dùng thường không ghi thẳng được.
- `npm run db:verify` — 12 migration (mục 012 ở §24), thêm mục 011: hàm ghi, chống trùng, view latest, năm kiểu dữ liệu sai bị từ chối, RLS hai chiều, và "bảng người đương nhiệm không có cột liên hệ nào".
- `npm run export:test` — **54 check** (trước 43) ở vòng 011, nay **58 check** (§24): ghép lần đối chiếu với người của nó, không ghép lẫn lần khác, chưa tra sổ thì không có khối, CSV vẫn 15 cột và **không** lẫn dữ liệu sổ.

## 24. Dữ liệu hải quan: vai trên tờ khai, luồng Resolve, và lịch sử nhập khẩu trên báo cáo (07/10/2026)

**Người yêu cầu:** người dùng, 07/10/2026 — chọn hướng "Dữ liệu hải quan" với ba việc: xử lý dữ liệu vận đơn/tờ khai để xác định `shipper_role`, khởi tạo luồng Resolve tên pháp nhân từ tờ khai sang `buyer_profiles`, và hiển thị tóm tắt lịch sử/vai trò nhập khẩu lên giao diện Báo cáo Buyer.

### Vì sao tách thành ba tầng

Một tờ khai nói rất ít về liên hệ và rất nhiều về quan hệ. Vận đơn công bố **không có email, không có điện thoại** — nên cả ba bảng mới không có một cột liên hệ nào, và `db:verify` khẳng định điều đó thay vì tin vào lời hứa trong tài liệu. Thứ tờ khai cho là: bên nào tham gia, **với vai gì**, trên lô hàng nào.

Vì vậy dữ liệu được chia làm ba tầng, và tầng nào cũng có chỗ của mình:

| Tầng | Ở đâu | Nói gì | Không được làm gì |
| --- | --- | --- | --- |
| **Bản in** | `customs_records`, `customs_record_parties` | đúng thứ tờ khai ghi: tên, quốc gia, địa chỉ, mã HS, số vận đơn, và cột nguồn (`source_column`) | không viết lại tên, không sửa quốc gia |
| **Suy ra** | `customs_side_for(role)`, `name_normalized`, `country_iso2` | bên nào của giao dịch; tên đã chuẩn hoá để tra; mã ISO-2 để đối chiếu | không thay thế bản in, không tự quyết định ai là khách hàng |
| **Quyết định** | `customs_entity_matches` | bên này ứng với hồ sơ khách hàng nào, do ai, bằng bằng chứng gì | không bao giờ biến bên gửi hàng thành khách hàng |

### `shipper_role` — vai đọc từ tên cột, không đoán từ vị trí

Vai nằm ở **tên cột** của file: `Shipper Name`, `Consignee`, `Importer`, `Buyer`, `Notify Party`. `src/lib/customs/columns.ts` là bảng ánh xạ tên cột → trường, và nó in ra bảng đối chiếu trước khi ghi: cột nào nhận ra, vào trường nào, cột nào bị bỏ qua. Hai luật cứng:

1. **File không có cột vai thì không nhập được.** Không suy vai từ thứ tự cột hay vị trí trong dòng.
2. **Cột của một bên phải là cột của bên đó.** `Consignee Country` là quốc gia của bên nhận hàng, không bao giờ là quốc gia xuất xứ; `Shipper Email` bị bỏ qua (và vận đơn công bố cũng không có cột đó) chứ không được ghi thành kênh.

File gọi bên mua là `Buyer` thì mình ghi lại **nguyên văn tên cột** trong `source_column` và xếp vai theo nghĩa hẹp nhất mà file nói (`importer`) — người đọc sau vẫn truy được vì sao bên đó được xếp vai ấy.

Vai → bên giao dịch nằm ở một hàm bất biến trong DB:

```sql
customs_side_for('importer')      = 'importer_side'
customs_side_for('consignee')     = 'importer_side'
customs_side_for('shipper')       = 'exporter_side'
customs_side_for('notify_party')  = 'unknown'
customs_side_for('other')         = 'unknown'
```

`notify_party` cố ý để `unknown`. Bên được thông báo có thể là hãng tàu, ngân hàng hoặc đại lý hải quan — suy ra "đây là bên mua" từ đó là bịa. Bảng này được kiểm ở **cả hai phía**: `db:verify` gọi hàm SQL, `customs:test` gọi bản TypeScript `customsSideFor()` trong `src/lib/customs/normalize.ts`, và cả hai đối chiếu với cùng một bảng kỳ vọng. Lệch nhau là test đỏ.

### Luồng Resolve — từ tờ khai sang `buyer_profiles`

Hàng đợi là view `customs_resolution_queue`: **chỉ bên nhận hàng** (`importer_side`) chưa nối với hồ sơ nào, kèm bên đối tác trên cùng tờ khai để người xem có bối cảnh. Bên gửi hàng không vào hàng đợi — đó là nhà cung cấp, không phải việc cần quyết.

Ba đường ra, và chúng khác nhau:

- **`link_customs_party`** — nối với một hồ sơ đã có. Từ chối mọi bên không phải importer-side; từ chối hồ sơ thuộc workspace khác; và **ghi luôn lô hàng vào `trade_signals`** để "đã nối" bao giờ cũng đi kèm "có lịch sử". Nhà cung cấp của lô lấy từ chính bên gửi hàng trên tờ khai. Nối lại cùng một bên thì ghi đè quyết định, không thêm dòng, không nhân đôi lô.
- **`mark_customs_party`** — ghi `review` (có ứng viên, chờ người quyết) hoặc `unmatched` (không có gì để chọn). Hai trạng thái này khác nhau và không được trộn: "chưa chọn" và "không có gì để chọn" là hai câu trả lời khác nhau. Hàm này **không** nối được — nối là việc của hàm kia.
- **`create_buyer_from_customs_party`** — chỉ chạy khi người dùng chọn. Thiếu quốc gia trên tờ khai thì từ chối (không biết đang nói về ai ở đâu thì không tạo hồ sơ); có đúng một hồ sơ cùng tên thì nối vào (`exact_name`, 80); có nhiều hơn một thì chuyển sang `review` (30) chứ không đoán; không có thì tạo hồ sơ mới (`created_from_customs`, 70) với tên và quốc gia **đúng như tờ khai**, không tên miền, không địa chỉ, không kênh liên hệ nào.

Ràng buộc cuối cùng nằm ở DB, không ở tài liệu:

```sql
constraint customs_entity_matches_side_can_link
  check (side = 'importer_side' or buyer_profile_id is null)
```

Bên gửi hàng không thể thành khách hàng kể cả khi ai đó `insert` thẳng vào bảng. `db:verify` thử đúng đường đó để chắc rằng ràng buộc còn sống.

**Gợi ý thì không phải quyết định.** `src/lib/customs/resolve.ts` xếp hạng ứng viên theo *bằng chứng*: trùng tên miền website công bố (96) > trùng tên khít + cùng quốc gia (88) > trùng tên khít (80) > tên gần giống (40–70), mỗi mức kèm lý do đọc được. Khác quốc gia hay khác tên miền được nói ra như **lý do chống nối**, không bị giấu. Hàm trả về mảng rỗng cho bên gửi hàng, và không đề xuất gì khi không có ứng viên đủ gần — im lặng đúng chỗ.

### Nhập file

`src/lib/customs/import.ts` đọc CSV (RFC 4180: ô bọc nháy, dấu phẩy và xuống dòng trong ô, BOM, CRLF), dựng payload theo bảng ánh xạ cột, rồi ghi qua bốn hàm RPC. Những gì **không** được làm:

- **Không đoán ngày.** `05/03/2026` là ngày 5 tháng 3 hay 3 tháng 5? Không tự chọn: ngày để trống, dòng vẫn vào, và bộ đếm `ambiguousDates` báo lại để người nhập chọn thứ tự ngày/tháng rồi nhập lại. `13/05/2026` thì tự biết. Một ngày sai trong báo cáo lịch sử nhập khẩu là một khẳng định sai về hoạt động của công ty người ta.
- **Không tạo bản sao.** Khoá là (workspace, nguồn, số vận đơn). Nhập lại cùng file: `replayed = 2`, không thêm tờ khai, không thêm bên, không thêm lô hàng, và quyết định đã ra vẫn nguyên.
- **Không ghi khi thiếu nguồn.** Chưa có dòng trong `market_sources` thì hàm ghi từ chối và thông báo của DB được trả nguyên văn cho người nhập đọc.
- **Không im lặng.** Báo cáo của lần nhập nói rõ: số dòng, số tờ khai ghi mới, số nhập lại, số dòng thiếu số vận đơn, số dòng lặp trong file, số dòng có ngày mơ hồ, số lô không có bên nhận hàng, và từng lỗi kèm số vận đơn.

### Trên giao diện

- **Báo cáo Buyer** (khối trong drawer) và **dòng mở rộng của danh sách buyer**: khối **"Lịch sử nhập khẩu"** — chip vai (kèm `×số lô` và lần cuối), khoảng thời gian, mã HS6, hàng hoá, nhà cung cấp + nước xuất hàng, nguồn, cách nối — và dòng cuối nói thẳng: *"Vận đơn công bố không có email hay điện thoại — khối này chỉ nói công ty đã nhập gì, từ đâu, khi nào."*
- **Hàng đợi Resolve** ở đầu trang buyer: từng bên nhận hàng chưa nối, ứng viên kèm điểm và lý do, nút nối / tạo hồ sơ mới / chờ xem sau / chưa có ứng viên. Ghi qua `POST /api/customs`: đọc bên đó bằng **phiên của người dùng trước** (RLS quyết định — không đọc được nghĩa là không thuộc workspace này), rồi mới ghi bằng service role. `organization_id` không bao giờ lấy từ request body.

Mã HS: bảng giữ **nguyên bản in** (`0801.32.00`), view tóm tắt gom về **HS6** (`080132`) để đếm và gom nhóm — hai bản, hai việc, giống `value` / `phone_e164`.

### Về chuyện "hiển thị số 0"

Chưa nối tờ khai nào thì **không hiện khối nào** — không hiện "0 lô hàng". Một công ty chưa từng được đối chiếu với dữ liệu hải quan và một công ty thật sự không nhập gì là hai chuyện khác nhau, và giao diện không được nói sai chuyện nào.

### Việc còn lại trước khi nhập dữ liệu thật

`market_sources` cần một dòng cho khoá nguồn hải quan (ví dụ `customs_bol`) — 012 giữ nguyên luật của 005: thiếu khoá thì hàm ghi từ chối. Cấu trúc file thật của nhà cung cấp dữ liệu vẫn cần người dùng xác nhận trước lần nhập đầu; bảng ánh xạ cột đã in ra để đối chiếu, nên lệch tên cột sẽ lộ ra ngay ở bước đó chứ không âm thầm vào sai chỗ.

### Kiểm chứng

- `npm run customs:test` — **105 check** (bộ mới): đọc CSV (ô bọc nháy, dấu phẩy, xuống dòng, BOM, CRLF), bảng ánh xạ cột, chuẩn hoá tên/số/ngày, dựng payload, đếm đúng thứ bị bỏ, xếp hạng ứng viên, và bảng vai → bên.
- `npm run persist:test` — **144 check** (trước vòng này 108): toàn bộ đường nhập chạy trên Postgres thật (PGlite, 12 migration) — hai tờ khai, bên được suy side bằng trigger, nối → `trade_signals`, view tóm tắt, hàng đợi, tạo hồ sơ mới, nhập lại không nhân đôi, nguồn chưa đăng ký thì từ chối.
- `npm run db:verify` — 12 migration; mục 012 kiểm hàm ghi, chống trùng, ba thông báo từ chối, ràng buộc `side_can_link` (thử cả đường ghi thẳng), RLS hai chiều (thành viên đọc được, workspace khác không thấy gì, thành viên không ghi thẳng được), và "không bảng nào có cột liên hệ".
- `npm run export:test` — **58 check** (trước 54): khối hải quan theo đúng buyer, chưa nối thì không có khối, CSV vẫn **đúng 15 cột** và không mang theo tên nhà cung cấp hay mã HS.
