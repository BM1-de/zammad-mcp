export interface ValidationIssue {
  code: string;
  msg: string;
}

export interface ValidatorOptions {
  /**
   * List of name patterns (interpreted as case-sensitive sub-strings with
   * word-boundary matching) that must not appear in the reply body. Use this
   * to prevent agents from typing their own name into the body when the
   * signature already supplies it. Default: empty (no check).
   */
  bannedNamePatterns?: string[];
  /**
   * If non-empty, the reply must literally contain this string (case-
   * insensitive). Common values: "Viele Grüße", "Best regards". Default:
   * empty (no check).
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
      msg: `Top-level <p>-Tag bei Char ${pMatch.index} gefunden. Nutze <div>...</div> statt <p>.`,
    });
  }

  if (/<br\s*\/?>\s*<br\s*\/?>/i.test(withoutBlockquotes)) {
    issues.push({
      code: "DOUBLE_BR",
      msg: "Aufeinanderfolgende <br><br> gefunden. Für Absatzabstand nutze <div><br></div>.",
    });
  }

  const textOnly = withoutBlockquotes.replace(/<[^>]+>/g, "");

  if (textOnly.includes('"')) {
    issues.push({
      code: "ASCII_QUOTE",
      msg: 'ASCII-Anführungszeichen " im Fließtext. Nutze typografisch korrekte deutsche Anführungszeichen: „…" (U+201E öffnend, U+201D schließend).',
    });
  }

  if (textOnly.includes("„") && textOnly.includes("“") && !textOnly.includes("”")) {
    issues.push({
      code: "WRONG_CLOSING_QUOTE",
      msg: 'Englisches Öffnungs-Anführungszeichen " (U+201C) als Schluss verwendet. Deutsches Schlusszeichen ist " (U+201D).',
    });
  }

  if (/\p{L}'\p{L}/u.test(textOnly)) {
    issues.push({
      code: "ASCII_APOSTROPHE",
      msg: "ASCII-Apostroph ' innerhalb eines Wortes gefunden. Nutze typografisches Apostroph ’ (U+2019).",
    });
  }

  const banned = options.bannedNamePatterns ?? [];
  if (banned.length > 0) {
    for (const pat of banned) {
      const re = new RegExp(`\\b${escapeRegex(pat)}\\b`, "u");
      if (re.test(textOnly)) {
        issues.push({
          code: "SIGNATURE_DUPLICATE",
          msg: `„${pat}" im Body gefunden. Dieser Name kommt aus der Signatur — entferne ihn aus dem reply_html.`,
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
        msg: `Keine Grußformel „${greeting}" im Body gefunden.`,
      });
    }
  }

  return issues;
}
