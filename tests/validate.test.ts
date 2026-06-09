import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReplyHtml } from "../src/lib/validate.ts";

const FULL = {
  bannedNamePatterns: ["Jane Doe", "Jane"],
  requiredGreeting: "Best regards",
};

test("validator accepts well-formed reply (no opts)", () => {
  const html =
    "<div><div>Hello Mr Smith,</div><div><br></div>" +
    "<div>thank you for your message. The database is back up.</div>" +
    "<div><br></div><div>Best regards</div></div>";
  const issues = validateReplyHtml(html);
  assert.deepEqual(issues, []);
});

test("validator accepts well-formed reply with full opts", () => {
  const html =
    "<div><div>Hello Mr Smith,</div><div><br></div>" +
    "<div>thank you for your message. The database is back up.</div>" +
    "<div><br></div><div>Best regards</div></div>";
  const issues = validateReplyHtml(html, FULL);
  assert.deepEqual(issues, []);
});

test("validator flags <p> tags", () => {
  const html = "<p>Hello</p><div>Best regards</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "P_TAG"));
});

test("validator flags <br><br>", () => {
  const html = "<div>Text<br><br>More</div><div>Best regards</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "DOUBLE_BR"));
});

test("validator flags ASCII double quote", () => {
  const html = '<div>This is "important"</div><div>Best regards</div>';
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "ASCII_QUOTE"));
});

test("validator flags wrong closing quote (U+201C as close)", () => {
  const html = "<div>The „Book“ is great</div><div>Best regards</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "WRONG_CLOSING_QUOTE"));
});

test("validator accepts correct German quotes (U+201E + U+201D)", () => {
  const html = "<div>The „Book” is great</div><div>Best regards</div>";
  const issues = validateReplyHtml(html).filter((i) => i.code === "WRONG_CLOSING_QUOTE");
  assert.deepEqual(issues, []);
});

test("validator flags ASCII apostrophe in word", () => {
  const html = "<div>It's wrong.</div><div>Best regards</div>";
  const issues = validateReplyHtml(html);
  assert.ok(issues.some((i) => i.code === "ASCII_APOSTROPHE"));
});

test("validator flags banned name (full)", () => {
  const html = "<div>Best regards Jane Doe</div>";
  const issues = validateReplyHtml(html, FULL);
  assert.ok(issues.some((i) => i.code === "SIGNATURE_DUPLICATE"));
});

test("validator flags banned name (first only)", () => {
  const html = "<div>Hi Jane</div><div>Best regards</div>";
  const issues = validateReplyHtml(html, FULL);
  assert.ok(issues.some((i) => i.code === "SIGNATURE_DUPLICATE"));
});

test("validator does NOT flag banned name when feature is off", () => {
  const html = "<div>Best regards Jane Doe</div>";
  const issues = validateReplyHtml(html);
  assert.ok(!issues.some((i) => i.code === "SIGNATURE_DUPLICATE"));
});

test("validator flags missing greeting when required", () => {
  const html = "<div>Hello</div>";
  const issues = validateReplyHtml(html, FULL);
  assert.ok(issues.some((i) => i.code === "MISSING_GREETING"));
});

test("validator does NOT flag missing greeting when feature is off", () => {
  const html = "<div>Hello</div>";
  const issues = validateReplyHtml(html);
  assert.ok(!issues.some((i) => i.code === "MISSING_GREETING"));
});

test("validator ignores content inside <blockquote>", () => {
  const html =
    "<div>Hello</div><div>Best regards</div>" +
    '<blockquote type="cite"><p>Original with "ASCII quotes"</p></blockquote>';
  const issues = validateReplyHtml(html, FULL);
  assert.deepEqual(issues, []);
});
