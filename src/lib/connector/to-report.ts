/**
 * Chuyển kết quả connector sang định dạng report đã chốt (spec §9).
 *
 * `verified` cố tình để false: connector mới chỉ chứng minh được "giá trị này có
 * trên trang công khai", chưa chứng minh "hộp thư này là của đúng người". Hai
 * chuyện đó khác nhau, và UI không được phép trộn.
 */

import type { DecisionMaker, IntelNote, Contact } from "@/lib/demo-data";
import type { ConnectorResult, FoundChannel } from "./types";

const TYPE_LABELS: Record<FoundChannel["type"], string> = {
  email: "Email",
  phone: "Điện thoại",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  form: "Biểu mẫu",
  link: "Liên kết",
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function channelToContact(channel: FoundChannel): Contact {
  return {
    label: channel.label || TYPE_LABELS[channel.type],
    value: channel.value,
    type: channel.type === "whatsapp" ? "whatsapp" : channel.type === "form" || channel.type === "link" ? "website" : channel.type,
    verified: channel.policy === "outreach_ready",
    source: hostOf(channel.sourceUrl),
    certainty: channel.certainty,
    identityMatch: channel.identityMatch,
    personName: channel.personName,
    personTitle: channel.personTitle,
    policy: channel.policy,
    sourceUrl: channel.sourceUrl,
    via: channel.evidenceSnippet,
  };
}

export function channelsToContacts(result: ConnectorResult): Contact[] {
  return result.channels.map(channelToContact);
}

export function resultToPeople(result: ConnectorResult): DecisionMaker[] {
  return result.people.map((person) => ({
    id: person.id,
    name: person.name,
    title: person.title ?? "",
    department: "",
    identityMatch: "person",
    certainty: "confirmed",
    sourceLabel: hostOf(person.sourceUrl),
    sourceUrl: person.sourceUrl,
    lastSeenAt: new Date().toISOString().slice(0, 10),
    channels: person.channelValues.map((value) => ({
      type: value.includes("@") ? ("email" as const) : ("linkedin" as const),
      value,
      certainty: "confirmed" as const,
      policy: value.includes("@") ? ("needs_mailbox_check" as const) : ("manual_contact_only" as const),
    })),
  }));
}

export function resultToNotes(result: ConnectorResult): IntelNote[] {
  return result.notes.map((note) => ({
    kind: note.kind === "not_found" ? "not_found" : "excluded",
    label: note.label,
    detail: note.detail,
    sourceUrl: note.sourceUrl,
  }));
}
