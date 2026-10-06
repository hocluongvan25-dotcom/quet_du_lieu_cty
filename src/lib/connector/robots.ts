/**
 * robots.txt — tôn trọng như một điều kiện của connector, không phải tuỳ chọn.
 * Không đọc được robots.txt thì coi như không có giới hạn (thông lệ), nhưng
 * mọi Disallow đọc được đều phải chặn.
 */

export type RobotsRules = {
  allow: string[];
  disallow: string[];
  hasRules: boolean;
};

const EMPTY: RobotsRules = { allow: [], disallow: [], hasRules: false };

export function parseRobots(text: string, userAgent = "*"): RobotsRules {
  const lines = text.split(/\r?\n/);
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | undefined;
  let expectingAgent = false;

  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index === -1) continue;
    const field = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();

    if (field === "user-agent") {
      if (!current || !expectingAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      expectingAgent = true;
      continue;
    }

    if (!current) continue;
    expectingAgent = false;
    if (field === "allow") current.allow.push(value);
    if (field === "disallow") current.disallow.push(value);
  }

  const ua = userAgent.toLowerCase();
  const matching = groups.filter((group) => group.agents.some((agent) => agent === ua));
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const chosen = matching.length > 0 ? matching : wildcard;
  if (chosen.length === 0) return EMPTY;

  return {
    allow: chosen.flatMap((group) => group.allow),
    disallow: chosen.flatMap((group) => group.disallow),
    hasRules: true,
  };
}

function matchLength(rule: string, path: string): number {
  if (rule === "") return -1;
  const pattern = rule.replace(/\*$/, "");
  if (pattern === "/") return 0;
  return path.startsWith(pattern) ? pattern.length : -1;
}

/** Quy tắc dài hơn thắng; bằng nhau thì Allow thắng. */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  if (!rules.hasRules) return true;
  const pathname = path.startsWith("/") ? path.split("?")[0] : `/${path.split("?")[0]}`;

  let allowed = -1;
  let disallowed = -1;
  rules.allow.forEach((rule) => {
    allowed = Math.max(allowed, matchLength(rule, pathname));
  });
  rules.disallow.forEach((rule) => {
    disallowed = Math.max(disallowed, matchLength(rule, pathname));
  });

  if (disallowed === -1) return true;
  return allowed >= disallowed;
}
