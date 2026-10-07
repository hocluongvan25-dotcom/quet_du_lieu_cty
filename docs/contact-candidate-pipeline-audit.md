# Đối chiếu: luồng Contact Buyer hiện tại ↔ Thiết kế Chuẩn

Ngày kiểm: 06/10/2026. Người kiểm: đối chiếu trực tiếp schema + code trong repo, không đọc từ trí nhớ.
Mọi dòng dưới đây ghi kèm `file:dòng` để tự kiểm lại.

**Cập nhật 07/10/2026 — việc #1, #2, #3 và #4 ở mục E đã xong.** Tầng ghi kết quả connector vào database đã được viết (`src/lib/connector/persist.ts`), nối vào `POST /api/connector`, và kiểm bằng `npm run persist:test` (46 check, ghi vào Postgres thật rồi đọc lại qua chính view của ứng dụng). Chi tiết: spec §17. Việc #2 (siết bằng chứng ở tầng DB) cũng xong trong cùng ngày — migration 007, spec §18. Việc #3 (enum `role_kind` / `email_kind`) cũng xong — spec §20. Việc #4 (job re-verify) cũng xong — spec §21. Còn mục #5 (nguồn cấp 2) và #6 (dữ liệu hải quan).

## Trả lời ngắn

| Câu hỏi | Trả lời |
| --- | --- |
| **1. Code đã chạy đúng luồng 5 bước + 5 cổng chưa?** | **Chưa.** Bước 2 (nguồn cấp 1) và bước 4 (trích xuất có bằng chứng) **đã có**; 5 cổng mới có **4 cổng ở dạng một phần**; bước 1 (resolve pháp nhân từ tờ khai hải quan) và bước 3 (nguồn cấp 2) **chưa có**; và **kết quả connector chưa được ghi vào database** nên pipeline chưa khép kín — **chỗ này đã sửa 07/10/2026**, xem cập nhật ở đầu tài liệu và spec §17. |
| **2. `contact_candidates` đã lưu `evidence_quote` và `source_urls` chưa?** | **Chưa — và đây là chỗ thiết kế đang lệch model.** Bảng `contact_candidates` **không có** hai cột đó; nó có `pattern_used` + `inference_basis` (bắt buộc khác rỗng). Bằng chứng (`source_url` + `evidence_snippet`) nằm ở bảng **`contact_channels`** — lớp "kênh quan sát được". Quan trọng hơn: **chưa có dòng code nào trong `src/` ghi vào `contact_candidates`** — chỉ migration và test SQL nhắc tới nó. |

---

## A. Luồng 5 bước

| # | Bước theo thiết kế | Trạng thái | Bằng chứng / thiếu gì |
| --- | --- | --- | --- |
| 1 | **Resolve Entity & Domain** từ tên/địa chỉ trên tờ khai hải quan | **Chưa có** | Chưa cắm dữ liệu hải quan nên không có nguồn để resolve. Hiện connector nhận **tên miền do người dùng đưa** (`src/app/api/connector/route.ts:44`), chuẩn hoá (`src/lib/connector/discover.ts:41` `normalizeSeed`). Chống lẫn công ty trùng tên *trong phạm vi một tên miền* thì có: mọi link/giá trị khác registrable domain đều bị loại (`discover.ts:78`, `extract.ts:174`). Bảng `buyer_profiles` đã có chỗ cho `legal_name` + `domain` + `unique (organization_id, domain)` (`supabase/migrations/005_buyer_discovery.sql:151`) nhưng chưa ai ghi vào. |
| 2 | **Crawl nguồn cấp 1**: procurement, purchasing, sourcing, vendor registration, PDF quy định | **Đã có** | Đường dẫn cố định gồm cả nhóm nhà cung cấp: `/suppliers`, `/vendor`, `/procurement`, `/purchasing`, `/sourcing`, `/become-a-supplier`, `/supplier-registration`… (`src/lib/connector/discover.ts` `WELL_KNOWN_PATHS`), cộng điểm theo từ khoá link (`discover.ts:46`), đọc thêm **PDF cùng tên miền** (`src/lib/connector/pdf.ts`, `discover.ts` `DOCUMENT_KEYWORDS`). Tôn trọng robots.txt, chỉ cùng tên miền, có chốt SSRF. |
| 3 | **Crawl nguồn cấp 2** nếu nguồn 1 thiếu: Search API `site:domain`, sổ đăng ký (Companies House/SEC), B2B/trade show directory | **Chưa có** | Không có mã nào gọi search API hay đọc sổ đăng ký. Spec §14 liệt kê các lớp này là "chưa cắm". |
| 4 | **Trích xuất AI, schema cứng, bắt buộc `evidence_quote` + `source_urls`, không đoán pattern** | **Một phần — đúng tinh thần, khác cơ chế** | Hiện là **rule + ngữ cảnh**, chưa phải AI, và **không có schema cứng** để validate. Nhưng phần cốt lõi thì đã có và mạnh hơn cả mong đợi: mỗi kênh mang `sourceUrl` + `evidenceSnippet` (nguyên văn câu chứa giá trị) — `src/lib/connector/types.ts:16`, `extract.ts` `push({ … evidenceSnippet: clip(lines[…]) })`. **Không bao giờ sinh email theo pattern**: chỉ regex trên chữ có thật (`extract.ts` `EMAIL_RE`), loại `hero@2x.png`, loại tên miền rác, không tự thêm mã quốc gia cho số điện thoại. Có test khẳng định điều này (`scripts/test-connector.mjs`). |
| 5 | **5 cổng kiểm soát** | **Một phần** | Xem mục B. |

## B. Năm cổng

| Cổng | Trạng thái | Bằng chứng / thiếu gì |
| --- | --- | --- |
| **Entity Gate** (đúng pháp nhân?) | **Một phần** | Có: mọi giá trị phải thuộc đúng registrable domain (`extract.ts:174`), email lạ tên miền bị ghi vào "đã loại trừ" kèm lý do (`extract.ts:340`). Chưa có: đối chiếu pháp nhân với sổ đăng ký/hải quan (chưa có nguồn). |
| **Role Gate** (đúng chức danh mua hàng?) | **Một phần** | Có: nhận diện email bộ phận theo local part (`extract.ts` `DEPARTMENT_LOCALS` gồm `procurement`, `purchasing`, `sourcing`, `suppliers`, `vendor`), nhận tên + chức danh đứng cạnh giá trị (`extract.ts` `TITLE_WORDS` gồm `Buyer`, `Purchasing Manager`, `Procurement Manager`, `Category Manager`). Chưa có: cổng chặn — hiện tại thông tin vẫn được lưu dù chức danh không phải mua hàng; chưa có enum `role_kind` để phân biệt. |
| **Email Gate** (`published_named` / `published_role_mailbox`, loại `inferred_unverified`) | **Một phần** | Có: connector **chỉ** trả về email thấy nguyên văn; `inferred` không được sinh ra ở tầng này. Chưa có: ba nhãn `published_named` / `published_role_mailbox` / `inferred_unverified` **không tồn tại ở đâu trong repo** (đã grep cả `supabase/`, `src/`, `scripts/`, `docs/`). Gần nhất là `identity_match` (`person` / `department` / `company_general` / `unknown`) + `certainty` (`confirmed` / `probable` / `inferred`) trong `supabase/migrations/006:38` và `:44`. |
| **Domain Gate** (khớp domain công ty?) | **Đã có** | `registrableDomain()` so khớp ở cả lúc chọn trang và lúc tách giá trị; `co.nz`/`com.vn`… được xử lý như tên miền hai tầng (`src/lib/connector/html.ts`). Ngoài ra DB còn ràng buộc: một giá trị `confirmed` **buộc phải có** `source_url` (`005:255`). |
| **Freshness Gate** (`verified_at`, re-check 90–180 ngày) | **Một phần** | Có cột: `contact_channels.verified_at`, `last_seen_at`, `expires_at` mặc định **90 ngày** (`005:244`, `005:253`); candidate hết hạn **30 ngày** (`006:94`). Chưa có: **job đọc lại để re-verify** — hiện chỉ có sweep xoá theo hạn (`006:345`) chứ không có lần kiểm tra thứ hai nào ghi `verified_at`. |

## C. Ba trạng thái đầu ra

Thiết kế dùng 3 trạng thái; hệ thống đang dùng 2 trục (quan sát được ↔ giả thuyết) + một view quyết định. Ánh xạ:

| Thiết kế | Tương đương trong hệ thống hiện tại |
| --- | --- |
| **Verified Contact** | `contact_channels` với `certainty = 'confirmed'` + `source_url` (DB bắt buộc), `is_verified = true` khi người/sổ đăng ký xác nhận. Xuất được khi `contact_export_policy.blocked_reason is null` (`006:166`). |
| **Public Lead / Human Review** | `contact_candidates` (`status = 'proposed'`/`'queued'`, `pattern_used` + `inference_basis`) và kênh có `blocked_reason` thuộc `identity_unconfirmed` / `deliverability_unchecked` / `manual_contact_only` — `exportable = true` nhưng **không** `outreach_eligible`; UI phải nói rõ lý do. |
| **No Contact Found** | Không có dòng nào. Report trả về kênh chung + biểu mẫu liên hệ của công ty (`extract.ts` `type: "form"`) và `buyer_routes` (vendor registration / supplier portal / RFQ — `006:55`). Theo yêu cầu của bạn, danh sách "không tìm thấy" **không hiển thị** cho người dùng, chỉ ghi nội bộ trong `ConnectorResult.notes`. |

## D. Chỗ lệch lớn nhất: chưa khép kín vòng lưu dữ liệu — **đã xử lý 07/10/2026**

`POST /api/connector` chạy xong trả JSON và tự khai `persisted: false` (`src/app/api/connector/route.ts:78`). Không có `insert` nào vào `contact_channels`, `contact_candidates`, `decision_makers` hay `buyer_profiles` — trong toàn bộ `src/` chỉ có 3 chỗ ghi database: `company_reports`, `source_evidence` (`src/app/api/research/route.ts:196,204`) và `organization_members` (`src/app/api/team/invite/route.ts:103`).

Nghĩa là: **trích xuất thì có bằng chứng, nhưng chưa có gì lưu bằng chứng ấy.** Đây là việc lớn nhất còn thiếu, và nó đứng trước cả 5 cổng — vì cổng là quy tắc trên dữ liệu đã lưu.

**Tình trạng sau khi sửa:** `/api/connector` ghi kết quả vào `buyer_profiles` / `decision_makers` / `contact_channels` / `buyer_routes` khi có phiên đăng nhập + `country`, trả `persisted` kèm số dòng và lý do khi không ghi được. `contact_candidates` vẫn trống sau mỗi lần ghi (connector không đoán email theo pattern).

## E. Cần bù, theo thứ tự nên làm

1. ~~**Ghi kết quả connector vào DB**~~ — **xong 07/10/2026** (`src/lib/connector/persist.ts`, spec §17, `npm run persist:test`). Việc này gồm: upsert `buyer_profiles` theo `domain`, ghi `contact_channels` (`value`, `channel_type`, `identity_match`, `certainty`, `source_url`, `evidence_snippet`, `discovered_by = 'web_research_agent'`), ghi người vào `decision_makers`, ghi form/vendor registration vào `buyer_routes`. Ghi kèm `report.requirements` đã có.
2. ~~**Siết bằng chứng ở tầng DB**~~ — **xong 07/10/2026** (migration `007_evidence_is_required.sql`, spec §18, 7 check mới trong `npm run db:verify`). Nội dung: hiện `evidence_snippet` còn cho phép NULL; nếu muốn đúng thiết kế "bắt buộc evidence" thì thêm ràng buộc `certainty = 'confirmed' ⇒ evidence_snippet khác rỗng` (source_url đã bắt buộc rồi).
3. ~~**Cổng Role + Email thành cổng thật**~~ — **xong 07/10/2026** (migration `009_role_and_email_gates.sql`, spec §20, `npm run roles:test` 33 check). Nội dung: thêm enum `role_kind` (procurement/purchasing/sourcing/sales/other) và `email_kind` (`published_named` / `published_role_mailbox` / `inferred_unverified`) để cổng có thứ để chặn, thay vì suy từ local part mỗi lần.
4. ~~**Job re-verify 90–180 ngày**~~ — **xong 07/10/2026** (migration `010_reverification.sql`, `src/lib/connector/reverify.ts`, spec §21, `npm run reverify:test` 37 check). Nội dung: đọc lại đúng nguồn cũ, cập nhật `verified_at` / `last_seen_at`, ghi thay đổi; hết hạn thì rơi khỏi view export.
5. ~~**Nguồn cấp 2**: search API `site:domain`, Companies House/SEC, trade show directory~~ — **xong phần chính 07/10/2026** (spec §22, `src/lib/connector/secondary.ts` + `sitemap.ts` + `gate.ts`, `npm run connector:test` 182 check). Đã cắm: sitemap (thêm vào bước 2), search API `site:domain`, UK Companies House, US SEC EDGAR, và cổng quyết định "chỉ chạy khi bước 2 chưa tới được cửa mua hàng". **Còn lại:** hội chợ/hiệp hội ngành chưa có nguồn để đọc, và kết quả sổ đăng ký chưa được lưu vào DB (cần migration 011) nên chưa hiện trong danh sách buyer — xem `docs/backlog.md`.
6. **Resolve pháp nhân từ tờ khai hải quan** — bước 1 nay đã có chỗ đứng trong DB và hiện trên danh sách buyer (spec §23, migration 011); phần còn lại là nối tờ khai hải quan vào chính chỗ đó.: chỉ làm được sau khi cắm dữ liệu hải quan (Volza/ImportYeti/Panjiva), tức là việc có ngân sách.

## Ghi chú: một câu trong code đã lỗi thời

`/api/connector` trả về `note: "…các bảng buyer/contact cần migration 002–006 apply trước."` — **sai**: bạn đã apply đủ 002–006 lên Supabase. Lý do thật của `persisted: false` là tầng ghi dữ liệu chưa được viết. Câu này đã được sửa trong cùng commit với tài liệu này.
