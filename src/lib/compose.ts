export type QuoteLocale = "en" | "de";

const WEEKDAYS: Record<QuoteLocale, readonly string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
};

const MONTHS: Record<QuoteLocale, readonly string[]> = {
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  de: [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ],
};

const QUOTE_LEAD_IN: Record<QuoteLocale, (parts: BerlinParts, fromName: string) => string> = {
  en: (d, name) =>
    `On ${d.weekday}, ${parseInt(d.day, 10)} ${d.month} ${d.year} at ${d.hour}:${d.minute}:${d.second}, ${name} wrote:`,
  de: (d, name) =>
    `Am ${d.weekday}, ${d.day}. ${d.month} ${d.year} um ${d.hour}:${d.minute}:${d.second}, schrieb ${name}:`,
};

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

export interface MailAddress {
  /** Display name without quotes; empty when the entry has none. */
  name: string;
  email: string;
}

/**
 * Split an address-list header at its top-level separators. Commas inside quoted
 * display names, angle brackets or comments do not count; comments are dropped
 * and a group name ("Team: a@x.de, b@y.de;") is discarded. `;` separates too —
 * as group terminator and as the separator Outlook writes.
 * Returns `null` for an unbalanced header.
 */
function splitAddressList(header: string): string[] | null {
  const entries: string[] = [];
  let current = "";
  let inQuote = false;
  let inAngle = false;
  let commentDepth = 0;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i]!;
    if (inQuote) {
      current += ch;
      if (ch === "\\" && i + 1 < header.length) current += header[++i];
      else if (ch === '"') inQuote = false;
    } else if (commentDepth > 0) {
      if (ch === "\\") i++;
      else if (ch === "(") commentDepth++;
      else if (ch === ")") commentDepth--;
    } else if (ch === "(") {
      commentDepth = 1;
    } else if (!inAngle && (ch === "," || ch === ";")) {
      entries.push(current);
      current = "";
    } else if (!inAngle && ch === ":") {
      current = "";
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === "<") inAngle = true;
      else if (ch === ">") inAngle = false;
      current += ch;
    }
  }
  if (inQuote || inAngle || commentDepth > 0) return null;
  entries.push(current);
  return entries;
}

function unquoteDisplayName(raw: string): string {
  return raw
    .replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner: string) => inner.replace(/\\(.)/g, "$1"))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse an address-list header (To/Cc) per RFC 5322 into its mailboxes.
 * Entries without an address (group names, fragments) are skipped.
 */
export function parseAddressList(header: string | null | undefined): MailAddress[] {
  if (!header) return [];
  // An unbalanced header cannot be tokenised; a plain split still finds its addresses.
  const entries = splitAddressList(header) ?? header.split(/[,;]/);
  const result: MailAddress[] = [];
  for (const entry of entries) {
    const open = entry.lastIndexOf("<");
    const close = open === -1 ? -1 : entry.indexOf(">", open);
    const email = (close === -1 ? entry : entry.slice(open + 1, close)).trim();
    if (!/^\S+@\S+$/.test(email)) continue;
    result.push({ name: close === -1 ? "" : unquoteDisplayName(entry.slice(0, open)), email });
  }
  return result;
}

/**
 * Reply-All CC: every entry of the given To/Cc headers except the excluded
 * addresses (the agent's own, the reply's To recipient) and duplicates, as bare
 * addresses. Zammad's recipient field splits the draft's CC at every comma, even
 * inside a quoted display name — `"Mustermann, Erika" <e@ex.com>` would show up
 * as a broken recipient `"Mustermann`.
 */
export function filterSelfFromCc(
  headers: string | null | undefined | (string | null | undefined)[],
  exclude: string[] = [],
): string[] {
  const skip = new Set<string>(exclude.map((e) => e.toLowerCase()));
  const result: string[] = [];
  const list = Array.isArray(headers) ? headers : [headers];
  for (const addr of list.flatMap((header) => parseAddressList(header))) {
    const key = addr.email.toLowerCase();
    if (skip.has(key)) continue;
    skip.add(key);
    result.push(addr.email);
  }
  return result;
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

export function formatBerlin(isoUtc: string, locale: QuoteLocale = "en"): BerlinParts {
  const date = new Date(isoUtc);
  // Always extract via en-US to get stable, parseable parts; localise via lookup tables.
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

  const wdShort = get("weekday");
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wdIdx = wdMap[wdShort] ?? 0;

  const monthIdx = parseInt(get("month"), 10) - 1;

  let hour = get("hour");
  if (hour === "24") hour = "00";

  return {
    weekday: WEEKDAYS[locale]![wdIdx]!,
    day: get("day"),
    month: MONTHS[locale]![monthIdx] ?? "",
    year: get("year"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** How much of the referenced article ends up in the quote block. */
export type QuoteHistory = "trim" | "full";

/** HTML elements that never carry a closing tag. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Markers that indicate where a mail client appended the conversation that came
 * *before* the message being quoted. Everything from the earliest match onwards
 * is dropped by {@link trimQuotedHistory}.
 */
const HISTORY_MARKERS: readonly RegExp[] = [
  // Zammad's own fold marker — it sits exactly where the quoted part starts.
  /<span\b[^>]*\bclass="[^"]*js-signatureMarker[^"]*"[^>]*>/i,
  // Nested quotes of any flavour.
  /<blockquote\b/i,
  // Client-specific wrappers around the quoted conversation.
  /<div\b[^>]*\bclass="[^"]*(?:gmail_quote|moz-cite-prefix|yahoo_quoted|OutlookMessageHeader)[^"]*"[^>]*>/i,
  /<div\b[^>]*\bid="(?:divRplyFwdMsg|appendonsend)"[^>]*>/i,
  // Outlook / Exchange header block: "Von: … Gesendet: … An: …".
  /<b>\s*(?:Von|From|Gesendet|Sent)\s*:\s*(?:<\/b>|&nbsp;<\/b>)/i,
  // Plain-text separators inserted by Outlook and Thunderbird.
  /-{3,}\s*(?:Urspr[üu]ngliche Nachricht|Original Message|Weitergeleitete Nachricht|Forwarded message)\s*-{3,}/i,
  // Attribution lines: "Am …, schrieb X:" / "On …, X wrote:".
  /Am\s+[^<]{5,90}?schrieb\s+[^<]{1,90}?:/i,
  /On\s+[^<]{5,90}?wrote\s*:/i,
];

/** Trailing leftovers a cut tends to expose: empty paragraphs, spacers, rules. */
const TRAILING_NOISE =
  /(?:\s|<br\s*\/?>|<hr\s*\/?>|&nbsp;|<(p|div|span)\b[^>]*>\s*(?:&nbsp;|<br\s*\/?>|\s)*<\/\1>)+$/i;

function closeOpenTags(html: string): string {
  const stack: string[] = [];
  const tagRe = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const isClosing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const selfClosing = m[3] === "/";
    if (VOID_ELEMENTS.has(name) || selfClosing) continue;
    if (isClosing) {
      const idx = stack.lastIndexOf(name);
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      stack.push(name);
    }
  }
  return stack.reduceRight((acc, name) => `${acc}</${name}>`, html);
}

/**
 * Move the cut backwards over opening tags that would be left empty, so a cut
 * inside `<div><p><b>Von: </b>…` happens before the `<div>` and not between
 * `<p>` and `<b>`.
 */
function backOffToBlockStart(html: string, cut: number): number {
  let pos = cut;
  for (;;) {
    const head = html.slice(0, pos).replace(/\s+$/, "");
    const m = head.match(/<([a-z][a-z0-9]*)\b[^>]*>$/i);
    if (!m || VOID_ELEMENTS.has(m[1]!.toLowerCase())) return pos;
    pos = head.length - m[0].length;
  }
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip the quoted conversation history from a mail body, keeping only what the
 * sender actually wrote in this message.
 *
 * A cut is only applied when something readable survives it — a body that is
 * *only* a quote is returned unchanged rather than reduced to nothing.
 */
export function trimQuotedHistory(html: string): { html: string; trimmed: boolean } {
  if (!html) return { html, trimmed: false };

  let cut = -1;
  for (const marker of HISTORY_MARKERS) {
    const m = html.match(marker);
    if (m?.index !== undefined && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut === -1) return { html, trimmed: false };

  const kept = html.slice(0, backOffToBlockStart(html, cut)).replace(TRAILING_NOISE, "");
  if (!visibleText(kept)) return { html, trimmed: false };

  return { html: closeOpenTags(kept), trimmed: true };
}

export function buildQuoteBlock(
  createdAtIsoUtc: string,
  fromHeader: string,
  originalBodyHtml: string,
  locale: QuoteLocale = "en",
  history: QuoteHistory = "full",
): { html: string; trimmed: boolean } {
  const d = formatBerlin(createdAtIsoUtc, locale);
  const fromName = extractDisplayName(fromHeader) || extractEmail(fromHeader);
  const leadIn = QUOTE_LEAD_IN[locale]!(d, fromName);
  const { html: body, trimmed } =
    history === "trim" ? trimQuotedHistory(originalBodyHtml) : { html: originalBodyHtml, trimmed: false };
  return {
    html:
      `<div><blockquote type="cite">` +
      `${leadIn}<br><br>\n${body}\n</blockquote></div>`,
    trimmed,
  };
}

// Reply already ends on an empty line: <div><br></div>, <div>&nbsp;</div> or a
// bare <br>, optionally followed by the closing tags of the wrapping divs.
const TRAILING_EMPTY_LINE = /(?:<div[^>]*>\s*(?:<br\s*\/?>|&nbsp;)\s*<\/div>|<br\s*\/?>)\s*(?:<\/div>\s*)*$/i;

export function composeFinalBody(
  replyHtml: string,
  signatureHtml: string,
  signatureId: number,
  quoteBlock: string,
): string {
  // One empty line between the closing greeting and the signature.
  const spacer = TRAILING_EMPTY_LINE.test(replyHtml) ? [] : [`<div><br></div>`];
  return [
    replyHtml,
    ...spacer,
    `<div data-signature="true" data-signature-id="${signatureId}">${signatureHtml}</div>`,
    `<div><br><br></div>`,
    quoteBlock,
  ].join("\n");
}
