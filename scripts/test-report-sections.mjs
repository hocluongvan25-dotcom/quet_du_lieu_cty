#!/usr/bin/env node
/**
 * Kiểm cách chia nội dung report thành các phần.
 *
 * Điều quan trọng nhất: một email công bố kèm tên **phải** thành thẻ của người đó,
 * không được đứng riêng như một dòng email vô chủ — và nếu người đó đã có thẻ từ
 * LinkedIn thì email phải được gắn vào đúng thẻ ấy. Cùng lúc phải chắc rằng không
 * giá trị nào bị mất hay bị bịa ra.
 *
 * Chạy: npm run report:test
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleTs } from "./lib/ts-module.mjs";

const root = process.cwd();
const workDir = path.join(root, ".report-test");

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

const entry = `export * from "@/lib/report-sections";\nexport { marianiReport } from "@/lib/demo-mariani";\nexport { createDemoReport } from "@/lib/demo-data";\nexport { toCompanyReportView, toLedgerView } from "@/lib/data/report-view";\nexport { DEMO_PROVIDER, CONNECTOR_PROVIDER, researchCreditCost, resolveResearchProvider, searchApiKeyFromEnv } from "@/lib/data/research-provider";\nexport { pickOfficialDomain, websiteQueryFor } from "@/lib/data/company-resolver";\nexport { buildConnectorReport, confidenceForConnector, pickPrimaryChannels } from "@/lib/data/connector-report";\n`;

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const bundlePath = path.join(workDir, "bundle.mjs");
await writeFile(path.join(workDir, "entry.ts"), entry, "utf8");

await bundleTs(path.join(workDir, "entry.ts"), bundlePath);

const {
  buildReportSections,
  marianiReport,
  createDemoReport,
  toCompanyReportView,
  toLedgerView,
  DEMO_PROVIDER,
  CONNECTOR_PROVIDER,
  researchCreditCost,
  resolveResearchProvider,
  searchApiKeyFromEnv,
  pickOfficialDomain,
  websiteQueryFor,
  buildConnectorReport,
  confidenceForConnector,
  pickPrimaryChannels,
} = await import(pathToFileURL(bundlePath).href);

const sections = buildReportSections(marianiReport);

section("Kênh công ty (nằm cùng thông tin công ty)");
check("chỉ gồm kênh chung của công ty", sections.companyChannels.every((c) => (c.identityMatch ?? "company_general") === "company_general"));
check("có website, LinkedIn, điện thoại, email chung", sections.companyChannels.length === 4, `${sections.companyChannels.length} kênh`);
check(
  "không lẫn email bộ phận hay email của người",
  sections.companyChannels.every((c) => c.identityMatch === undefined || c.identityMatch === "company_general"),
);

section("Người liên quan");
check("gộp cả người tìm được qua LinkedIn và qua email công bố", sections.people.length === 6, `${sections.people.length} người`);
const sousa = sections.people.find((p) => p.name === "Steve Sousa");
check("email công bố kèm tên trở thành thẻ của người đó", Boolean(sousa), sousa ? sousa.title : "không thấy");
check("thẻ của Steve Sousa giữ đúng email đã công bố", Boolean(sousa?.channels.some((c) => c.value === "ssousa@mariani.com")));
check("thẻ của Steve Sousa mang chức danh đã công bố", sousa?.title === "Senior Director of Global Commodity Sales", sousa?.title);
const garcia = sections.people.find((p) => p.name === "Todd Garcia");
check("người thứ hai cũng có thẻ riêng", Boolean(garcia?.channels.some((c) => c.value === "tgarcia@mariani.com")));
check("người từ LinkedIn vẫn giữ kênh LinkedIn", sections.people.find((p) => p.name === "Stacy Nygard")?.channels.some((c) => c.value.includes("linkedin.com/in/stacy-nygard")) === true);
check("mỗi người có ít nhất một kênh", sections.people.every((p) => p.channels.length > 0));
check("kênh của người chỉ thuộc email / điện thoại / linkedin", sections.people.every((p) => p.channels.every((c) => ["email", "phone", "linkedin"].includes(c.type))));

section("Khối dưới: email bộ phận");
check("chỉ còn email bộ phận", sections.departmentChannels.length === 1 && sections.departmentChannels[0].value === "ingredients@mariani.com", sections.departmentChannels.map((c) => c.value).join(", "));
check("email của người đã rời khỏi khối này", sections.departmentChannels.every((c) => !c.value.startsWith("ssousa@") && !c.value.startsWith("tgarcia@")));

section("Không mất dữ liệu, không bịa dữ liệu");
const shown = [
  ...sections.companyChannels.map((c) => c.value),
  ...sections.departmentChannels.map((c) => c.value),
  ...sections.people.flatMap((p) => p.channels.map((c) => c.value)),
];
check("mọi kênh của report đều xuất hiện đúng một lần", shown.length === marianiReport.contacts.length + marianiReport.people.flatMap((p) => p.channels).length, `${shown.length} giá trị`);
check("không giá trị nào bị bịa thêm", shown.every((value) => {
  const inContacts = marianiReport.contacts.some((c) => c.value === value);
  const inPeople = marianiReport.people.some((p) => p.channels.some((c) => c.value === value));
  return inContacts || inPeople;
}));
check("email giữ nguyên văn, không suy luận theo pattern", shown.filter((v) => v.includes("@")).every((v) => marianiReport.contacts.some((c) => c.value === v) || marianiReport.people.some((p) => p.channels.some((c) => c.value === v))));

section("Dự phòng khi pipeline không điền personName");
const withoutName = {
  ...marianiReport,
  contacts: [
    { label: "Email công bố theo vùng — Steve Sousa", value: "ssousa@mariani.com", type: "email", verified: true, source: "Trang Contact Us", identityMatch: "person" },
  ],
  people: [],
};
const fallback = buildReportSections(withoutName);
check("vẫn nhận ra tên từ nhãn công bố", fallback.people.length === 1 && fallback.people[0].name === "Steve Sousa", fallback.people[0]?.name);
check("nhãn không có tên thì không bịa ra người", buildReportSections({ ...withoutName, contacts: [{ label: "Email chung", value: "info@x.com", type: "email", verified: true, source: "site", identityMatch: "person" }] }).people.length === 0);
check("email không gắn được tên thì xuống khối dưới, không mất", buildReportSections({ ...withoutName, contacts: [{ label: "Email chung", value: "info@x.com", type: "email", verified: true, source: "site", identityMatch: "person" }] }).departmentChannels.length === 1);

await rm(workDir, { recursive: true, force: true });


section("report mẫu phải tự nói mình là mẫu — và không được tính tiền");

// Đúng những gì người dùng thấy khi tra "Vinamilk" / "FPT Corporation" trên
// giao diện: trạng thái "Chưa xác định", độ tin cậy 84/100, URL dạng .example.
// Ba con số đó phải đi kèm nhãn "dữ liệu mẫu", nếu không người đọc hiểu sai.
const vinamilk = createDemoReport({ companyName: "Vinamilk" });
check("báo cáo mẫu tự mang cờ sampleData", vinamilk.sampleData === true);
check(
  "và đúng là dữ liệu mẫu về nội dung: chưa xác định quốc gia, không có nguồn thật",
  vinamilk.country === "Chưa xác định" && vinamilk.website.endsWith(".example"),
  `${vinamilk.country} · ${vinamilk.website} · ${vinamilk.confidence}/100`,
);
const fpt = createDemoReport({ sourceUrl: "https://fpt.example.vn" });
check("tra bằng link cũng là báo cáo mẫu", fpt.sampleData === true);

// Dòng lưu trong Supabase: nguồn gốc đọc từ chính dữ liệu, không phải từ chỗ lưu.
const baseRow = {
  id: "r1",
  company_name: "Vinamilk",
  country: null,
  city: null,
  industry: null,
  description: null,
  official_website: null,
  linkedin_url: null,
  public_business_email: null,
  public_business_phone: null,
  whatsapp_business_url: null,
  confidence: 84,
  captured_at: "2026-10-07T00:00:00.000Z",
  expires_at: "2026-11-06T00:00:00.000Z",
  research_jobs: { status: "ready" },
};
const demoRowView = toCompanyReportView({
  report: { ...baseRow, report_data: { provider: "demo", signals: [] } },
  evidence: [],
  locale: "vi",
});
check("dòng lưu từ provider mẫu hiện nhãn mẫu khi đọc lại", demoRowView.sampleData === true);
check("độ tin cậy vẫn giữ nguyên con số, nhãn chỉ nói thêm nguồn gốc", demoRowView.confidence === 84);

const unmarkedRowView = toCompanyReportView({
  report: { ...baseRow, report_data: { signals: [] } },
  evidence: [],
  locale: "vi",
});
check("dòng cũ không có thông tin provider thì KHÔNG tự dán nhãn mẫu", unmarkedRowView.sampleData === undefined);

const connectorRowView = toCompanyReportView({
  report: { ...baseRow, report_data: { provider: "connector", signals: [] } },
  evidence: [],
  locale: "vi",
});
check("dòng của provider thật không mang nhãn mẫu", connectorRowView.sampleData === undefined);

check("provider mẫu KHÔNG trừ credits", researchCreditCost(DEMO_PROVIDER, 5) === 0);
check("provider thật tính đúng giá", researchCreditCost(CONNECTOR_PROVIDER, 5) === 5);
check(
  "giá và provider không bao giờ lệch nhau: 0 credits ⇔ báo cáo mẫu",
  [DEMO_PROVIDER, CONNECTOR_PROVIDER].every((provider) => (researchCreditCost(provider, 5) === 0) === (provider === DEMO_PROVIDER)),
);
check(
  "khoá tìm kiếm rỗng ⇒ provider mẫu, và nói rõ vì sao",
  resolveResearchProvider({ searchKey: "", reportCost: 5 }).provider === DEMO_PROVIDER &&
    resolveResearchProvider({ searchKey: null, reportCost: 5 }).cost === 0 &&
    resolveResearchProvider({ searchKey: "  ", reportCost: 5 }).reason.includes("SEARCH_API_KEY"),
);
check(
  "có khoá tìm kiếm ⇒ đọc nguồn thật và tính 5 credits",
  resolveResearchProvider({ searchKey: "tvly-abc", reportCost: 5 }).provider === CONNECTOR_PROVIDER &&
    resolveResearchProvider({ searchKey: "tvly-abc", reportCost: 5 }).cost === 5,
);
check(
  "đọc khoá từ biến môi trường, không đọc biến khác",
  searchApiKeyFromEnv({ SEARCH_API_KEY: " tvly-x ", TAVILY_API_KEY: "tvly-khac" }) === "tvly-x" &&
    searchApiKeyFromEnv({}) === "",
);

section("tên công ty → website: chỉ nhận khi có bằng chứng tên");

// Kết quả Tavily thật cho "Vinamilk" có lẫn mạng xã hội và báo — chúng thường
// đứng đầu, và lấy nhầm chúng làm "website công ty" là sai từ bước đầu.
const vinamilkHits = [
  { url: "https://www.linkedin.com/company/vinamilk", title: "Vinamilk | LinkedIn", snippet: "Vinamilk Vietnam dairy company" },
  { url: "https://en.wikipedia.org/wiki/Vinamilk", title: "Vinamilk - Wikipedia", snippet: "Vinamilk is a Vietnamese dairy company" },
  { url: "https://www.vinamilk.com.vn/", title: "Vinamilk - Công ty Cổ phần Sữa Việt Nam", snippet: "Sữa Việt Nam" },
  { url: "https://vinamilk.com.vn/gioi-thieu", title: "Giới thiệu", snippet: "Vinamilk" },
  { url: "https://www.reuters.com/markets/companies/VNM.HM", title: "Vinamilk", snippet: "Reuters profile" },
];
const pickedVinamilk = pickOfficialDomain(vinamilkHits, "Vinamilk");
check("bỏ qua LinkedIn/Wikipedia/Reuters dù chúng đứng trước", pickedVinamilk?.domain === "vinamilk.com.vn", JSON.stringify(pickedVinamilk));
check("nêu được lý do chọn, để người kiểm đọc lại", (pickedVinamilk?.why.length ?? 0) > 0, JSON.stringify(pickedVinamilk?.why));
check("ưu tiên trang chủ", pickedVinamilk?.url === "https://www.vinamilk.com.vn/", pickedVinamilk?.url);

// Tên dài hơn nhãn tên miền: "Sun-Maid Growers Of California" ↔ sunmaid.com
const sunMaid = pickOfficialDomain(
  [
    { url: "https://www.sunmaid.com/", title: "Sun-Maid Growers of California", snippet: "Raisins since 1912" },
    { url: "https://www.zoominfo.com/c/sun-maid-growers-of-california", title: "Sun-Maid", snippet: "company profile" },
  ],
  "Sun-Maid Growers Of California",
);
check("tên dài hơn tên miền vẫn nhận ra (sun-maid ↔ sunmaid)", sunMaid?.domain === "sunmaid.com", JSON.stringify(sunMaid));

// Không có bằng chứng tên ⇒ trả null. Đoán bừa ở đây là tạo ra một report rất
// gọn ghẽ về một công ty khác.
const noEvidence = pickOfficialDomain(
  [
    { url: "https://www.example-holdings.com/", title: "Example Holdings", snippet: "industrial supplier" },
    { url: "https://another-company.net/about", title: "Another Company", snippet: "since 1999" },
  ],
  "Vina Ngoc Phat Foodstuff",
);
check("không có bằng chứng tên ⇒ KHÔNG chọn tên miền nào", noEvidence === null, JSON.stringify(noEvidence));
check("tên quá ngắn cũng không dò bừa", pickOfficialDomain([{ url: "https://ac.com/", title: "", snippet: "" }], "AC") === null);
check("ô tìm kiếm giữ tên trong ngoặc kép", websiteQueryFor('Vinamilk "fake"', "Vietnam").startsWith('"Vinamilk fake" Vietnam'), websiteQueryFor("Vinamilk", "Vietnam"));

section("kết quả connector → report: mọi trường đều đếm được");

// Một ConnectorResult tối thiểu nhưng thật: hai trang đã đọc, một hộp thư bộ
// phận, một số điện thoại, và tên công ty có trên trang.
const connectorResult = {
  seedUrl: "https://vinamilk.com.vn",
  domain: "vinamilk.com.vn",
  pages: [
    { url: "https://vinamilk.com.vn", status: 200, channels: 1, kind: "html" },
    { url: "https://vinamilk.com.vn/lien-he", status: 200, channels: 1, kind: "html" },
  ],
  channels: [
    {
      type: "email",
      value: "purchasing@vinamilk.com.vn",
      label: "Email bộ phận mua hàng",
      identityMatch: "department",
      certainty: "confirmed",
      policy: "outreach_ready",
      sourceUrl: "https://vinamilk.com.vn/lien-he",
      evidenceSnippet: "Phòng mua hàng: purchasing@vinamilk.com.vn",
    },
    {
      type: "phone",
      value: "+84 28 5416 1111",
      label: "Điện thoại",
      identityMatch: "company_general",
      certainty: "confirmed",
      policy: "outreach_ready",
      sourceUrl: "https://vinamilk.com.vn/lien-he",
      evidenceSnippet: "Tổng đài: +84 28 5416 1111",
    },
  ],
  people: [],
  requirements: [],
  reviewHints: [],
  notes: [{ kind: "not_found", label: "WhatsApp", detail: "Không thấy số WhatsApp nào." }],
  pagesFetched: 2,
  identityMatched: true,
  description: { text: "Vinamilk là công ty sữa Việt Nam thành lập năm 1976.", sourceUrl: "https://vinamilk.com.vn" },
  secondary: { ran: false, reason: "nguồn cấp 1 đã có cửa mua hàng", registriesQueried: [] },
};

const built = buildConnectorReport({
  companyName: "Vinamilk",
  country: "Vietnam",
  result: connectorResult,
  locale: "vi",
  resolvedFrom: { url: "https://www.vinamilk.com.vn/", why: ["tên công ty nằm trong tên miền"] },
  retentionDays: 30,
  now: new Date("2026-10-07T12:00:00.000Z"),
});

check("report thật KHÔNG mang cờ dữ liệu mẫu", built.report.sampleData === undefined);
check("mô tả là câu của chính website, không phải câu tự viết", built.report.description === connectorResult.description.text);
check("quốc gia lấy từ bộ lọc người dùng chọn", built.report.country === "Vietnam");
check("ngành để trống thay vì đoán", built.report.industry === "" && built.report.foundedYear === undefined);
check("website lấy từ tên miền đã đọc", built.report.website === "vinamilk.com.vn");
check("trạng thái 'ready' khi có kênh thật", built.report.status === "ready");
check(
  "kênh bộ phận mua hàng lên cột public_business_email",
  built.columns.public_business_email === "purchasing@vinamilk.com.vn",
  JSON.stringify(built.columns),
);
check("điện thoại lên cột tương ứng", built.columns.public_business_phone === "+84 28 5416 1111");
check(
  "mọi kênh đều nằm trong report_data, kèm nguồn và câu chữ bằng chứng",
  built.report.contacts.some((contact) => contact.value === "purchasing@vinamilk.com.vn" && contact.sourceUrl === "https://vinamilk.com.vn/lien-he" && contact.via?.includes("purchasing@vinamilk.com.vn")),
);
check("website đứng đầu danh sách kênh", built.report.contacts[0]?.type === "website");
check(
  "bằng chứng giữ đúng URL trang đã thấy giá trị",
  built.evidence.some((row) => row.field_name === "public_business_email" && row.source_url === "https://vinamilk.com.vn/lien-he" && row.evidence_snippet === "Phòng mua hàng: purchasing@vinamilk.com.vn"),
);
check(
  "trang đã đọc vẫn được ghi làm nguồn, không chỉ trang có kênh",
  built.evidence.some((row) => row.source_url === "https://vinamilk.com.vn/lien-he"),
);
check("có tín hiệu nói rõ đã đọc bao nhiêu trang", built.report.signals.some((signal) => signal.includes("2")));
check("chưa kiểm được hộp thư thì không có tín hiệu 'đã xác minh'", built.report.signals.every((signal) => !/xác minh|verified/i.test(signal)));

// Điểm tin cậy: cùng dữ liệu, khác đúng một điều kiện — xác nhận được tên.
const withIdentity = confidenceForConnector({ pagesFetched: 2, identityMatched: true, nameGiven: true, channelTypes: 2, buyingDoor: true, registry: false, partial: false });
const withoutIdentity = confidenceForConnector({ pagesFetched: 2, identityMatched: false, nameGiven: true, channelTypes: 2, buyingDoor: true, registry: false, partial: false });
const nothing = confidenceForConnector({ pagesFetched: 0, identityMatched: false, nameGiven: false, channelTypes: 0, buyingDoor: false, registry: false, partial: true });
check("xác nhận được tên thì điểm cao hơn hẳn", withIdentity > withoutIdentity, `${withIdentity} vs ${withoutIdentity}`);
check("không đọc được gì thì điểm sàn, và không bao giờ 0", nothing >= 25 && nothing <= 40, String(nothing));
check("trần điểm là 90 — chưa kiểm hộp thư thì không có chuyện 100", confidenceForConnector({ pagesFetched: 9, identityMatched: true, nameGiven: true, channelTypes: 5, buyingDoor: true, registry: true, partial: false }) === 90);

check(
  "chọn kênh chính: bộ phận trước, kênh chung sau, cá nhân cuối",
  pickPrimaryChannels({
    ...connectorResult,
    channels: [
      { ...connectorResult.channels[0], value: "person@vinamilk.com.vn", identityMatch: "person" },
      { ...connectorResult.channels[0], value: "info@vinamilk.com.vn", identityMatch: "company_general" },
      { ...connectorResult.channels[0], value: "purchasing@vinamilk.com.vn", identityMatch: "department" },
    ],
  }).email.value === "purchasing@vinamilk.com.vn",
);

check(
  "không xác nhận được tên ⇒ có ghi chú nói rõ, và cờ website hạ xuống",
  (() => {
    const unattested = buildConnectorReport({
      companyName: "Vinamilk",
      country: "",
      result: { ...connectorResult, identityMatched: false },
      locale: "vi",
      retentionDays: 30,
    });
    return (
      unattested.report.contacts[0].verified === false &&
      unattested.report.signals.some((signal) => signal.includes("Chưa xác nhận tên")) &&
      unattested.report.confidence < withIdentity
    );
  })(),
);

check(
  "hết thời gian giữa đường ⇒ report nói thẳng là chưa đầy đủ",
  (() => {
    const partial = buildConnectorReport({
      companyName: "Vinamilk",
      country: "",
      result: { ...connectorResult, stoppedEarly: "hết thời gian cho phép khi đang đọc các trang chính" },
      locale: "vi",
      retentionDays: 30,
    });
    return partial.report.signals.some((signal) => signal.includes("hết thời gian")) && partial.provenance.stoppedEarly !== null;
  })(),
);


section("sổ credits: chỉ hiển thị dòng đọc từ DB, không bịa giao dịch");

// Tài khoản thật có đúng một dòng thật khi khởi tạo (migration 002:
// 'Starter workspace grant', +50). Trang billing phải hiển thị chính dòng đó.
const grantRow = {
  id: "l1",
  type: "credit",
  amount: 50,
  description: "Starter workspace grant",
  created_at: "2026-10-07T03:00:00.000Z",
};
const debitRow = {
  id: "l2",
  type: "debit",
  amount: 5,
  description: "Company Report · Nova Distribution Ltd.",
  created_at: "2026-10-07T04:00:00.000Z",
};
const ledgerView = toLedgerView([grantRow, debitRow], "vi");
check("đọc đủ số dòng có trong sổ", ledgerView.length === 2);
check("dòng cấp credits hiện dấu + và nhãn tiếng Việt", ledgerView[0].amountLabel === "+50" && ledgerView[0].direction === "in" && ledgerView[0].label === "Cấp credits");
check("dòng trừ credits hiện dấu - và đúng nhãn", ledgerView[1].amountLabel === "-5" && ledgerView[1].direction === "out" && ledgerView[1].label === "Company Report");
check("mô tả giữ nguyên như trong DB, không viết lại", ledgerView[0].detail === "Starter workspace grant" && ledgerView[1].detail === "Company Report · Nova Distribution Ltd.");
check("sổ rỗng thì trả về rỗng — không tự thêm dòng mẫu nào", toLedgerView([], "vi").length === 0 && toLedgerView(null, "vi").length === 0 && toLedgerView(undefined, "en").length === 0);
check("loại lạ vẫn hiện đúng loại đó thay vì đoán bừa", toLedgerView([{ ...grantRow, type: "manual_note" }], "en")[0].label === "manual_note");

console.log(`\n${passed} check pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
