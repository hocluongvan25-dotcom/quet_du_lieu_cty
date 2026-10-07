#!/usr/bin/env node
/**
 * Kiểm phần dữ liệu hải quan — thuần, không cần mạng, không cần Supabase:
 *
 *   npm run customs:test
 *
 * 1. Đọc CSV: ô bọc nháy, dấu phẩy trong ô, xuống dòng trong ô, BOM, CRLF.
 * 2. Bảng ánh xạ cột: vai đọc từ **tên cột**, cột lạ bị bỏ qua chứ không đoán.
 * 3. Chuẩn hoá: tên, tên miền, quốc gia, con số, ngày (ngày mơ hồ thì không đoán).
 * 4. Nhập file: dựng đúng payload gửi xuống DB, đếm đúng thứ bị bỏ, nhập lại
 *    không nhân đôi, ghi kiểu gì cũng thấy trong báo cáo trả về.
 * 5. Xếp hạng ứng viên: bên gửi hàng không bao giờ có ứng viên; ứng viên nào
 *    cũng phải kèm lý do.
 * 6. Bảng `customsSideFor` khớp với `public.customs_side_for` của 012 — bảng
 *    dưới đây được kiểm ở cả hai phía (SQL trong `npm run db:verify`).
 */

import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const workDir = path.join(root, ".customs-test");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Đọc TS qua esbuild, giống các bộ test khác trong repo. */
async function loadApi() {
  await mkdir(workDir, { recursive: true });
  const entryPath = path.join(workDir, "entry.ts");
  const bundlePath = path.join(workDir, "bundle.mjs");
  const entry = `
    export { parseCsv } from "@/lib/customs/csv";
    export { mapColumn, mapHeaders, normalizeHeader } from "@/lib/customs/columns";
    export {
      customsSideFor,
      normalizeCompanyName,
      nameSimilarity,
      declaredDomain,
      countryIso2,
      parseNumber,
      parseShipmentDate,
    } from "@/lib/customs/normalize";
    export { importCustomsCsv } from "@/lib/customs/import";
    export { suggestBuyerCandidates, soleStrongCandidate } from "@/lib/customs/resolve";
    export { toBuyerCustomsByBuyer, toCustomsQueueItem } from "@/lib/customs/view";
  `;
  await import("node:fs/promises").then(({ writeFile }) => writeFile(entryPath, entry, "utf8"));

  const build = spawnSync(
    "npx",
    ["--no-install", "esbuild", entryPath, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundlePath}`, "--log-level=warning"],
    { cwd: root, encoding: "utf8" },
  );
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }
  return (await import(pathToFileURL(bundlePath).href)).default ?? (await import(pathToFileURL(bundlePath).href));
}

/** Store giả: ghi lại lời gọi, trả về đúng hình dạng mà RPC trả về. */
function fakeStore({ replayFrom = 0 } = {}) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async recordRecord(input) {
      calls.push(input);
      index += 1;
      return { record_id: `record-${index}`, replayed: index <= replayFrom };
    },
    async link(input) {
      return { id: "match-1", status: "linked", buyer_profile_id: input.buyerProfileId, method: input.method, confidence: input.confidence };
    },
    async mark(input) {
      return { id: "match-1", status: input.status, buyer_profile_id: null, method: input.method ?? null, confidence: input.confidence ?? null };
    },
    async createBuyer() {
      return { id: "match-1", status: "created", buyer_profile_id: "buyer-new", method: "created_from_customs", confidence: 70 };
    },
  };
}

const CSV = [
  "Bill of Lading Number,Shipment Date,Shipper Name,Shipper Country,Consignee Name,Consignee Country,Consignee Address,HS Code,Product Description,Quantity,Quantity Unit,Weight (kg),Containers,Value USD,Port of Discharge,Notify Party,Buyer Email",
  'BL-0001,2026-05-12,"AGRICARE JSC, LTD.",Viet Nam,"THAMES VALLEY FOODS LTD","United Kingdom","12 Mill Lane, Reading",0801.32.00,"Cashew nuts, shelled",1200,CARTONS,"18,240.50",2,"54,000.00",Felixstowe,,shipper@example.invalid',
  'BL-0002,05/13/2026,HARVEST LANKA (PVT) LTD,Sri Lanka,"THAMES VALLEY FOODS LTD","United Kingdom",,0902.40.00,"Black tea, fermented",800,BAGS,9000,1,21000,London,,',
].join("\r\n");

const api = await loadApi();

// ------------------------------------------------------------------ 1. CSV ----
section("đọc CSV vận đơn");
{
  const parsed = api.parseCsv(CSV);
  check("dòng đầu thành tên cột", parsed.headers[0] === "Bill of Lading Number" && parsed.headers.length === 17, String(parsed.headers.length));
  check("hai dòng dữ liệu", parsed.rows.length === 2, String(parsed.rows.length));
  check("dấu phẩy trong ô bọc nháy không bị cắt", parsed.rows[0][2] === "AGRICARE JSC, LTD.", parsed.rows[0][2]);
  check("ô có dấu phẩy nghìn giữ nguyên chữ", parsed.rows[0][11] === "18,240.50", parsed.rows[0][11]);

  const tricky = api.parseCsv('\uFEFFa,b\n"line1\nline2","say ""hi"""\n\n"x",y\n');
  check("BOM bị bỏ khỏi tên cột đầu", tricky.headers[0] === "a", JSON.stringify(tricky.headers));
  check("xuống dòng trong ô bọc nháy giữ nguyên", tricky.rows[0][0] === "line1\nline2", JSON.stringify(tricky.rows[0][0]));
  check("hai dấu nháy trong ô = một dấu nháy", tricky.rows[0][1] === 'say "hi"', tricky.rows[0][1]);
  check("dòng trống bị bỏ", tricky.rows.length === 2, String(tricky.rows.length));
  check("CRLF và LF đều là hết dòng", api.parseCsv("a,b\r\n1,2\n3,4").rows.length === 2);
}

// -------------------------------------------------------- 2. ánh xạ cột ----
section("bảng đối chiếu cột");
{
  const mapping = (header) => {
    const result = api.mapColumn(header);
    if (!result) return null;
    return result.kind === "record" ? `record:${result.field}` : `party:${result.role}.${result.part}`;
  };

  check("Shipper Name → bên gửi hàng", mapping("Shipper Name") === "party:shipper.name", mapping("Shipper Name"));
  check("Exporter → bên gửi hàng", mapping("Exporter") === "party:shipper.name");
  check("Consignee → bên nhận hàng", mapping("Consignee") === "party:consignee.name");
  check("Buyer được giữ đúng chữ của file trong source_column", api.mapColumn("Buyer")?.via === "buyer" && mapping("Buyer") === "party:importer.name");
  check("Notify Party là vai riêng, không gộp vào bên nhận hàng", mapping("Notify Party") === "party:notify_party.name");
  check("Consignee Country là quốc gia của bên, không phải quốc gia xuất xứ", mapping("Consignee Country") === "party:consignee.country");
  check("Shipper Address nhận ra đúng bên", mapping("Shipper Address") === "party:shipper.address");
  check("cột không phải dữ liệu bên bị bỏ qua (Shipper Email)", mapping("Shipper Email") === null);
  check("cột mô tả của riêng bên bị bỏ qua (Consignee Reference)", mapping("Consignee Reference") === null);
  check("Bill of Lading Number → khoá tờ khai", mapping("Bill of Lading Number") === "record:record_reference");
  check("HS Code → mã HS", mapping("HS Code") === "record:hs_code");
  check("Weight (kg) → cân nặng", mapping("Weight (kg)") === "record:weight_kg");
  check("Port of Discharge → cảng đến", mapping("Port of Discharge") === "record:destination_port");

  const report = api.mapHeaders(CSV.split("\r\n")[0].split(","));
  check("bảng đối chiếu sẵn sàng nhập", report.ready === true, JSON.stringify(report.problems));
  check("cột lạ được liệt kê chứ không im lặng", report.ignored.includes("Buyer Email") && report.ignored.includes("Notify Party") === false, JSON.stringify(report.ignored));
  check("bảng nói rõ đích của từng cột", report.mapped.some((row) => row.header === "Consignee Country" && row.target === "consignee.country"));

  const noReference = api.mapHeaders(["Shipper Name", "Consignee Name", "Weight (kg)"]);
  check("thiếu cột số vận đơn → chặn", noReference.ready === false && noReference.problems.some((text) => text.includes("số vận đơn")));
  const noRoles = api.mapHeaders(["Bill of Lading Number", "Weight (kg)", "HS Code"]);
  check("thiếu cột vai → chặn", noRoles.ready === false && noRoles.problems.some((text) => text.includes("vai")));
}

// ------------------------------------------------------------ 3. chuẩn hoá ----
section("chuẩn hoá tên, số, ngày");
{
  check("bỏ hậu tố pháp nhân", api.normalizeCompanyName("ACME FOODS CO., LTD.") === "acme foods", api.normalizeCompanyName("ACME FOODS CO., LTD."));
  check("bỏ nhiều lớp hậu tố", api.normalizeCompanyName("Mekong Foodstuffs Co Ltd") === "mekong foodstuffs", api.normalizeCompanyName("Mekong Foodstuffs Co Ltd"));
  check("bỏ dấu tiếng Việt", api.normalizeCompanyName("Công ty TNHH Thực phẩm") === "thuc pham", api.normalizeCompanyName("Công ty TNHH Thực phẩm"));
  check("hình thức pháp nhân kiểu Việt Nam đứng trước tên cũng bị bỏ", api.normalizeCompanyName("Công ty Cổ phần Xuất nhập khẩu An Giang") === "xuat nhap khau an giang", api.normalizeCompanyName("Công ty Cổ phần Xuất nhập khẩu An Giang"));
  check("& thành and", api.normalizeCompanyName("Smith & Sons") === "smith and sons");
  check("tên gần giống tính theo từ chung", Math.abs(api.nameSimilarity("thames valley foods", "thames valley trading") - 2 / 4) < 0.001, String(api.nameSimilarity("thames valley foods", "thames valley trading")));
  check("tên khác hẳn thì 0", api.nameSimilarity("thames valley foods", "velar foods") < 0.5);

  check("tên miền từ URL", api.declaredDomain("https://www.acme.co.uk/about") === "acme.co.uk", String(api.declaredDomain("https://www.acme.co.uk/about")));
  check("tên miền trần, không scheme", api.declaredDomain("tvfoods.example") === "tvfoods.example");
  check("không phải tên miền thì null", api.declaredDomain("n/a") === null && api.declaredDomain("") === null);

  check("quốc gia có mã ISO", api.countryIso2("Viet Nam") === "VN", String(api.countryIso2("Viet Nam")));
  check("quốc gia viết hoa vẫn nhận ra", api.countryIso2("UNITED KINGDOM") === "GB", String(api.countryIso2("UNITED KINGDOM")));
  check("quốc gia lạ thì null, không đoán", api.countryIso2("Atlantis") === null);

  check("số kiểu Anh", api.parseNumber("18,240.50") === 18240.5, String(api.parseNumber("18,240.50")));
  check("số kiểu châu Âu", api.parseNumber("18.240,50") === 18240.5, String(api.parseNumber("18.240,50")));
  check("số có đơn vị", api.parseNumber("9000 KG") === 9000);
  check("ô rỗng thì null", api.parseNumber("") === null && api.parseNumber("n/a") === null);

  check("ngày ISO đọc chắc chắn", JSON.stringify(api.parseShipmentDate("2026-05-12")) === JSON.stringify({ ok: true, value: "2026-05-12" }));
  check("ngày có tên tháng đọc chắc chắn", api.parseShipmentDate("12 May 2026").value === "2026-05-12", JSON.stringify(api.parseShipmentDate("12 May 2026")));
  check("13/05 là ngày 13 tháng 5, tự biết", api.parseShipmentDate("13/05/2026").value === "2026-05-13");
  check("05/13 là ngày 13 tháng 5, tự biết", api.parseShipmentDate("05/13/2026").value === "2026-05-13");
  check("05/03 không đoán", JSON.stringify(api.parseShipmentDate("05/03/2026")) === JSON.stringify({ ok: false, ambiguous: true }));
  check("chọn ngày trước thì đọc được", api.parseShipmentDate("05/03/2026", "dmy").value === "2026-03-05");
  check("chọn tháng trước thì đọc được", api.parseShipmentDate("05/03/2026", "mdy").value === "2026-05-03");
  check("ngày rác thì null", api.parseShipmentDate("không rõ").ok === false && api.parseShipmentDate("").ok === false);
}

// --------------------------------------------------------------- 4. nhập file ----
section("nhập file thành tờ khai");
const runImport = async (options = {}, storeOptions = {}) => {
  const store = fakeStore(storeOptions);
  const report = await api.importCustomsCsv(store, {
    organizationId: "org-1",
    sourceKey: "customs_bol",
    text: CSV,
    ...options,
  });
  return { store, report };
};

{
  const { store, report } = await runImport();
  check("hai tờ khai được ghi", report.imported === 2 && store.calls.length === 2, `${report.imported}/${store.calls.length}`);
  check("không có lỗi", report.failures.length === 0, JSON.stringify(report.failures));
  check("không dòng nào bị bỏ", report.skippedNoReference === 0 && report.skippedNoParty === 0 && report.duplicatesInFile === 0);
  check("ngày mơ hồ được đếm riêng", report.ambiguousDates === 0);

  const first = store.calls[0];
  check("khoá tờ khai giữ nguyên như file", first.recordReference === "BL-0001", first.recordReference);
  check("ngày ISO được truyền xuống dạng ngày", first.shipmentDate === "2026-05-12", String(first.shipmentDate));
  check("mã HS giữ nguyên bản in, không tự chuẩn hoá", first.hsCode === "0801.32.00", String(first.hsCode));
  check("số lượng và cân nặng đọc thành số", first.quantity === 1200 && first.weightKg === 18240.5, `${first.quantity}/${first.weightKg}`);
  check("trị giá và số container đọc thành số", first.valueUsd === 54000 && first.containers === 2, `${first.valueUsd}/${first.containers}`);
  check("cảng đến giữ nguyên chữ", first.destinationPort === "Felixstowe");

  const shipper = first.parties.find((party) => party.role === "shipper");
  const consignee = first.parties.find((party) => party.role === "consignee");
  check("bên gửi hàng được ghi kèm bản chuẩn hoá", shipper?.name === "AGRICARE JSC, LTD." && shipper?.nameNormalized === "agricare", `${shipper?.name} → ${shipper?.nameNormalized}`);
  check("bên nhận hàng giữ nguyên tên trên tờ khai", consignee?.name === "THAMES VALLEY FOODS LTD", consignee?.name);
  check("tên cột nguồn được ghi lại", consignee?.column === "Consignee Name" && shipper?.column === "Shipper Name");
  check("quốc gia giữ đúng bản in trên tờ khai", consignee?.country === "United Kingdom", String(consignee?.country));
  check("mã ISO là cột riêng, không viết lại bản in", consignee?.countryIso2 === "GB" && shipper?.countryIso2 === "VN", `${consignee?.countryIso2}/${shipper?.countryIso2}`);
  check("quốc gia lạ thì không suy ra mã", (await api.importCustomsCsv(fakeStore(), { organizationId: "o", sourceKey: "s", text: "BOL,Consignee,Consignee Country\nX1,Some Co,Atlantis" })).imported === 1);
  check("địa chỉ của bên được giữ", consignee?.address === "12 Mill Lane, Reading", String(consignee?.address));
  check("cột email của file không thành kênh liên hệ nào", first.parties.every((party) => !("email" in party) && !("phone" in party)));

  const second = store.calls[1];
  check("dòng có ngày tự hiểu được đọc đúng", second.shipmentDate === "2026-05-13", String(second.shipmentDate));
  check("dòng chỉ có bên nhận hàng vẫn ghi được", second.parties.length === 2 && second.parties.some((party) => party.role === "shipper"));

  const dry = await runImport({ dryRun: true });
  check("chế độ xem thử không ghi gì", dry.store.calls.length === 0 && dry.report.imported === 0);
  check("chế độ xem thử vẫn trả bảng đối chiếu", dry.report.columns.ready === true && dry.report.rows === 2);

  const replay = await runImport({}, { replayFrom: 2 });
  check("nhập lại file cũ: không ghi mới, đếm là nhập lại", replay.report.replayed === 2 && replay.report.imported === 0, JSON.stringify({ imported: replay.report.imported, replayed: replay.report.replayed }));

  const withFailure = fakeStore();
  withFailure.recordRecord = async () => {
    throw new Error('Chưa có market_sources khoá "customs_bol" — không ghi được vì thiếu nguồn.');
  };
  const failedReport = await api.importCustomsCsv(withFailure, { organizationId: "org-1", sourceKey: "customs_bol", text: CSV });
  check("thiếu nguồn: mọi dòng ghi lỗi kèm số vận đơn", failedReport.failures.length === 2 && failedReport.failures[0].reference === "BL-0001");
  check("thông báo của DB được giữ nguyên", failedReport.failures[0].message.includes("market_sources"), failedReport.failures[0].message);

  const messy = [
    "BOL,Shipment Date,Consignee,Shipper Name,Consignee Country",
    "BL-9,05/03/2026,\"THAMES VALLEY FOODS LTD\",,United Kingdom",
    "BL-10,2026-08-01,Another Buyer,SOME SHIPPER,\"Viet Nam\"",
    ",2026-08-02,Nameless Ref,SOME SHIPPER,United Kingdom",
    "BL-10,2026-08-01,Another Buyer,SOME SHIPPER,\"Viet Nam\"",
  ].join("\n");
  const messyReport = await api.importCustomsCsv(fakeStore(), { organizationId: "org-1", sourceKey: "customs_bol", text: messy });
  check("ngày mơ hồ: tờ khai vẫn ghi, ngày để trống và được đếm", messyReport.ambiguousDates === 1 && messyReport.imported === 2, JSON.stringify({ ambiguous: messyReport.ambiguousDates, imported: messyReport.imported }));
  check("thiếu số vận đơn: bỏ dòng và đếm", messyReport.skippedNoReference === 1);
  check("lặp số vận đơn trong cùng file: giữ một, đếm phần lặp", messyReport.duplicatesInFile === 1);
  check("lô không có bên nhận hàng được đếm để người nhập biết", messyReport.recordsWithoutBuyerSide === 0);
}

// ------------------------------------------------------- 5. xếp hạng ứng viên ----
section("xếp hạng ứng viên cho hàng đợi");
{
  const buyers = [
    { id: "b1", legal_name: "THAMES VALLEY FOODS LTD", display_name: "Thames Valley Foods Ltd.", domain: "tvfoods.example", country: "United Kingdom" },
    { id: "b2", legal_name: "Thames Valley Trading Co Ltd", display_name: "Thames Valley Trading", domain: "tvtrading.example", country: "United Kingdom" },
    { id: "b3", legal_name: "Velar Foods GmbH", display_name: "Velar Foods GmbH", domain: "velarfoods.example", country: "Germany" },
  ];

  const importer = {
    role: "consignee",
    name_as_printed: "THAMES VALLEY FOODS LTD",
    country_as_printed: "United Kingdom",
    country_iso2: "GB",
    website_declared: "tvfoods.example",
  };
  const ranked = api.suggestBuyerCandidates(importer, buyers);
  check("trùng tên miền lên đầu với điểm cao nhất", ranked[0]?.buyerProfileId === "b1" && ranked[0]?.method === "exact_domain", JSON.stringify(ranked[0]));
  check("mọi ứng viên đều kèm lý do đọc được", ranked.every((candidate) => candidate.reasons.length > 0));
  check("chỉ trả về ứng viên đủ gần", ranked.every((candidate) => candidate.score >= 40));
  check("ứng viên yếu nhất vẫn nói ra vì sao", ranked.some((candidate) => candidate.method === "fuzzy_name" && candidate.reasons.some((reason) => reason.includes("gần giống"))));

  const shipper = { role: "shipper", name_as_printed: "THAMES VALLEY FOODS LTD", country_as_printed: "United Kingdom" };
  check("bên gửi hàng không bao giờ có ứng viên", api.suggestBuyerCandidates(shipper, buyers).length === 0);

  const noDomain = { role: "consignee", name_as_printed: "THAMES VALLEY FOODS LTD", country_iso2: "GB" };
  const withoutDomain = api.suggestBuyerCandidates(noDomain, [buyers[0]]);
  check("trùng tên + trùng quốc gia là bằng chứng mạnh", withoutDomain[0]?.method === "exact_name_country" && withoutDomain[0]?.score === 88, JSON.stringify(withoutDomain[0]));

  const otherCountry = api.suggestBuyerCandidates(
    { role: "importer", name_as_printed: "THAMES VALLEY FOODS LTD", country_iso2: "IE" },
    [buyers[0]],
  );
  check("khác quốc gia bị nói ra và tụt điểm", otherCountry[0]?.score === 80 && otherCountry[0].reasons.some((reason) => reason.includes("khác quốc gia")), JSON.stringify(otherCountry[0]));

  const stranger = api.suggestBuyerCandidates({ role: "consignee", name_as_printed: "Kyoto Machine Tools KK", country_as_printed: "Japan" }, buyers);
  check("không giống gì thì không gợi ý ai", stranger.length === 0, JSON.stringify(stranger));

  const dominated = api.suggestBuyerCandidates(
    { role: "consignee", name_as_printed: "THAMES VALLEY FOODS LTD", website_declared: "tvfoods.example", country_iso2: "GB" },
    buyers,
  );
  check("tên miền khác bị nói ra như dấu hiệu chống nối nhầm", dominated.find((candidate) => candidate.buyerProfileId === "b2")?.reasons.some((reason) => reason.includes("tên miền khác nhau")) === true);

  const strong = api.soleStrongCandidate(api.suggestBuyerCandidates(importer, buyers));
  check("một ứng viên mạnh duy nhất thì lên trước", strong?.buyerProfileId === "b1");
  const twoStrong = api.soleStrongCandidate([
    { buyerProfileId: "x", label: "X", score: 96, method: "exact_domain", reasons: [] },
    { buyerProfileId: "y", label: "Y", score: 88, method: "exact_name_country", reasons: [] },
  ]);
  check("hai ứng viên mạnh thì không tự chọn ai", twoStrong === null);
}

// ---------------------------------------------------- 6. vai → bên của giao dịch ----
section("vai → bên (phải khớp public.customs_side_for của 012)");
{
  const expected = {
    importer: "importer_side",
    consignee: "importer_side",
    shipper: "exporter_side",
    notify_party: "unknown",
    other: "unknown",
  };
  Object.entries(expected).forEach(([role, side]) => {
    check(`customsSideFor(${role}) = ${side}`, api.customsSideFor(role) === side, String(api.customsSideFor(role)));
  });
  check(
    "không vai nào khác lọt vào bảng",
    Object.keys(expected).every((role) => api.customsSideFor(role) === expected[role]),
  );
}

// ---------------------------------------------------------- 7. dòng cho giao diện ----
section("đổi dòng Postgres thành dòng hiển thị");
{
  const summary = {
    buyer_profile_id: "buyer-1",
    records_count: 2,
    first_shipment: "2026-02-18",
    last_shipment: "2026-06-30",
    hs_codes: ["090240", "210690"],
    product_samples: ["Black tea, fermented"],
    supplier_countries: ["Sri Lanka (LK)"],
    supplier_names: ["HARVEST LANKA EXPORTS (PVT) LTD"],
    source_labels: ["Hải quan — vận đơn công bố"],
    match_methods: ["exact_name_country"],
    last_decided_at: "2026-10-04T10:05:00Z",
  };
  const roles = [{ buyer_profile_id: "buyer-1", role: "importer", side: "importer_side", records_count: 2, last_shipment: "2026-06-30" }];
  const map = api.toBuyerCustomsByBuyer([summary], roles);
  check("ghép tóm tắt với vai của khách hàng", map.get("buyer-1")?.roles.length === 1 && map.get("buyer-1")?.recordsCount === 2);
  check("khách hàng không có tờ khai thì không có khoá nào", map.has("buyer-2") === false);
  check("mảng null từ Postgres thành mảng rỗng", api.toBuyerCustomsByBuyer([{ ...summary, hs_codes: null, product_samples: null }], []).get("buyer-1")?.hsCodes.length === 0);

  const queueRow = {
    customs_party_id: "party-1",
    organization_id: "org-1",
    role: "consignee",
    side: "importer_side",
    name_as_printed: "THAMES VALLEY FOODS LTD",
    name_normalized: "thames valley foods",
    country_as_printed: "United Kingdom",
    country_iso2: "GB",
    address_as_printed: null,
    website_declared: null,
    source_column: "Consignee Name",
    customs_record_id: "record-1",
    record_reference: "BL-0001",
    shipment_date: "2026-05-12",
    hs_code: "0801.32.00",
    product_description: "Cashew nuts, shelled",
    source_label: "Hải quan — vận đơn công bố",
    source_key: "customs_bol",
    match_status: "review",
    match_method: "fuzzy_name",
    match_confidence: 55,
    match_reasons: ["có hai hồ sơ cùng tên"],
    counterparty_name: "AGRICARE JSC, LTD.",
    counterparty_country: "Viet Nam (VN)",
  };
  const item = api.toCustomsQueueItem(queueRow);
  check("hàng đợi giữ đúng tên trên tờ khai", item.nameAsPrinted === "THAMES VALLEY FOODS LTD");
  check("hàng đợi giữ tên cột nguồn để tra lại", item.sourceColumn === "Consignee Name");
  check("hàng đợi kèm bên đối tác để có bối cảnh", item.counterpartyName === "AGRICARE JSC, LTD.");
  check("lý do cũ đọc được dạng mảng", Array.isArray(item.reasons) && item.reasons.length === 1);
}

await rm(workDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
