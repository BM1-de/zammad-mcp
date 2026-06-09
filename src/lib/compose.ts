const WEEKDAYS_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const SELF_EMAILS = new Set(["support@bm1.de", "baumgaertner@bm1.de"]);

export function extractEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/<\s*([^>]+?)\s*>/);
  if (m) return m[1]!.trim();
  return raw.trim();
}

export function extractDisplayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/^\s*(.+?)\s*<[^>]+>\s*$/);
  if (m) return m[1]!.replace(/^"|"$/g, "").trim();
  return extractEmail(raw);
}

export function stripSubjectPrefix(subject: string | null | undefined): string {
  if (!subject) return "";
  let s = subject;
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/^\s*(RE|AW|FW|FWD|WG)\s*:\s*/i, "");
  }
  return s.trim();
}

export function filterSelfFromCc(cc: string | null | undefined, extraSelf: string[] = []): string[] {
  if (!cc) return [];
  const blocked = new Set<string>([...SELF_EMAILS, ...extraSelf.map((e) => e.toLowerCase())]);
  return cc
    .split(",")
    .map((part) => extractEmail(part))
    .filter((email) => email.length > 0 && !blocked.has(email.toLowerCase()));
}

export function ensureMessageIdBrackets(messageId: string | null | undefined): string {
  if (!messageId) return "";
  const trimmed = messageId.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, "")}>`;
}

interface BerlinParts {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  second: string;
}

export function formatBerlin(isoUtc: string): BerlinParts {
  const date = new Date(isoUtc);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  // Map weekday "Mon" → Index. Intl gives "Mon", "Tue", ...
  const wdShort = get("weekday");
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wdIdx = wdMap[wdShort] ?? 0;

  const monthIdx = parseInt(get("month"), 10) - 1;

  let hour = get("hour");
  // Intl in en-US with hour12:false sometimes returns "24" at midnight — normalize.
  if (hour === "24") hour = "00";

  return {
    weekday: WEEKDAYS_DE[wdIdx]!,
    day: get("day"),
    month: MONTHS_DE[monthIdx] ?? "",
    year: get("year"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

export function buildQuoteBlock(
  createdAtIsoUtc: string,
  fromHeader: string,
  originalBodyHtml: string,
): string {
  const d = formatBerlin(createdAtIsoUtc);
  const fromName = extractDisplayName(fromHeader) || extractEmail(fromHeader);
  return (
    `<div><blockquote type="cite">` +
    `Am ${d.weekday}, ${d.day}. ${d.month} ${d.year} um ${d.hour}:${d.minute}:${d.second}, schrieb ${fromName}:` +
    `<br><br>\n${originalBodyHtml}\n</blockquote></div>`
  );
}

export function composeFinalBody(
  replyHtml: string,
  signatureHtml: string,
  signatureId: number,
  quoteBlock: string,
): string {
  return [
    replyHtml,
    `<div data-signature="true" data-signature-id="${signatureId}">${signatureHtml}</div>`,
    `<div><br><br></div>`,
    quoteBlock,
  ].join("\n");
}
