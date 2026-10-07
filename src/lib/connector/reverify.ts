/**
 * Đọc lại một kênh đã tìm thấy, ở đúng trang đã thấy nó (cổng Freshness).
 *
 * ## Vì sao tách khỏi connector
 *
 * Connector làm việc nặng: khám phá cả website, xếp hạng trang, đọc PDF. Đọc lại
 * chỉ cần **mở đúng một trang** và trả lời một câu: giá trị này còn ở đó không?
 * Giữ hai việc tách nhau thì mỗi thứ kiểm được riêng, và job đọc lại chạy được
 * trên hàng nghìn kênh mà không kéo theo cả bộ khám phá.
 *
 * ## Ba câu trả lời, không phải hai
 *
 *   `still_present` — mở được trang, **vẫn thấy đúng giá trị đó**.
 *   `gone`          — mở được trang, giá trị **không còn ở đó nữa**.
 *   `unreachable`   — **không mở được trang** (mạng, 404, robots chặn, đăng nhập).
 *
 * `unreachable` **không phải** là "không còn". Một lần mạng lỗi mà hạ kênh của
 * khách hàng xuống là dùng sự cố của mình để nói dối về dữ liệu của họ. Lần chạy
 * sau sẽ thử lại; hạn của kênh vẫn tính theo lần cuối **thực sự** thấy nó.
 *
 * Việc "giá trị đã đổi" không được đoán ở đây: lần chạy lại chỉ trả lời còn hay
 * không còn. Nếu trang đổi sang giá trị khác thì giá trị cũ trở thành `gone`, và
 * connector — chạy theo nhịp riêng — sẽ tìm ra giá trị mới như một kênh mới.
 * Nhờ vậy mỗi lần đọc lại chỉ phải trả lời một câu hỏi mà nó trả lời chắc được.
 */

import type { ConnectorResult, FoundChannel } from "./types";
import { fetchPage } from "./fetch";

export type ReverificationOutcome = "still_present" | "gone" | "unreachable";

export type ChannelForReverification = {
  channelId: string;
  channelType: FoundChannel["type"];
  value: string;
  sourceUrl: string;
  /** Câu chữ đã thấy giá trị lần trước — để đối chiếu chính xác hơn là so chuỗi. */
  expectedEvidence?: string | null;
};

export type ReverificationAnswer = {
  channelId: string;
  outcome: ReverificationOutcome;
  sourceUrl: string;
  /** Nguyên văn dòng tìm thấy ở lần này. Không có khi không thấy nữa. */
  evidenceSnippet?: string | null;
  /** Vì sao không mở được, hoặc vì sao đáng ngờ — chỉ để người kiểm đọc, không hiện cho người dùng. */
  reason?: string | null;
};

/**
 * Chuẩn hoá để so: bỏ khoảng trắng và dấu phân cách trong số điện thoại, viết
 * thường, bỏ dấu `/` cuối của URL. "707-452-2800" và "7074522800" là cùng một số;
 * nếu so thô thì lần đọc lại nào cũng báo "không còn".
 */
export function sameValue(a: string, b: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s()\-.]/g, "").replace(/\/+$/, "");
  return normalize(a) === normalize(b);
}

/** Cách so phụ thuộc loại kênh: điện thoại có nhiều kiểu viết, email thì không. */
export function valueAppears(text: string, channelType: FoundChannel["type"], value: string): boolean {
  const haystack = text.toLowerCase();
  const needle = value.toLowerCase().trim();
  if (!needle) return false;

  if (channelType === "phone") {
    // Điện thoại: so theo dãy chữ số, vì cùng một số có thể được viết lại khác đi.
    const digits = (value.match(/\d/g) ?? []).join("");
    if (digits.length < 7) return false;
    const haystackDigits = (text.match(/\d/g) ?? []).join("");
    return haystackDigits.includes(digits);
  }

  if (channelType === "email") return haystack.includes(needle);
  // LinkedIn / form / WhatsApp: so trên URL đã bỏ dấu / cuối.
  return haystack.includes(needle.replace(/\/+$/, ""));
}

/** Tìm dòng nào trên văn bản chứa giá trị — để trích làm bằng chứng. */
export function evidenceLineFor(lines: string[], channelType: FoundChannel["type"], value: string): string | null {
  for (const line of lines) {
    if (!line.trim()) continue;
    if (valueAppears(line, channelType, value)) return line.replace(/\s+/g, " ").trim().slice(0, 220);
  }
  return null;
}

export type ReverificationDeps = {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  guard?: (url: string) => Promise<unknown>;
  log?: (message: string) => void;
};

/**
 * Đọc lại một kênh. Không ném lỗi ra ngoài: mọi trục trặc đều thành `unreachable`
 * kèm lý do, vì job đọc lại hàng nghìn kênh mà một trang hỏng không được làm
 * dừng cả lượt chạy.
 */
export async function reverifyChannel(
  channel: ChannelForReverification,
  deps: ReverificationDeps = {},
): Promise<ReverificationAnswer> {
  const { fetchImpl, userAgent, guard, log = () => {} } = deps;

  const outcome = await fetchPage(channel.sourceUrl, { fetchImpl, userAgent, guard });
  if (!outcome.ok) {
    const reason = outcome.loginWall
      ? "trang yêu cầu đăng nhập — không đọc"
      : (outcome.reason ?? "không mở được trang");
    log(`  ? ${channel.value} — ${reason}`);
    return { channelId: channel.channelId, outcome: "unreachable", sourceUrl: channel.sourceUrl, reason };
  }

  const text = outcome.body;
  const found = valueAppears(text, channel.channelType, channel.value);

  if (!found) {
    log(`  − ${channel.value} — không còn thấy trên ${channel.sourceUrl}`);
    return { channelId: channel.channelId, outcome: "gone", sourceUrl: outcome.finalUrl };
  }

  // Trích nguyên văn dòng chứa giá trị. Nếu HTML không xuống dòng (thường gặp),
  // cắt quanh vị trí tìm thấy để vẫn có một câu người kiểm đọc được.
  const lines = text.split(/\r?\n/);
  let evidence: string | null = evidenceLineFor(lines, channel.channelType, channel.value);
  if (!evidence) {
    const index = text.toLowerCase().indexOf(channel.value.toLowerCase().trim());
    evidence = index >= 0 ? text.slice(Math.max(0, index - 80), index + 120).replace(/\s+/g, " ").trim() : null;
  }

  // Dấu hiệu đáng ngờ: giá trị còn trên trang nhưng câu chữ quanh nó đã khác hẳn
  // — trang có thể đã đổi. Vẫn ghi là còn thấy (đó là sự thật), kèm câu chữ mới.
  const expected = channel.expectedEvidence?.trim();
  const evidenceChanged = Boolean(expected && evidence && !sameValue(expected, evidence) && !evidence.includes(expected));

  log(`  ✓ ${channel.value} — vẫn còn${evidenceChanged ? " (câu chữ quanh nó đã khác)" : ""}`);
  return {
    channelId: channel.channelId,
    outcome: "still_present",
    sourceUrl: outcome.finalUrl,
    evidenceSnippet: evidence,
    reason: evidenceChanged ? "câu chữ quanh giá trị đã khác lần trước" : undefined,
  };
}

/** Đọc lại lần lượt, có nghỉ giữa các lần tải để không ép máy chủ của họ. */
export async function reverifyChannels(
  channels: ChannelForReverification[],
  deps: ReverificationDeps & { delayMs?: number } = {},
): Promise<ReverificationAnswer[]> {
  const { delayMs = 300, log = () => {} } = deps;
  const answers: ReverificationAnswer[] = [];

  for (const channel of channels) {
    answers.push(await reverifyChannel(channel, deps));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  log(`đọc lại ${answers.length} kênh: ${answers.filter((answer) => answer.outcome === "still_present").length} vẫn còn, ${answers.filter((answer) => answer.outcome === "gone").length} không còn, ${answers.filter((answer) => answer.outcome === "unreachable").length} không mở được`);
  return answers;
}

/** Chuyển câu trả lời thành tham số cho `record_contact_reverification`. */
export function toReverificationRecord(answer: ReverificationAnswer) {
  return {
    p_channel_id: answer.channelId,
    p_outcome: answer.outcome,
    p_source_url: answer.sourceUrl,
    p_evidence_snippet: answer.evidenceSnippet ?? null,
    p_note: answer.reason ?? null,
  };
}

/** Tóm tắt một lượt chạy, để API trả về và log đọc được. */
export function summarizeReverification(answers: ReverificationAnswer[]) {
  return {
    checked: answers.length,
    stillPresent: answers.filter((answer) => answer.outcome === "still_present").length,
    gone: answers.filter((answer) => answer.outcome === "gone").length,
    unreachable: answers.filter((answer) => answer.outcome === "unreachable").length,
  };
}

/** Kiểu tối thiểu của một kết quả connector — dùng khi đọc lại kết quả vừa cào. */
export type { ConnectorResult };
