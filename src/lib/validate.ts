export interface ValidationIssue {
  code: string;
  msg: string;
}

const SELF_NAMES = /\bPhillip(?:\s+Baumg(?:ä|ae)rtner)?\b/u;

export function validateReplyHtml(html: string): ValidationIssue[] {
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

  // U+201C (LEFT DOUBLE QUOTATION MARK, ") wird im Deutschen NIE als Schluss verwendet.
  // Wenn der Text ein U+201E öffnet, aber kein U+201D schließt, dafür aber U+201C → falsches Schlusszeichen.
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

  if (SELF_NAMES.test(textOnly)) {
    issues.push({
      code: "SIGNATURE_DUPLICATE",
      msg: "„Phillip\" oder „Phillip Baumgärtner\" im Body gefunden. Der Name kommt aus der Signatur — schreibe nur „Viele Grüße\" am Ende.",
    });
  }

  if (!/Viele\s+Grüße/i.test(textOnly)) {
    issues.push({
      code: "MISSING_GREETING",
      msg: "Keine Grußformel „Viele Grüße\" im Body gefunden. Pflicht für Reply-Drafts.",
    });
  }

  return issues;
}
