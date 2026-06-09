import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractEmail,
  extractDisplayName,
  stripSubjectPrefix,
  filterSelfFromCc,
  ensureMessageIdBrackets,
  formatBerlin,
  buildQuoteBlock,
  composeFinalBody,
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

test("formatBerlin: summer time (CEST = UTC+2)", () => {
  // 2026-06-09T08:00:00Z → 2026-06-09 10:00:00 CEST → Dienstag
  const d = formatBerlin("2026-06-09T08:00:00.000Z");
  assert.equal(d.weekday, "Dienstag");
  assert.equal(d.day, "09");
  assert.equal(d.month, "Juni");
  assert.equal(d.year, "2026");
  assert.equal(d.hour, "10");
  assert.equal(d.minute, "00");
  assert.equal(d.second, "00");
});

test("formatBerlin: winter time (CET = UTC+1)", () => {
  // 2026-01-15T08:00:00Z → 2026-01-15 09:00:00 CET → Donnerstag
  const d = formatBerlin("2026-01-15T08:00:00.000Z");
  assert.equal(d.weekday, "Donnerstag");
  assert.equal(d.day, "15");
  assert.equal(d.month, "Januar");
  assert.equal(d.hour, "09");
});

test("buildQuoteBlock contains DE date + name + body", () => {
  const block = buildQuoteBlock(
    "2026-06-09T08:00:00.000Z",
    "Max Mustermann <max@example.com>",
    "<div>Original-Text</div>",
  );
  assert.match(block, /Am Dienstag, 09\. Juni 2026 um 10:00:00, schrieb Max Mustermann/);
  assert.match(block, /<div>Original-Text<\/div>/);
  assert.match(block, /<blockquote type="cite">/);
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
