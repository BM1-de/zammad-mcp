import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReplyHtml } from "../src/lib/validate.ts";

test("validator accepts well-formed reply", () => {
  const html =
    "<div><div>Hallo Herr Müller,</div><div><br></div>" +
    "<div>vielen Dank für Ihre Nachricht. Die „Datenbank” läuft.</div>" +
    "<div><br></div><div>Viele Grüße</div></div>";
  const issues = validateReplyHtml(html);
  assert.deepEqual(issues, []);
});

test("validator flags <p> tags", () => {
  const html = "<p>Hallo</p><div>Viele Grüße</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "P_TAG"));
});

test("validator flags <br><br>", () => {
  const html = "<div>Text<br><br>Mehr</div><div>Viele Grüße</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "DOUBLE_BR"));
});

test("validator flags ASCII double quote", () => {
  const html = '<div>Das ist "wichtig"</div><div>Viele Grüße</div>';
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "ASCII_QUOTE"));
});

test("validator flags wrong closing quote (U+201C as close)", () => {
  const html = "<div>Das „Buch“ ist gut</div><div>Viele Grüße</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "WRONG_CLOSING_QUOTE"));
});

test("validator accepts correct German quotes (U+201E + U+201D)", () => {
  const html = "<div>Das „Buch” ist gut</div><div>Viele Grüße</div>";
  const issues = validateReplyHtml(html).filter((i) => i.code === "WRONG_CLOSING_QUOTE");
  assert.deepEqual(issues, []);
});

test("validator flags ASCII apostrophe in word", () => {
  const html = "<div>Es war's nicht.</div><div>Viele Grüße</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "ASCII_APOSTROPHE"));
});

test("validator flags Phillip in body", () => {
  const html = "<div>Viele Grüße Phillip</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "SIGNATURE_DUPLICATE"));
});

test("validator flags Phillip Baumgärtner in body", () => {
  const html = "<div>Phillip Baumgärtner</div><div>Viele Grüße</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "SIGNATURE_DUPLICATE"));
});

test("validator flags missing Viele Grüße", () => {
  const html = "<div>Hallo</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "MISSING_GREETING"));
});

test("validator ignores content inside <blockquote>", () => {
  const html =
    "<div>Hallo</div><div>Viele Grüße</div>" +
    '<blockquote type="cite"><p>Original-Mail mit "ASCII-Quotes"</p></blockquote>';
  const issues = validateReplyHtml(html);
  assert.deepEqual(issues, []);
});
