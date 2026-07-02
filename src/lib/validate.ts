export interface ValidationIssue {
  code: string;
  msg: string;
}

export interface ValidatorOptions {
  /**
   * Names that must not appear in the reply body. Useful to prevent agents
   * typing their own name when the signature already supplies it. Matched
   * case-sensitively with word boundaries. Default: empty (check disabled).
   */
  bannedNamePatterns?: string[];
  /**
   * Substring the reply body must contain (case-insensitive). Common values:
   * "Best regards", "Viele Grüße", "Kind regards". Default: empty (check
   * disabled).
   */
  requiredGreeting?: string;
  /**
   * Locale of the reply body. Enables locale-specific typography checks:
   * - "de": the parenthetical dash must be " – " (U+2013 with spaces), not
   *   "—" (U+2014, em-dash) and not " - " (ASCII hyphen with spaces).
   * - "en": em-dash and en-dash both accepted; " - " is tolerated.
   * Default: "en".
   */
  locale?: "en" | "de";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateReplyHtml(
  html: string,
  options: ValidatorOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const withoutBlockquotes = html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "");

  const pMatch = withoutBlockquotes.match(/<p[\s>]/i);
  if (pMatch && pMatch.index !== undefined) {
    issues.push({
      code: "P_TAG",
      msg: `Top-level <p> tag at char ${pMatch.index}. Use nested <div> structure instead — Zammad's editor produces doubled empty lines from <p> blocks.`,
    });
  }

  if (/<br\s*\/?>\s*<br\s*\/?>/i.test(withoutBlockquotes)) {
    issues.push({
      code: "DOUBLE_BR",
      msg: "Consecutive <br><br> found. Use <div><br></div> for paragraph spacing.",
    });
  }

  // Replace tags with a space so word boundaries between adjacent divs work.
  // Otherwise "<div>Hi Jane</div><div>Best regards</div>" collapses to
  // "Hi JaneBest regards" and \bJane\b no longer matches.
  const textOnly = withoutBlockquotes.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const asciiQuoteIdx = textOnly.indexOf('"');
  if (asciiQuoteIdx >= 0) {
    const ctxStart = Math.max(0, asciiQuoteIdx - 15);
    const ctxEnd = Math.min(textOnly.length, asciiQuoteIdx + 16);
    const context = textOnly.slice(ctxStart, ctxEnd);
    const hasGermanOpener = textOnly.includes("„");
    const fixHint = hasGermanOpener
      ? 'Your text already uses „ (U+201E, German opener) — the German closer is “ (U+201C). REPLACE the " character literally with „ (opening) or “ (closing) — do NOT submit the same body again.'
      : 'Use „…“ (U+201E + U+201C) for German or “…” (U+201C + U+201D) for English. REPLACE every ASCII " with one of those literally.';
    issues.push({
      code: "ASCII_QUOTE",
      msg: `Straight ASCII quote " (U+0022) at text position ${asciiQuoteIdx} — context "…${context}…". ${fixHint}`,
    });
  }

  // German typographic mistake: opening with „ (U+201E) but closing with ” (U+201D,
  // the ENGLISH closer). German quotes are „…“ — the closer is “ (U+201C), the same
  // glyph English uses as opener. That overlap is exactly why this gets mixed up.
  const wrongCloserIdx = textOnly.indexOf("”");
  if (wrongCloserIdx >= 0 && textOnly.includes("„")) {
    const ctxStart = Math.max(0, wrongCloserIdx - 15);
    const ctxEnd = Math.min(textOnly.length, wrongCloserIdx + 16);
    const context = textOnly.slice(ctxStart, ctxEnd);
    issues.push({
      code: "WRONG_CLOSING_QUOTE",
      msg: `German opening quote „ (U+201E) used together with English closer ” (U+201D) at position ${wrongCloserIdx} — context "…${context}…". German quotes close with “ (U+201C): „Beispiel“. REPLACE ” literally with “. Do NOT submit the same body again.`,
    });
  }

  const apostropheMatch = textOnly.match(/\p{L}'\p{L}/u);
  if (apostropheMatch && apostropheMatch.index !== undefined) {
    const idx = apostropheMatch.index + 1;
    const ctxStart = Math.max(0, idx - 10);
    const ctxEnd = Math.min(textOnly.length, idx + 11);
    issues.push({
      code: "ASCII_APOSTROPHE",
      msg: `ASCII apostrophe ' (U+0027) inside a word at position ${idx} — context "…${textOnly.slice(ctxStart, ctxEnd)}…". REPLACE ' literally with ’ (U+2019).`,
    });
  }

  const locale = options.locale ?? "en";
  if (locale === "de") {
    // Em-dash "—" (U+2014) is wrong in German typography. German uses
    // en-dash "–" (U+2013) with spaces as parenthetical dash.
    const emIdx = textOnly.indexOf("—");
    if (emIdx >= 0) {
      const ctxStart = Math.max(0, emIdx - 15);
      const ctxEnd = Math.min(textOnly.length, emIdx + 16);
      issues.push({
        code: "WRONG_DASH_LOCALE",
        msg: `Em-dash "—" (U+2014) at position ${emIdx} — context "…${textOnly.slice(ctxStart, ctxEnd)}…". German typography uses en-dash "–" (U+2013) with spaces around it. REPLACE "—" literally with "–".`,
      });
    }
    // ASCII hyphen used as parenthetical dash: " - " (space-hyphen-space).
    const asciiDashMatch = textOnly.match(/ - /);
    if (asciiDashMatch && asciiDashMatch.index !== undefined) {
      const idx = asciiDashMatch.index + 1; // position of the hyphen itself
      const ctxStart = Math.max(0, idx - 15);
      const ctxEnd = Math.min(textOnly.length, idx + 16);
      issues.push({
        code: "ASCII_DASH_AS_GEDANKENSTRICH",
        msg: `ASCII hyphen "-" (U+002D) used as parenthetical dash at position ${idx} — context "…${textOnly.slice(ctxStart, ctxEnd)}…". German typography requires en-dash with spaces: " – " (U+2013). REPLACE " - " literally with " – ".`,
      });
    }
  }

  const banned = options.bannedNamePatterns ?? [];
  if (banned.length > 0) {
    for (const pat of banned) {
      const re = new RegExp(`\\b${escapeRegex(pat)}\\b`, "u");
      if (re.test(textOnly)) {
        issues.push({
          code: "SIGNATURE_DUPLICATE",
          msg: `Body contains "${pat}" which is on the banned-names list. The signature already supplies this name — remove it from reply_html.`,
        });
        break;
      }
    }
  }

  const greeting = options.requiredGreeting?.trim();
  if (greeting) {
    const re = new RegExp(escapeRegex(greeting), "i");
    if (!re.test(textOnly)) {
      issues.push({
        code: "MISSING_GREETING",
        msg: `Body does not contain required greeting "${greeting}".`,
      });
    }
  }

  return issues;
}
