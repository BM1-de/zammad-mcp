# Zammad MCP Server

MCP server for [Zammad](https://zammad.org) that focuses on workflows the
standard Zammad API tooling does not cover well — primarily **shared drafts**
with strict reply-HTML validation, fresh signature rendering and German-
localised quote blocks. The package/repo name is `zammad-mcp`.

Built to coexist with generic Zammad MCP servers (e.g.
[`basher83/zammad-mcp`](https://github.com/basher83/zammad-mcp)) — this one
deliberately covers only a narrow set of opinionated workflows.

## Tools

- [`zammad_create_shared_draft`](#zammad_create_shared_draft) — Reply-All shared draft with strict reply-HTML validation and signature rendering.
- [`zammad_get_ticket_thread`](#zammad_get_ticket_thread) — Ticket meta + all articles (with bodies) in one round-trip.
- [`zammad_add_internal_note`](#zammad_add_internal_note) — Append an internal note (hard-coded `type=note, internal=true`).

### `zammad_create_shared_draft`

Creates or overwrites the shared draft of a Zammad ticket as a Reply-All
email.

What the server does automatically:

- Finds the last incoming customer article (`sender=Customer`, `type=email`;
  falls back to the most recent article if none).
- Computes `to`, `cc`, `subject`, `in_reply_to` and `from` from that article
  plus `/users/me` and the ticket's group email-address. Like Zammad's own
  "Reply All", `to` is the article's sender and `cc` collects its other To
  and Cc recipients. Address lists are parsed per RFC 5322, so display names
  containing commas (`"Doe, Jane" <jane@example.com>`) stay intact, and are
  written as bare addresses — Zammad's recipient field splits a draft's CC at
  every comma, even inside a quoted display name.
- Filters configured self-addresses out of CC (so you don't reply to
  yourself).
- Fetches the signature template fresh from Zammad and resolves all
  `#{...}` placeholders via lazy-loaded sub-objects (with caching).
  Defensively strips HTML tags that may have crept into placeholders via
  the Zammad WYSIWYG editor.
- Appends the original article as a German-localised `<blockquote>` with
  Europe/Berlin date (CET/CEST aware). By default only what the sender wrote
  in that message is quoted — the conversation history they quoted themselves
  is stripped, so replies in long threads stay short (see `quote_history`).
- Wraps the signature in `<div data-signature="true" data-signature-id="X">`
  so Zammad does not stack a second signature on top when the draft is
  opened.
- `PUT`s the assembled payload to `/tickets/<id>/shared_draft`.

What you provide:

- `ticket_id` — Zammad ticket ID (numeric, from the URL
  `/#ticket/zoom/<id>`).
- `reply_html` — the actual reply body as HTML with a nested `<div>`
  structure (see validation below).
- `signature_id` (optional, default `1`) — which signature to render.
- `extra_cc` (optional) — additional CC addresses to add on top of the
  automatic Reply-All set.
- `quote_locale` (optional, `en` or `de`) — language for the quote block's
  date format and "wrote:" lead-in. When omitted, the server default
  (`ZAMMAD_QUOTE_LOCALE`, falling back to `en`) is used.
- `quote_history` (optional, `trim` or `full`) — how much of the referenced
  article to quote. `trim` keeps only the message itself, `full` quotes it
  verbatim. When omitted, the server default (`ZAMMAD_QUOTE_HISTORY`, falling
  back to `trim`) is used.

##### Quote trimming (`quote_history`)

Mail clients quote the entire thread, so every reply carries the whole
conversation again. `trim` cuts the quoted article at the earliest of these
markers and re-balances the remaining HTML:

- Zammad's own `<span class="js-signatureMarker">` fold marker
- a nested `<blockquote>`
- client wrappers: `gmail_quote`, `moz-cite-prefix`, `yahoo_quoted`,
  `OutlookMessageHeader`, `divRplyFwdMsg`, `appendonsend`
- Outlook/Exchange header blocks (`<b>Von: </b>`, `<b>From: </b>`, …)
- `-----Ursprüngliche Nachricht-----` / `-----Original Message-----`
- attribution lines: "Am …, schrieb X:" / "On …, X wrote:"

The sender's own signature stays in the quote (it is part of their message).
A body that consists *only* of a quote is never reduced to nothing — in that
case the article is quoted verbatim and the response reports
`quote_history_trimmed: false`.

#### Reply-HTML validation

The tool refuses the call if any of these issues are found in `reply_html`:

| Code | Rule |
|---|---|
| `P_TAG` | No top-level `<p>` tags (content inside `<blockquote>` is ignored). Use nested `<div>` instead — Zammad's editor produces doubled empty lines from `<p>` blocks. |
| `DOUBLE_BR` | No `<br><br>` sequences. Use `<div><br></div>` for paragraph spacing. |
| `TYPED_LIST` | Two or more lines start with a typed list marker (`-`, `–`, `•`, `*`). Use a real `<ul><li>…</li></ul>` instead. |
| `ASCII_QUOTE` | No straight ASCII `"` in visible text. Use typographically correct quotes for your language. |
| `WRONG_CLOSING_QUOTE` | If the text uses the German opening quote `„` (U+201E), it must close with `“` (U+201C), not with `”` (U+201D, which is the English closer). |
| `ASCII_APOSTROPHE` | No ASCII `'` inside a word. Use `’` (U+2019). |
| `WRONG_DASH_LOCALE` (locale=de only) | German body uses em-dash `—` (U+2014). German typography uses en-dash `–` (U+2013) with spaces as parenthetical dash. |
| `ASCII_DASH_AS_GEDANKENSTRICH` (locale=de only) | German body uses ` - ` (ASCII hyphen with spaces) as parenthetical dash. Use ` – ` (en-dash with spaces) instead. |
| `SIGNATURE_DUPLICATE` (configurable) | The body contains a name listed in `ZAMMAD_BANNED_NAMES`. Prevents agents from typing the name that the signature already provides. |
| `MISSING_GREETING` (configurable) | The body does not contain the string configured in `ZAMMAD_REQUIRED_GREETING`. |

Universal checks (`P_TAG`, `DOUBLE_BR`, `TYPED_LIST`, `ASCII_QUOTE`, `WRONG_CLOSING_QUOTE`,
`ASCII_APOSTROPHE`) are always on. The two configurable checks are silent
when their respective env-var is empty.

#### Example `reply_html`

```html
<div>
  <div>Dear Mr Smith,</div>
  <div><br></div>
  <div>thank you for your message — we have resolved the issue.</div>
  <div><br></div>
  <div>Best regards</div>
</div>
```

Lists go into a real `<ul>`, wrapped in a `<div>` with an empty line before
and after:

```html
<div>the changes are live:</div>
<div><br></div>
<div><ul><li>Home: new header image</li><li>Contact: form shortened</li></ul></div>
<div><br></div>
```

The tool puts one empty line (`<div><br></div>`) between the end of
`reply_html` — usually the closing greeting — and the signature, unless
`reply_html` already ends with one.

#### Response

```json
{
  "ok": true,
  "ticket_url": "https://zammad.example.com/#ticket/zoom/12345",
  "to": "customer@example.com",
  "cc": "colleague@example.com",
  "from": "Jane Doe <support@example.com>",
  "subject": "RE: Question about hosting",
  "in_reply_to": "<abc123@example.com>",
  "reference_article_id": 98765,
  "draft_id": null
}
```

(`draft_id` is `null` whenever Zammad does not return an `id` in the PUT
response — the draft is still created, only the metadata is absent.)

On validation failure:

```json
{
  "ok": false,
  "error": "INVALID_REPLY_HTML",
  "issues": [
    { "code": "P_TAG", "msg": "Top-level <p>-Tag bei Char 142 gefunden. ..." }
  ]
}
```

### `zammad_get_ticket_thread`

Fetches a ticket and all of its articles in a single call. Useful for
"give me context on ticket X before I write anything" — combines two
Zammad endpoints (`/tickets/<id>?expand=true` and
`/ticket_articles/by_ticket/<id>`) and returns a flat structure with
ticket meta plus the article list.

Parameters:

- `ticket_id` — numeric ticket ID.
- `include_internal` (default `true`) — set to `false` to hide internal
  notes from the result.
- `include_bodies` (default `true`) — set to `false` to get a cheap meta-
  only overview of long threads.
- `max_articles` (optional) — caps to the most recent N articles.

Response: `{ ok, ticket_url, ticket: {...}, article_count_returned,
article_count_total, truncated, articles: [...] }`.

### `zammad_add_internal_note`

Appends an internal note to a ticket. The tool hard-codes
`type: "note"` and `internal: true`, so it is structurally impossible
to accidentally send an email to the customer. For customer-facing
content use `zammad_create_shared_draft` and let a human send the draft
from the Zammad UI.

Parameters:

- `ticket_id` — numeric ticket ID.
- `body` — body content (HTML or plain text).
- `content_type` — `text/html` (default) or `text/plain`.
- `subject` (optional) — internal-list subject.

Response: `{ ok, ticket_url, article_id, type, internal }`.

## Setup

```bash
git clone <repo-url> zammad-mcp
cd zammad-mcp
npm install
npm run build
npm test
```

Node 18 or higher.

## Configuration

| Env-var | Required | Description |
|---|---|---|
| `ZAMMAD_URL` | yes | REST base URL, e.g. `https://mail.example.com/api/v1/`. |
| `ZAMMAD_HTTP_TOKEN` | yes | API token (Profile → Token Access in Zammad). |
| `ZAMMAD_SELF_EMAILS` | no | Comma-separated list of own addresses that should never appear in CC. Default: empty (no filtering). |
| `ZAMMAD_BANNED_NAMES` | no | Comma-separated list of name patterns the reply body must not contain (typically: your own name, because the signature already supplies it). Default: empty. |
| `ZAMMAD_REQUIRED_GREETING` | no | If set, every reply body must contain this string (case-insensitive). Default: empty. |
| `ZAMMAD_QUOTE_LOCALE` | no | Default locale for the quote-block lead-in. Either `en` (default) or `de`. Per-call overridable via the `quote_locale` tool parameter. |
| `ZAMMAD_QUOTE_HISTORY` | no | How much of the referenced article to quote: `trim` (default — drop the history the sender quoted themselves) or `full` (quote verbatim). Per-call overridable via the `quote_history` tool parameter. |

See `.env.example` for a starter file.

## Registration with Claude

Add this block to `mcpServers` in your Claude Desktop config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)
and / or your Claude Code config (`~/.claude.json`):

```jsonc
"zammad-mcp": {
  "command": "node",
  "args": ["/absolute/path/to/zammad-mcp/dist/index.js"],
  "env": {
    "ZAMMAD_URL": "https://mail.example.com/api/v1/",
    "ZAMMAD_HTTP_TOKEN": "...",
    "ZAMMAD_SELF_EMAILS": "support@example.com,me@example.com",
    "ZAMMAD_BANNED_NAMES": "Jane Doe,Jane",
    "ZAMMAD_REQUIRED_GREETING": "Best regards",
    "ZAMMAD_QUOTE_LOCALE": "en"
  }
}
```

Restart Claude Desktop completely (Cmd+Q + re-open) so the daemon reloads
the MCP server list. In Claude Code a new chat is enough.

## Tests

```bash
npm test
```

Unit tests use Node's built-in test runner via `--experimental-strip-types`.
The signature resolver is tested with a mock Zammad client; everything
else is pure logic and doesn't need network access.

## About BM1

`zammad-mcp` is built and maintained by [BM1](https://www.bm1.de), a German
agency for SEO, web development and custom software. We build
search-visible websites, data-driven SEO setups and special-purpose tooling
like this MCP server, which automates our day-to-day support workflows. If
you need help with SEO, a web project or an integration nobody offers off
the shelf — [talk to us](https://www.bm1.de).

## License

MIT
