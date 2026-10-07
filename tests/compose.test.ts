import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractEmail,
  extractDisplayName,
  stripSubjectPrefix,
  filterSelfFromCc,
  parseAddressList,
  ensureMessageIdBrackets,
  formatBerlin,
  buildQuoteBlock,
  composeFinalBody,
  trimQuotedHistory,
} from "../src/lib/compose.ts";

test("extractEmail handles 'Name <addr>'", () => {
  assert.equal(extractEmail("Max Mustermann <max@example.com>"), "max@example.com");
});

test("extractEmail handles bare address", () => {
  assert.equal(extractEmail("max@example.com"), "max@example.com");
});

test("extractEmail handles empty", () => {
  assert.equal(extractEmail(""), "");
  assert.equal(extractEmail(null), "");
});

test("extractDisplayName handles 'Name <addr>'", () => {
  assert.equal(extractDisplayName("Max Mustermann <max@example.com>"), "Max Mustermann");
});

test("extractDisplayName strips surrounding quotes", () => {
  assert.equal(extractDisplayName('"Müller, Hans" <h@ex.com>'), "Müller, Hans");
});

test("stripSubjectPrefix removes RE/AW/FW (nested)", () => {
  assert.equal(stripSubjectPrefix("AW: Re: Fwd: Anfrage"), "Anfrage");
});

test("stripSubjectPrefix keeps clean subject", () => {
  assert.equal(stripSubjectPrefix("Anfrage Hosting"), "Anfrage Hosting");
});

test("filterSelfFromCc removes configured self emails case-insensitive", () => {
  const result = filterSelfFromCc(
    "kollege@firma.de, Support@BM1.de, kunde@firma.de, baumgaertner@bm1.de",
    ["support@bm1.de", "baumgaertner@bm1.de"],
  );
  assert.deepEqual(result, ["kollege@firma.de", "kunde@firma.de"]);
});

test("filterSelfFromCc passes through everything when no self list is set", () => {
  const result = filterSelfFromCc("a@x.de, b@y.de");
  assert.deepEqual(result, ["a@x.de", "b@y.de"]);
});

test("filterSelfFromCc handles empty/null", () => {
  assert.deepEqual(filterSelfFromCc(""), []);
  assert.deepEqual(filterSelfFromCc(null), []);
});

test("filterSelfFromCc returns the bare address for a display name with a comma", () => {
  const result = filterSelfFromCc('"Mustermann, Erika" <Erika.Mustermann@klinikum.example>', [
    "support@bm1.de",
    "baumgaertner@bm1.de",
  ]);
  assert.deepEqual(result, ["Erika.Mustermann@klinikum.example"]);
});

test("filterSelfFromCc splits several CCs, one with a comma in the name, and drops self", () => {
  const result = filterSelfFromCc(
    '"Mustermann, Erika" <Erika.Mustermann@klinikum.example>, Max Muster <max.muster@klinikum.example>, ' +
      '"BM1 Support" <Support@BM1.de>, kollege@firma.de',
    ["support@bm1.de", "baumgaertner@bm1.de"],
  );
  assert.deepEqual(result, [
    "Erika.Mustermann@klinikum.example",
    "max.muster@klinikum.example",
    "kollege@firma.de",
  ]);
});

test("filterSelfFromCc drops duplicate addresses case-insensitively", () => {
  assert.deepEqual(filterSelfFromCc("a@x.de, Anna <A@X.de>, b@y.de"), ["a@x.de", "b@y.de"]);
});

test("filterSelfFromCc merges To and Cc and drops self and the reply's To recipient", () => {
  const result = filterSelfFromCc(
    [
      '"BM1 • Support" <support@bm1.de>, "Schulz, Max" <max.schulz@klinikum.example>, ' +
        "Kollegin <kollegin@klinikum.example>",
      '"Mustermann, Erika" <Erika.Mustermann@klinikum.example>, KOLLEGIN@klinikum.example',
    ],
    ["support@bm1.de", "baumgaertner@bm1.de", "max.schulz@klinikum.example"],
  );
  assert.deepEqual(result, ["kollegin@klinikum.example", "Erika.Mustermann@klinikum.example"]);
  assert.deepEqual(filterSelfFromCc([null, undefined, "a@x.de"]), ["a@x.de"]);
});

test("parseAddressList handles escaped quotes and comments containing commas", () => {
  assert.deepEqual(
    parseAddressList('"Hans \\"Hansi\\" Müller" <h@ex.com>, max@ex.com (Mustermann, Max)'),
    [
      { name: 'Hans "Hansi" Müller', email: "h@ex.com" },
      { name: "", email: "max@ex.com" },
    ],
  );
});

test("parseAddressList flattens groups and accepts semicolons as separator", () => {
  assert.deepEqual(parseAddressList("Team: a@ex.com, b@ex.com;; c@ex.com"), [
    { name: "", email: "a@ex.com" },
    { name: "", email: "b@ex.com" },
    { name: "", email: "c@ex.com" },
  ]);
  assert.deepEqual(parseAddressList("undisclosed-recipients:;"), []);
});

test("parseAddressList falls back to a plain split for an unbalanced header", () => {
  assert.deepEqual(parseAddressList('"Mustermann, Erika <e@ex.com>, max@ex.com'), [
    { name: "Erika", email: "e@ex.com" },
    { name: "", email: "max@ex.com" },
  ]);
});

test("ensureMessageIdBrackets wraps bare id", () => {
  assert.equal(ensureMessageIdBrackets("abc@example.com"), "<abc@example.com>");
});

test("ensureMessageIdBrackets keeps already-wrapped id", () => {
  assert.equal(ensureMessageIdBrackets("<abc@example.com>"), "<abc@example.com>");
});

test("ensureMessageIdBrackets handles empty", () => {
  assert.equal(ensureMessageIdBrackets(""), "");
  assert.equal(ensureMessageIdBrackets(null), "");
});

test("formatBerlin: summer time (CEST = UTC+2) en default", () => {
  // 2026-06-09T08:00:00Z → 2026-06-09 10:00:00 CEST → Tuesday
  const d = formatBerlin("2026-06-09T08:00:00.000Z");
  assert.equal(d.weekday, "Tuesday");
  assert.equal(d.day, "09");
  assert.equal(d.month, "June");
  assert.equal(d.year, "2026");
  assert.equal(d.hour, "10");
  assert.equal(d.minute, "00");
  assert.equal(d.second, "00");
});

test("formatBerlin: winter time (CET = UTC+1) de", () => {
  // 2026-01-15T08:00:00Z → 2026-01-15 09:00:00 CET → Donnerstag
  const d = formatBerlin("2026-01-15T08:00:00.000Z", "de");
  assert.equal(d.weekday, "Donnerstag");
  assert.equal(d.day, "15");
  assert.equal(d.month, "Januar");
  assert.equal(d.hour, "09");
});

test("buildQuoteBlock en (default) contains 'On ... wrote:'", () => {
  const { html } = buildQuoteBlock(
    "2026-06-09T08:00:00.000Z",
    "Max Mustermann <max@example.com>",
    "<div>Original-Text</div>",
  );
  assert.match(html, /On Tuesday, 9 June 2026 at 10:00:00, Max Mustermann wrote:/);
  assert.match(html, /<div>Original-Text<\/div>/);
  assert.match(html, /<blockquote type="cite">/);
});

test("buildQuoteBlock de contains 'Am ... schrieb X:'", () => {
  const { html } = buildQuoteBlock(
    "2026-06-09T08:00:00.000Z",
    "Max Mustermann <max@example.com>",
    "<div>Original-Text</div>",
    "de",
  );
  assert.match(html, /Am Dienstag, 09\. Juni 2026 um 10:00:00, schrieb Max Mustermann/);
});

test("buildQuoteBlock keeps history verbatim in 'full' mode", () => {
  const original = '<div>Danke!</div><div><blockquote>alter Verlauf</blockquote></div>';
  const { html, trimmed } = buildQuoteBlock(
    "2026-06-09T08:00:00.000Z",
    "Max Mustermann <max@example.com>",
    original,
    "de",
    "full",
  );
  assert.equal(trimmed, false);
  assert.match(html, /alter Verlauf/);
});

test("buildQuoteBlock drops the sender's own quoted history in 'trim' mode", () => {
  const original = '<div>Danke!</div><div><blockquote>alter Verlauf</blockquote></div>';
  const { html, trimmed } = buildQuoteBlock(
    "2026-06-09T08:00:00.000Z",
    "Max Mustermann <max@example.com>",
    original,
    "de",
    "trim",
  );
  assert.equal(trimmed, true);
  assert.match(html, /Danke!/);
  assert.doesNotMatch(html, /alter Verlauf/);
  // The lead-in must survive — it is ours, not part of the quoted body.
  assert.match(html, /schrieb Max Mustermann/);
});

test("trimQuotedHistory cuts at Zammad's js-signatureMarker", () => {
  const { html, trimmed } = trimQuotedHistory(
    '<div><p>Neue Frage</p><span class="js-signatureMarker"></span>' +
      '<p><b>Von: </b>Ralf &lt;r@ex.com&gt;<br><b>An: </b>Support</p></div>',
  );
  assert.equal(trimmed, true);
  assert.match(html, /Neue Frage/);
  assert.doesNotMatch(html, /Ralf/);
});

test("trimQuotedHistory cuts at an Outlook 'Von:' header block", () => {
  const { html, trimmed } = trimQuotedHistory(
    "<div><div>Passt so, danke.</div><div><p><b>Von: </b>Ralf<br><b>Gesendet: </b>gestern</p></div></div>",
  );
  assert.equal(trimmed, true);
  assert.match(html, /Passt so, danke\./);
  assert.doesNotMatch(html, /Gesendet/);
});

test("trimQuotedHistory cuts at a German attribution line", () => {
  const { html, trimmed } = trimQuotedHistory(
    "<div>Ja, bitte umsetzen.</div>" +
      "<div>Am Dienstag, 21. Dezember 2021, 14:02:35, schrieb Udo Schneider:</div>" +
      "<div>alter Text</div>",
  );
  assert.equal(trimmed, true);
  assert.match(html, /Ja, bitte umsetzen\./);
  assert.doesNotMatch(html, /Udo Schneider|alter Text/);
});

test("trimQuotedHistory cuts at '-----Ursprüngliche Nachricht-----'", () => {
  const { html, trimmed } = trimQuotedHistory(
    "<div>Kurze Rückmeldung</div><div>-----Ursprüngliche Nachricht-----</div><div>alt</div>",
  );
  assert.equal(trimmed, true);
  assert.doesNotMatch(html, /Ursprüngliche Nachricht|alt<\/div>/);
});

test("trimQuotedHistory returns balanced HTML after the cut", () => {
  const { html } = trimQuotedHistory(
    '<div class="a"><div><p>Text</p><blockquote>alt</blockquote></div></div>',
  );
  const opens = (html.match(/<div\b/g) ?? []).length;
  const closes = (html.match(/<\/div>/g) ?? []).length;
  assert.equal(opens, closes);
  assert.doesNotMatch(html, /alt/);
});

test("trimQuotedHistory keeps a quote-only body untouched", () => {
  const original = "<div><blockquote>nur der alte Verlauf</blockquote></div>";
  const { html, trimmed } = trimQuotedHistory(original);
  assert.equal(trimmed, false);
  assert.equal(html, original);
});

test("trimQuotedHistory leaves a body without history alone", () => {
  const original = "<div><div>Hallo,</div><div>bitte einmal prüfen.</div></div>";
  const { html, trimmed } = trimQuotedHistory(original);
  assert.equal(trimmed, false);
  assert.equal(html, original);
});

test("trimQuotedHistory does not fire on 'wrote:' inside prose", () => {
  const original = "<div>Der Kollege schrieb mir gestern, dass alles passt.</div>";
  assert.equal(trimQuotedHistory(original).trimmed, false);
});

test("composeFinalBody includes signature marker", () => {
  const body = composeFinalBody(
    "<div>Hi</div>",
    "<div>Phillip Baumgärtner</div>",
    1,
    "<div><blockquote>Original</blockquote></div>",
  );
  assert.match(body, /data-signature="true"/);
  assert.match(body, /data-signature-id="1"/);
});

test("composeFinalBody puts content in order: reply → sig → spacer → quote", () => {
  const body = composeFinalBody(
    "<div>REPLY</div>",
    "<div>SIG</div>",
    1,
    "<div>QUOTE</div>",
  );
  const replyIdx = body.indexOf("REPLY");
  const sigIdx = body.indexOf("SIG");
  const quoteIdx = body.indexOf("QUOTE");
  assert.ok(replyIdx < sigIdx && sigIdx < quoteIdx);
});

test("composeFinalBody adds an empty line between greeting and signature", () => {
  const body = composeFinalBody(
    "<div><div>Hi</div><div>Viele Grüße</div></div>",
    "<div>SIG</div>",
    1,
    "<div>QUOTE</div>",
  );
  assert.match(body, /Viele Grüße<\/div><\/div>\n<div><br><\/div>\n<div data-signature="true"/);
});

test("composeFinalBody does not double an empty line the reply already ends with", () => {
  for (const tail of ["<div><br></div>", "<div>&nbsp;</div>", "<br>"]) {
    const body = composeFinalBody(
      `<div><div>Viele Grüße</div>${tail}</div>`,
      "<div>SIG</div>",
      1,
      "<div>QUOTE</div>",
    );
    assert.ok(!body.includes("\n<div><br></div>\n"), tail);
  }
});
