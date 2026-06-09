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
      ? 'Your text already uses „ (U+201E, German opener) — close with ” (U+201D, German closer). REPLACE the " character literally with ” — do NOT submit the same body again.'
      : 'Use „…” (U+201E + U+201D) for German or “…” (U+201C + U+201D) for English. REPLACE every ASCII " with one of those literally.';
    issues.push({
      code: "ASCII_QUOTE",
      msg: `Straight ASCII quote " (U+0022) at text position ${asciiQuoteIdx} — context "…${context}…". ${fixHint}`,
    });
  }

  // German typographic mistake: opening with „ (U+201E) and closing with “ (U+201C,
  // which is the English opener) instead of ” (U+201D, the German closer).
  const wrongCloserIdx = textOnly.indexOf("“");
  if (wrongCloserIdx >= 0 && textOnly.includes("„") && !textOnly.includes("”")) {
    const ctxStart = Math.max(0, wrongCloserIdx - 15);
    const ctxEnd = Math.min(textOnly.length, wrongCloserIdx + 16);
    const context = textOnly.slice(ctxStart, ctxEnd);
    issues.push({
      code: "WRONG_CLOSING_QUOTE",
      msg: `German opening quote „ (U+201E) used together with English opener “ (U+201C) as closer at position ${wrongCloserIdx} — context "…${context}…". REPLACE “ literally with ” (U+201D). Do NOT submit the same body again.`,
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
