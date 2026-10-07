/**
 * Số điện thoại → E.164, và đường tới WhatsApp.
 *
 * ## Vì sao không phải cứ thêm "+" là xong
 *
 * Yêu cầu: "parse số điện thoại về E.164 (có mã quốc gia `+...`)". Làm được —
 * nhưng chỉ khi **biết quốc gia** của số đó. Một trang web công ty hay in
 * `707-452-2800` mà không nói số này ở đâu; tự thêm `+1` cho nó là **đoán**.
 *
 * Đoán sai ở đây không chỉ là dữ liệu xấu: số E.164 là thứ dùng để gọi và để mở
 * `wa.me/<số>`. Một mã quốc gia sai sẽ mở cuộc trò chuyện với **một người lạ**.
 * Vì vậy quy tắc của module này:
 *
 *   1. Số đã có `+` hoặc bắt đầu bằng `00` → đã là quốc tế, chỉ việc làm sạch.
 *   2. Số nội địa **và biết quốc gia** (người dùng nhập, hoặc sau này là tờ khai
 *      hải quan) → cắt số `0` đầu theo đúng thông lệ của nước đó rồi ghép mã
 *      quốc gia. Đây là suy ra từ một dữ kiện mình đang có, không phải đoán.
 *   3. Số nội địa **mà không biết quốc gia** → **không** thêm mã quốc gia. Trả về
 *      lý do, giữ nguyên số như đã công bố.
 *
 * Cùng tinh thần với phần còn lại: thà thiếu một trường hơn là có một trường sai.
 */

/** Ghi chú: `trunkPrefixes` là số phải bỏ khi chuyển sang quốc tế. */
export type CountryDialing = {
  iso2: string;
  /** Tên tiếng Anh, để hiện lý do cho người đọc. */
  name: string;
  callingCode: string;
  /** Thường là "0"; Ý và Tây Ban Nha không có, Nga dùng "8", Hungary "06". */
  trunkPrefixes: string[];
};

/**
 * Bảng nhỏ, chỉ gồm những nước thực sự xuất hiện trong luồng này: nhà nhập khẩu
 * ở các thị trường xuất khẩu chính, cộng các nước láng giềng của Việt Nam.
 * Không đủ thì trả "chưa biết quốc gia" — vẫn đúng hơn là đoán.
 */
export const COUNTRIES: CountryDialing[] = [
  { iso2: "VN", name: "Việt Nam", callingCode: "84", trunkPrefixes: ["0"] },
  { iso2: "US", name: "United States", callingCode: "1", trunkPrefixes: [] },
  { iso2: "CA", name: "Canada", callingCode: "1", trunkPrefixes: [] },
  { iso2: "GB", name: "United Kingdom", callingCode: "44", trunkPrefixes: ["0"] },
  { iso2: "IE", name: "Ireland", callingCode: "353", trunkPrefixes: ["0"] },
  { iso2: "DE", name: "Germany", callingCode: "49", trunkPrefixes: ["0"] },
  { iso2: "FR", name: "France", callingCode: "33", trunkPrefixes: ["0"] },
  { iso2: "IT", name: "Italy", callingCode: "39", trunkPrefixes: [] },
  { iso2: "ES", name: "Spain", callingCode: "34", trunkPrefixes: [] },
  { iso2: "PT", name: "Portugal", callingCode: "351", trunkPrefixes: [] },
  { iso2: "NL", name: "Netherlands", callingCode: "31", trunkPrefixes: ["0"] },
  { iso2: "BE", name: "Belgium", callingCode: "32", trunkPrefixes: ["0"] },
  { iso2: "CH", name: "Switzerland", callingCode: "41", trunkPrefixes: ["0"] },
  { iso2: "AT", name: "Austria", callingCode: "43", trunkPrefixes: ["0"] },
  { iso2: "SE", name: "Sweden", callingCode: "46", trunkPrefixes: ["0"] },
  { iso2: "DK", name: "Denmark", callingCode: "45", trunkPrefixes: [] },
  { iso2: "NO", name: "Norway", callingCode: "47", trunkPrefixes: [] },
  { iso2: "FI", name: "Finland", callingCode: "358", trunkPrefixes: ["0"] },
  { iso2: "PL", name: "Poland", callingCode: "48", trunkPrefixes: [] },
  { iso2: "CZ", name: "Czechia", callingCode: "420", trunkPrefixes: [] },
  { iso2: "GR", name: "Greece", callingCode: "30", trunkPrefixes: [] },
  { iso2: "RO", name: "Romania", callingCode: "40", trunkPrefixes: ["0"] },
  { iso2: "RU", name: "Russia", callingCode: "7", trunkPrefixes: ["8"] },
  { iso2: "UA", name: "Ukraine", callingCode: "380", trunkPrefixes: ["0"] },
  { iso2: "TR", name: "Türkiye", callingCode: "90", trunkPrefixes: ["0"] },
  { iso2: "IL", name: "Israel", callingCode: "972", trunkPrefixes: ["0"] },
  { iso2: "AE", name: "United Arab Emirates", callingCode: "971", trunkPrefixes: ["0"] },
  { iso2: "SA", name: "Saudi Arabia", callingCode: "966", trunkPrefixes: ["0"] },
  { iso2: "EG", name: "Egypt", callingCode: "20", trunkPrefixes: ["0"] },
  { iso2: "ZA", name: "South Africa", callingCode: "27", trunkPrefixes: ["0"] },
  { iso2: "CN", name: "China", callingCode: "86", trunkPrefixes: ["0"] },
  { iso2: "HK", name: "Hong Kong", callingCode: "852", trunkPrefixes: [] },
  { iso2: "TW", name: "Taiwan", callingCode: "886", trunkPrefixes: ["0"] },
  { iso2: "JP", name: "Japan", callingCode: "81", trunkPrefixes: ["0"] },
  { iso2: "KR", name: "South Korea", callingCode: "82", trunkPrefixes: ["0"] },
  { iso2: "IN", name: "India", callingCode: "91", trunkPrefixes: ["0"] },
  { iso2: "PK", name: "Pakistan", callingCode: "92", trunkPrefixes: ["0"] },
  { iso2: "BD", name: "Bangladesh", callingCode: "880", trunkPrefixes: ["0"] },
  { iso2: "TH", name: "Thailand", callingCode: "66", trunkPrefixes: ["0"] },
  { iso2: "LA", name: "Laos", callingCode: "856", trunkPrefixes: ["0"] },
  { iso2: "KH", name: "Cambodia", callingCode: "855", trunkPrefixes: ["0"] },
  { iso2: "MM", name: "Myanmar", callingCode: "95", trunkPrefixes: ["0"] },
  { iso2: "MY", name: "Malaysia", callingCode: "60", trunkPrefixes: ["0"] },
  { iso2: "SG", name: "Singapore", callingCode: "65", trunkPrefixes: [] },
  { iso2: "ID", name: "Indonesia", callingCode: "62", trunkPrefixes: ["0"] },
  { iso2: "PH", name: "Philippines", callingCode: "63", trunkPrefixes: ["0"] },
  { iso2: "AU", name: "Australia", callingCode: "61", trunkPrefixes: ["0"] },
  { iso2: "NZ", name: "New Zealand", callingCode: "64", trunkPrefixes: ["0"] },
  { iso2: "BR", name: "Brazil", callingCode: "55", trunkPrefixes: ["0"] },
  { iso2: "AR", name: "Argentina", callingCode: "54", trunkPrefixes: ["0"] },
  { iso2: "CL", name: "Chile", callingCode: "56", trunkPrefixes: [] },
  { iso2: "MX", name: "Mexico", callingCode: "52", trunkPrefixes: [] },
  { iso2: "PE", name: "Peru", callingCode: "51", trunkPrefixes: ["0"] },
  { iso2: "CO", name: "Colombia", callingCode: "57", trunkPrefixes: ["0"] },
];

const BY_ISO = new Map(COUNTRIES.map((entry) => [entry.iso2, entry]));

/** Cách người dùng thật sự viết tên nước, kể cả không dấu. */
const NAME_ALIASES: Record<string, string> = {
  vn: "VN",
  vietnam: "VN",
  "viet nam": "VN",
  "viet nam chxhcn": "VN",
  "cộng hòa xã hội chủ nghĩa việt nam": "VN",
  us: "US",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "united states": "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  "united kingdom": "GB",
  scotland: "GB",
  wales: "GB",
  deutschland: "DE",
  germany: "DE",
  italia: "IT",
  italy: "IT",
  espana: "ES",
  "españa": "ES",
  spain: "ES",
  holland: "NL",
  netherlands: "NL",
  "the netherlands": "NL",
  korea: "KR",
  "south korea": "KR",
  "korea, republic of": "KR",
  "republic of korea": "KR",
  china: "CN",
  "prc": "CN",
  "hong kong": "HK",
  taiwan: "TW",
  japan: "JP",
  india: "IN",
  thailand: "TH",
  "thaïlande": "TH",
  laos: "LA",
  "lao pdr": "LA",
  cambodia: "KH",
  myanmar: "MM",
  burma: "MM",
  malaysia: "MY",
  singapore: "SG",
  indonesia: "ID",
  philippines: "PH",
  "the philippines": "PH",
  australia: "AU",
  "new zealand": "NZ",
  brazil: "BR",
  brasil: "BR",
  mexico: "MX",
  "méxico": "MX",
  turkey: "TR",
  türkiye: "TR",
  turkiye: "TR",
  russia: "RU",
  "russian federation": "RU",
  ukraine: "UA",
  poland: "PL",
  egypt: "EG",
  "south africa": "ZA",
  uae: "AE",
  "united arab emirates": "AE",
  "saudi arabia": "SA",
  israel: "IL",
};

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .replace(/^the /, "");
}

/**
 * Bỏ dấu để "Việt Nam" khớp "viet nam". `đ` không tách được bằng NFD (nó là
 * chữ cái riêng, không phải d + dấu), nên đổi tay.
 */
export function stripDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/**
 * Nhận mã ISO (`VN`, `vn`), tên tiếng Anh (`Vietnam`) hoặc tên người Việt hay
 * dùng (`Việt Nam`, `Hoa Kỳ`… nằm trong bảng tên đồng nghĩa). Không chắc thì
 * trả `null` — chỗ gọi phải xử lý được `null`, đó là lý do hàm này tồn tại.
 */
export function resolveCountry(input?: string | null): CountryDialing | null {
  if (!input) return null;
  const raw = input.trim();
  const byIso = BY_ISO.get(raw.toUpperCase());
  if (byIso) return byIso;

  const cleaned = normalizeName(raw);
  if (!cleaned) return null;
  const plain = stripDiacritics(cleaned);

  // Tên nước trong chính bảng này ("Việt Nam", "Türkiye") — có dấu hay không.
  for (const entry of COUNTRIES) {
    const name = normalizeName(entry.name);
    if (name === cleaned || stripDiacritics(name) === plain) return entry;
  }

  const alias = NAME_ALIASES[cleaned] ?? NAME_ALIASES[plain];
  if (alias) return BY_ISO.get(alias) ?? null;

  // "Viet Nam" / "Vietnam," vẫn khớp sau khi bỏ dấu cách.
  const compact = plain.replace(/\s/g, "");
  for (const [key, iso2] of Object.entries(NAME_ALIASES)) {
    if (stripDiacritics(key).replace(/\s/g, "") === compact) return BY_ISO.get(iso2) ?? null;
  }

  return null;
}

export type E164Result =
  | { ok: true; value: string; note: string }
  | { ok: false; reason: string };

const DIGITS = /^[0-9]+$/;

/**
 * Kiểm tra một chuỗi đã đúng dạng E.164 chưa: `+`, chữ số đầu khác 0, tổng
 * 8–15 chữ số (giới hạn của E.164).
 */
export function isE164(value: string): boolean {
  if (!value.startsWith("+")) return false;
  const digits = value.slice(1);
  if (!DIGITS.test(digits)) return false;
  if (digits.length < 8 || digits.length > 15) return false;
  return digits[0] !== "0";
}

function onlyDigits(value: string): string {
  return (value.match(/\d/g) ?? []).join("");
}

/**
 * Chuẩn hoá một số điện thoại đã đọc được trên trang công khai.
 *
 * `country` là quốc gia **của công ty**, không phải quốc gia suy từ số.
 */
export function toE164(raw: string, country?: string | null): E164Result {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "chuỗi rỗng" };

  const digits = onlyDigits(trimmed);
  if (digits.length < 6) return { ok: false, reason: "quá ngắn để là số điện thoại" };

  // (1) Đã là số quốc tế: có dấu +, hoặc viết theo lối 00.
  const startsWithPlus = trimmed.startsWith("+");
  const startsWithZeroZero = trimmed.startsWith("00");
  if (startsWithPlus || startsWithZeroZero) {
    const candidate = `+${startsWithZeroZero ? digits.slice(2) : digits}`;
    if (!isE164(candidate)) {
      return { ok: false, reason: `số đã ghi theo dạng quốc tế nhưng không hợp lệ (${candidate.length - 1} chữ số)` };
    }
    return { ok: true, value: candidate, note: startsWithPlus ? "đã có mã quốc gia trên trang" : "viết theo lối 00, đổi thành +" };
  }

  // (2) Số nội địa: chỉ chuyển được khi biết quốc gia.
  const dialing = resolveCountry(country);
  if (!dialing) {
    return {
      ok: false,
      reason: country
        ? `chưa nhận ra quốc gia "${country}" nên không tự thêm mã quốc gia`
        : "chưa biết quốc gia của công ty nên không tự thêm mã quốc gia",
    };
  }

  let national = digits;
  let trunkUsed = "";
  for (const trunk of [...dialing.trunkPrefixes].sort((a, b) => b.length - a.length)) {
    if (trunk && national.startsWith(trunk)) {
      national = national.slice(trunk.length);
      trunkUsed = trunk;
      break;
    }
  }

  if (national.length < 5) {
    return { ok: false, reason: "phần số nội địa còn lại quá ngắn sau khi bỏ số 0 đầu" };
  }

  // Số in thiếu dấu + nhưng đã bắt đầu bằng chính mã quốc gia của nước đó
  // ("84 28 3822 1234"): đọc là số quốc tế, không ghép thêm mã lần nữa.
  const looksAlreadyInternational = national.startsWith(dialing.callingCode) && national.length >= dialing.callingCode.length + 7;
  const candidate = `+${looksAlreadyInternational ? national : dialing.callingCode + national}`;

  if (!isE164(candidate)) {
    return { ok: false, reason: `ghép mã quốc gia ${dialing.callingCode} xong không ra số hợp lệ (${candidate})` };
  }

  const note = looksAlreadyInternational
    ? `đã gồm mã quốc gia ${dialing.callingCode} dù thiếu dấu +`
    : `số nội địa ${dialing.name}${trunkUsed ? ` (bỏ số ${trunkUsed} đầu)` : ""} → +${dialing.callingCode}`;

  return { ok: true, value: candidate, note };
}

/**
 * Link mở cuộc trò chuyện WhatsApp. Chỉ dựng từ số E.164 — `wa.me` cần đúng
 * chữ số quốc tế, và một số sai sẽ mở chat với người lạ.
 */
export function whatsappLink(e164: string | null | undefined): string | null {
  if (!e164 || !isE164(e164)) return null;
  return `https://wa.me/${e164.slice(1)}`;
}
