/**
 * Chia nội dung một report thành các phần để hiển thị.
 *
 * Quy tắc:
 *  - Kênh chung của công ty (website, LinkedIn, điện thoại, email chung) nằm ở khối công ty.
 *  - Kênh của một người — dù tìm thấy trên LinkedIn hay trong một email công bố kèm tên —
 *    thuộc về **thẻ của người đó**, không đứng riêng một mình. Một email kèm tên mà không
 *    có thẻ người là thông tin nửa vời: người dùng phải biết đang viết cho ai.
 *  - Email bộ phận / không gắn được tên nằm ở khối dưới.
 *
 * Hàm thuần: không mạng, không React, chạy được ở server và trong test.
 */

import type { CompanyReport, Contact, DecisionMaker, PersonChannel } from "@/lib/demo-data";

export type ReportSections = {
  companyChannels: Contact[];
  departmentChannels: Contact[];
  people: DecisionMaker[];
};

const PERSON_CHANNEL_TYPES: PersonChannel["type"][] = ["email", "phone", "linkedin"];

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Dự phòng khi pipeline chưa điền `personName`: nhãn công bố thường có dạng
 * "Email công bố theo vùng — Steve Sousa", phần sau dấu gạch chính là tên.
 * Chỉ nhận khi nó trông giống một tên người (2–4 từ), không nhận cả câu.
 */
function nameFromLabel(label: string): string | null {
  const parts = label.split(/—|–|\||·/);
  if (parts.length < 2) return null;
  const candidate = parts[parts.length - 1].trim();
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  if (/\d|@/.test(candidate)) return null;
  return candidate;
}

function toPersonChannel(contact: Contact): PersonChannel | null {
  if (!PERSON_CHANNEL_TYPES.includes(contact.type as PersonChannel["type"])) return null;
  return {
    type: contact.type as PersonChannel["type"],
    value: contact.value,
    certainty: contact.certainty ?? "confirmed",
    policy: contact.policy ?? "manual_contact_only",
  };
}

export function buildReportSections(report: CompanyReport): ReportSections {
  const contacts = report.contacts ?? [];
  const companyChannels: Contact[] = [];
  const departmentChannels: Contact[] = [];
  const people: DecisionMaker[] = (report.people ?? []).map((person) => ({ ...person, channels: [...person.channels] }));

  for (const contact of contacts) {
    const identity = contact.identityMatch ?? "company_general";

    if (identity === "company_general") {
      companyChannels.push(contact);
      continue;
    }

    if (identity !== "person") {
      departmentChannels.push(contact);
      continue;
    }

    const name = (contact.personName ?? "").trim() || nameFromLabel(contact.label);
    const channel = toPersonChannel(contact);
    if (!name || !channel) {
      departmentChannels.push(contact);
      continue;
    }

    const existing = people.find((person) => normaliseName(person.name) === normaliseName(name));
    if (existing) {
      if (!existing.channels.some((item) => item.value === channel.value)) existing.channels.push(channel);
      if (!existing.title && contact.personTitle) existing.title = contact.personTitle;
      continue;
    }

    people.push({
      id: `published-${normaliseName(name).replace(/\s+/g, "-")}`,
      name,
      title: contact.personTitle ?? contact.via ?? "",
      department: "",
      identityMatch: "person",
      certainty: contact.certainty ?? "confirmed",
      sourceLabel: contact.source,
      sourceUrl: contact.sourceUrl ?? "",
      lastSeenAt: "",
      channels: [channel],
    });
  }

  return { companyChannels, departmentChannels, people };
}
