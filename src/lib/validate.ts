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

  if (textOnly.includes('"')) {
    issues.push({
      code: "ASCII_QUOTE",
      msg: 'Straight ASCII quote " found in visible text. Use typographically correct quotes (e.g. "…" for English, „…" for German).',
    });
  }

  // German typographic mistake: opening with „ (U+201E) and closing with „ (U+201C,
  // the English opener) instead of " (U+201D, the German closer).
  if (textOnly.includes("„") && textOnly.includes("“") && !textOnly.includes("”")) {
    issues.push({
      code: "WRONG_CLOSING_QUOTE",
      msg: 'German opening quote „ (U+201E) used together with English opener " (U+201C) as closer. The German closing quote is " (U+201D).',
    });
  }

  if (/\p{L}'\p{L}/u.test(textOnly)) {
    issues.push({
      code: "ASCII_APOSTROPHE",
      msg: "ASCII apostrophe ' found inside a word. Use typographic apostrophe ’ (U+2019).",
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
