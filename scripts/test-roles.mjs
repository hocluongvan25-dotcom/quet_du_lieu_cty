#!/usr/bin/env node
/**
 * Kiểm bộ phân loại chức danh (`src/lib/roles.ts`) — cổng Role.
 *
 *   npm run roles:test
 *
 * Điểm dễ sai nhất không phải "nhận ra chữ procurement", mà là **thứ tự ưu
 * tiên**: "Procurement Director" là người mua hàng, không phải ban lãnh đạo;
 * "Sales Director" là kinh doanh. Đổi thứ tự kiểm tra là đổi kết quả, nên nó
 * được khoá bằng test.
 *
 * Và: `other` (có chức danh, không thuộc nhóm nào) phải khác `unknown` (chưa
 * tìm được chức danh) — gộp hai thứ đó lại là làm mất thông tin.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleTs } from "./lib/ts-module.mjs";

const root = process.cwd();
const workDir = path.join(root, ".roles-test");

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

async function main() {
  await mkdir(workDir, { recursive: true });
  const entryPath = path.join(workDir, "entry.ts");
  const bundlePath = path.join(workDir, "bundle.mjs");
  await writeFile(
    entryPath,
    `import { classifyRole, isBuyingRole, roleLabel, ROLE_KINDS, BUYING_ROLES } from "@/lib/roles";
export const api = { classifyRole, isBuyingRole, roleLabel, ROLE_KINDS, BUYING_ROLES };
`,
    "utf8",
  );
  await bundleTs(entryPath, bundlePath, { alias: false });
  const { api } = await import(pathToFileURL(bundlePath).href);
  const { classifyRole } = api;

  section("nhóm mua hàng");
  check("Purchasing Manager", classifyRole("Purchasing Manager") === "purchasing");
  check("Procurement Manager", classifyRole("Procurement Manager") === "procurement");
  check("Sourcing Specialist", classifyRole("Sourcing Specialist") === "sourcing");
  check("Commodity Buyer", classifyRole("Commodity Buyer") === "sourcing");
  check("Category Manager tính là mua hàng", classifyRole("Category Manager") === "purchasing");
  check("Supply Chain Manager", classifyRole("Supply Chain Manager") === "supply_chain");
  check("Demand Planner", classifyRole("Demand Planner") === "supply_chain");

  section("thứ tự ưu tiên — chỗ dễ sai nhất");
  check("Procurement Director là thu mua, không phải ban lãnh đạo", classifyRole("Procurement Director") === "procurement");
  check("Director of Purchasing là mua hàng", classifyRole("Director of Purchasing") === "purchasing");
  check("Sales Director là kinh doanh", classifyRole("Sales Director") === "sales");
  check("Head of Quality là chất lượng", classifyRole("Head of Quality") === "quality");
  check("Import Manager là logistics/xuất nhập khẩu", classifyRole("Import Manager") === "logistics");

  section("nhóm khác");
  check("Quality Assurance Manager", classifyRole("Quality Assurance Manager") === "quality");
  check("Food Safety Officer", classifyRole("Food Safety Officer") === "quality");
  check("Export Manager là logistics", classifyRole("Export Manager") === "logistics");
  check("VP Sales là kinh doanh", classifyRole("VP Sales") === "sales");
  check("Chief Executive Officer là ban lãnh đạo", classifyRole("Chief Executive Officer") === "management");
  check("Founder là ban lãnh đạo", classifyRole("Founder") === "management");
  check("Giám đốc (tiếng Việt) là ban lãnh đạo", classifyRole("Giám đốc") === "management");
  check("Trưởng phòng thu mua (tiếng Việt)", classifyRole("Trưởng phòng thu mua") === "procurement");

  section("không có chức danh ≠ chức danh lạ");
  check("không có gì → unknown", classifyRole() === "unknown" && classifyRole("") === "unknown" && classifyRole(null, null) === "unknown");
  check("có chức danh nhưng không khớp nhóm → other", classifyRole("Barista") === "other");
  check("khoảng trắng cũng là unknown", classifyRole("   ") === "unknown");

  section("bộ phận cũng được dùng khi thiếu chức danh");
  check("chỉ có bộ phận Procurement", classifyRole(null, "Procurement") === "procurement");
  check("chức danh cụ thể thắng bộ phận", classifyRole("Sales Manager", "Procurement") === "sales");
  check("chức danh chung chung thì bộ phận quyết định", classifyRole("Manager", "Procurement") === "procurement");
  check("chức danh chung chung + bộ phận chung chung → management", classifyRole("Director", "Operations") === "management");

  section("hệ quả của phân loại");
  check("procurement/purchasing/sourcing/supply_chain qua cổng Role", ["procurement", "purchasing", "sourcing", "supply_chain"].every((kind) => api.isBuyingRole(kind)));
  check("sales/quality/management/other/unknown không qua cổng Role", !["sales", "quality", "management", "other", "unknown"].every((kind) => api.isBuyingRole(kind)));
  check("mọi giá trị trả về đều nằm trong ROLE_KINDS", ["Purchasing Manager", "Barista", "", "Giám đốc"].every((title) => api.ROLE_KINDS.includes(classifyRole(title))));

  section("nhãn hiển thị");
  check("có nhãn tiếng Việt và tiếng Anh cho mọi nhóm", api.ROLE_KINDS.every((kind) => api.roleLabel(kind, "vi") && api.roleLabel(kind, "en")));
  check(
    "nhãn không mang lời khuyên (spec §10)",
    api.ROLE_KINDS.map((kind) => `${api.roleLabel(kind, "vi")} ${api.roleLabel(kind, "en")}`).every((label) => !/nên |gợi ý|ưu tiên|liên hệ ngay|khuyến nghị/i.test(label)),
  );
  check("nhãn lạ không làm vỡ giao diện", api.roleLabel("không-tồn-tại", "vi") === "Chưa rõ chức danh");

  await rm(workDir, { recursive: true, force: true });
  console.log(`\n${passed} check pass, ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
