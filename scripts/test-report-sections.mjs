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

const entry = `export * from "@/lib/report-sections";\nexport { marianiReport } from "@/lib/demo-mariani";\nexport { createDemoReport } from "@/lib/demo-data";\n`;

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const bundlePath = path.join(workDir, "bundle.mjs");
await writeFile(path.join(workDir, "entry.ts"), entry, "utf8");

await bundleTs(path.join(workDir, "entry.ts"), bundlePath);

const { buildReportSections, marianiReport } = await import(pathToFileURL(bundlePath).href);

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

console.log(`\n${passed} check pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
