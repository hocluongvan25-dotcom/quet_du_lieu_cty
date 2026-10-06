#!/usr/bin/env node
/**
 * Kiểm dữ liệu danh sách buyer và file CSV.
 *
 * CSV là thứ rời khỏi sản phẩm và được mở bằng Excel/CRM của khách, nên phải
 * kiểm: dấu nháy, dấu phẩy, xuống dòng, BOM cho tiếng Việt, và quan trọng nhất —
 * không có cột nào mang tính khuyến nghị.
 *
 * Chạy: npm run export:test
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const workDir = path.join(root, ".export-test");

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


/** Đọc CSV theo RFC 4180 — đủ để kiểm file mình sinh ra. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\r") {
      if (input[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ""));
}

async function main() {
  await mkdir(workDir, { recursive: true });
  const entry = `
export * from "@/lib/data/buyer-view";
`;
  await writeFile(path.join(workDir, "entry.ts"), entry, "utf8");
  const bundlePath = path.join(workDir, "bundle.mjs");

  const build = spawnSync(
    "npx",
    ["--no-install", "esbuild", path.join(workDir, "entry.ts"), "--bundle", "--platform=node", "--format=esm", "--alias:@=./src", `--outfile=${bundlePath}`, "--log-level=warning"],
    { cwd: root, encoding: "utf8" },
  );
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }

  const api = await import(pathToFileURL(bundlePath).href);

  // ------------------------------------------------------------------ cells --
  section("một ô CSV");
  check("ô thường giữ nguyên", api.csvCell("mariani.com") === "mariani.com");
  check("ô rỗng thành chuỗi rỗng", api.csvCell(null) === "" && api.csvCell(undefined) === "");
  check("có dấu phẩy thì được bọc nháy", api.csvCell("Vacaville, CA") === '"Vacaville, CA"');
  check("có dấu nháy kép thì nhân đôi", api.csvCell('Công ty "TNHH"') === '"Công ty ""TNHH"""');
  check("có xuống dòng thì được bọc nháy", api.csvCell("dòng 1\ndòng 2") === '"dòng 1\ndòng 2"');
  check("khoảng trắng đầu cuối được bọc nháy", api.csvCell(" abc ") === '" abc "');
  check("tiếng Việt không bị đổi", api.csvCell("Nguyễn Văn A") === "Nguyễn Văn A");

  // -------------------------------------------------------------------- list -
  section("danh sách mẫu");
  const demo = api.demoBuyerList();
  check("có buyer", demo.buyers.length >= 3, `${demo.buyers.length} công ty`);
  const mariani = demo.buyers.find((buyer) => buyer.name.includes("Mariani"));
  check("có Mariani", Boolean(mariani));
  check("đếm kênh xuất được khớp với số dòng liên hệ", demo.buyers.every((buyer) => buyer.exportableChannels === demo.contacts.filter((contact) => contact.buyerId === buyer.id).length));
  check("đếm người liên hệ khớp dữ liệu report", (mariani?.namedPeople ?? 0) > 0, String(mariani?.namedPeople));
  check("mọi dòng liên hệ đều có giá trị", demo.contacts.every((contact) => contact.value.trim().length > 0));
  check("không dòng nào thiếu nhãn tin cậy", demo.contacts.every((contact) => contact.confidenceLabel.length > 0));
  check("email bộ phận được ghi đúng là bộ phận", demo.contacts.find((contact) => contact.value === "ingredients@mariani.com")?.identityMatch === "department");
  check("không có dòng nào bịa giá trị ngoài fixture", demo.contacts.every((contact) => !/^(sales|procurement|info)@mariani\.com$/i.test(contact.value)));

  // ------------------------------------------------------------------ filter -
  section("lọc");
  const byCountry = api.filterBuyerList(demo, { country: "United States" });
  check("lọc theo quốc gia", byCountry.buyers.length >= 1 && byCountry.buyers.every((buyer) => buyer.country === "United States"));
  check("lọc theo quốc gia chỉ trả liên hệ của công ty đã lọc", byCountry.contacts.every((contact) => byCountry.buyers.some((buyer) => buyer.id === contact.buyerId)));

  const byQuery = api.filterBuyerList(demo, { query: "mariani" });
  check("tìm theo tên không phân biệt hoa thường", byQuery.buyers.length === 1 && byQuery.buyers[0].name.includes("Mariani"));

  const withPeople = api.filterBuyerList(demo, { onlyWithPeople: true });
  check("lọc công ty có tên người", withPeople.buyers.every((buyer) => buyer.namedPeople > 0));
  check("lọc không làm mất liên hệ của công ty còn lại", withPeople.contacts.every((contact) => withPeople.buyers.some((buyer) => buyer.id === contact.buyerId)));

  const empty = api.filterBuyerList(demo, { query: "zzz-không-tồn-tại" });
  check("lọc không ra gì thì trả rỗng, không trả toàn bộ", empty.buyers.length === 0 && empty.contacts.length === 0);

  // --------------------------------------------------------------------- csv -
  section("file CSV");
  const csv = api.buildBuyerCsv(demo);

  check("có BOM UTF-8 cho Excel", csv.startsWith("\uFEFF"));
  check("xuống dòng CRLF", csv.includes("\r\n") && !/[^\r]\n/.test(csv.replace(/\r\n/g, "")));
  const lines = csv.replace("\uFEFF", "").trimEnd().split("\r\n");
  check("dòng đầu là tên cột", lines[0] === api.CSV_COLUMNS.join(","), lines[0]);
  check("số dòng dữ liệu = số liên hệ", lines.length - 1 === demo.contacts.length, `${lines.length - 1} dòng / ${demo.contacts.length} liên hệ`);
  check("cột có nguồn dữ liệu", api.CSV_COLUMNS.includes("source_url") && api.CSV_COLUMNS.includes("last_seen"));
  check("có nhãn tin cậy trong CSV", api.CSV_COLUMNS.includes("confidence") && api.CSV_COLUMNS.includes("identity_match"));

  const parsedDemo = parseCsv(csv);
  check("CSV đọc lại được, đủ dòng", parsedDemo.length === demo.contacts.length + 1, `${parsedDemo.length} dòng`);
  check("mọi dòng đọc lại đủ số cột", parsedDemo.every((row) => row.length === api.CSV_COLUMNS.length), JSON.stringify(parsedDemo.map((row) => row.length).slice(0, 5)));
  check("giá trị nguồn nằm đúng cột", parsedDemo.slice(1).every((row) => row[api.CSV_COLUMNS.indexOf("source_url")] === "" || row[api.CSV_COLUMNS.indexOf("source_url")].startsWith("http")));

  const adviceColumns = ["priority", "rank", "score", "recommendation", "should_contact", "best_time", "advice"];
  check("KHÔNG có cột khuyến nghị/xếp hạng", !api.CSV_COLUMNS.some((column) => adviceColumns.includes(column)), api.CSV_COLUMNS.join(", "));

  // dữ liệu có dấu phẩy và nháy phải sống sót qua vòng CSV
  const tricky = api.buildBuyerCsv({
    buyers: [{ id: "b1", name: 'Công ty "ABC", Ltd', country: "Vietnam", region: null, website: null, industry: null, exportableChannels: 1, verifiedChannels: 0, withheldChannels: 0, namedPeople: 1, lastSignalAt: null, lastContactSeenAt: null }],
    contacts: [
      {
        buyerId: "b1",
        buyerName: 'Công ty "ABC", Ltd',
        country: "Vietnam",
        website: null,
        personName: "Nguyễn Văn A",
        jobTitle: "Trưởng phòng mua",
        department: null,
        channelType: "email",
        value: "a@abc.vn",
        confidenceLabel: "confirmed",
        identityMatch: "person",
        deliverability: "not_checked",
        isVerified: true,
        requiresOverride: false,
        sourceUrl: "https://abc.vn/contact",
        lastSeenAt: "2026-10-06",
      },
    ],
  });
  check("tên công ty có dấu phẩy và nháy được bọc đúng", tricky.includes('"Công ty ""ABC"", Ltd"'));
  check("giá trị tiếng Việt giữ nguyên dấu", tricky.includes("Nguyễn Văn A"));
  const trickyRows = parseCsv(tricky);
  check("tên cột đọc lại được đúng", trickyRows[0].length === api.CSV_COLUMNS.length && trickyRows[0][0] === "company", trickyRows[0].join("|"));
  check("dòng dữ liệu vẫn đúng số cột", trickyRows[1].length === api.CSV_COLUMNS.length, `${trickyRows[1].length} cột`);
  check("dấu nháy kép sống sót qua vòng CSV", trickyRows[1][0] === 'Công ty "ABC", Ltd' && trickyRows[1][7] === "a@abc.vn", JSON.stringify(trickyRows[1].slice(0, 2)));

  // -------------------------------------------------------- dữ liệu từ Postgres
  section("dữ liệu thật từ Postgres");
  const summary = [
    {
      buyer_profile_id: "bp-1",
      display_name: "Great Lakes Packaging",
      country: "United States",
      region: "Ohio",
      website: "greatlakespackaging.example",
      industry: "Packaging",
      named_people: 1,
      verified_channels: 1,
      last_signal_at: "2026-09-24T00:00:00Z",
      last_contact_seen_at: "2026-10-01T00:00:00Z",
    },
  ];
  const contactRows = [
    {
      buyer_profile_id: "bp-1",
      buyer_name: "Great Lakes Packaging",
      country: "United States",
      website: "greatlakespackaging.example",
      full_name: "Dana Whitfield",
      job_title: "Director",
      department: "Procurement",
      channel_type: "email",
      value: "procurement@greatlakespackaging.example",
      confidence_label: "confirmed",
      identity_match: "department",
      deliverability: "not_checked",
      is_verified: true,
      requires_override: false,
      source_url: "https://greatlakespackaging.example/contact",
      last_seen_at: "2026-10-01T00:00:00Z",
    },
  ];
  const mapped = api.toBuyerList(summary, contactRows, new Map([["bp-1", 2]]));
  check("map dữ liệu view sang danh sách", mapped.buyers.length === 1 && mapped.contacts.length === 1);
  check("đếm kênh xuất được từ chính dữ liệu", mapped.buyers[0].exportableChannels === 1);
  check("đếm kênh bị giữ lại", mapped.buyers[0].withheldChannels === 2);
  check("số người và số kênh đã xác minh đọc đúng", mapped.buyers[0].namedPeople === 1 && mapped.buyers[0].verifiedChannels === 1);
  check("tên người và chức danh giữ nguyên", mapped.contacts[0].personName === "Dana Whitfield" && mapped.contacts[0].jobTitle === "Director");
  const mappedCsv = api.buildBuyerCsv(mapped);
  check("CSV từ dữ liệu thật có nguồn", mappedCsv.includes("https://greatlakespackaging.example/contact"));
  check("CSV từ dữ liệu thật có cờ verified", mappedCsv.includes(",yes,"));

  await rm(workDir, { recursive: true, force: true });
  console.log(`\n${passed} check pass, ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
