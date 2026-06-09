# zammad-mcp

MCP server for [Zammad](https://zammad.org) that focuses on workflows the
standard Zammad API tooling does not cover well — primarily **shared drafts**
with strict reply-HTML validation, fresh signature rendering and German-
localised quote blocks.

Built to coexist with generic Zammad MCP servers (e.g.
[`basher83/zammad-mcp`](https://github.com/basher83/zammad-mcp)) — this one
deliberately covers only a narrow set of opinionated workflows.

## Tools

### `zammad_create_shared_draft`

Creates or overwrites the shared draft of a Zammad ticket as a Reply-All
email.

What the server does automatically:

- Finds the last incoming customer article (`sender=Customer`, `type=email`;
  falls back to the most recent article if none).
- Computes `to`, `cc`, `subject`, `in_reply_to` and `from` from that article
  plus `/users/me` and the ticket's group email-address.
- Filters configured self-addresses out of CC (so you don't reply to
  yourself).
- Fetches the signature template fresh from Zammad and resolves all
  `#{...}` placeholders via lazy-loaded sub-objects (with caching).
  Defensively strips HTML tags that may have crept into placeholders via
  the Zammad WYSIWYG editor.
- Appends the original article as a German-localised `<blockquote>` with
  Europe/Berlin date (CET/CEST aware).
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

#### Reply-HTML validation

The tool refuses the call if any of these issues are found in `reply_html`:

| Code | Rule |
|---|---|
| `P_TAG` | No top-level `<p>` tags (content inside `<blockquote>` is ignored). Use nested `<div>` instead — Zammad's editor produces doubled empty lines from `<p>` blocks. |
| `DOUBLE_BR` | No `<br><br>` sequences. Use `<div><br></div>` for paragraph spacing. |
| `ASCII_QUOTE` | No straight ASCII `"` in visible text. Use typographically correct quotes for your language. |
| `WRONG_CLOSING_QUOTE` | If the text uses German opening `„` (U+201E), it must close with `”` (U+201D), not the English opener `“` (U+201C). |
| `ASCII_APOSTROPHE` | No ASCII `'` inside a word. Use `’` (U+2019). |
| `SIGNATURE_DUPLICATE` (configurable) | The body contains a name listed in `ZAMMAD_BANNED_NAMES`. Prevents agents from typing the name that the signature already provides. |
| `MISSING_GREETING` (configurable) | The body does not contain the string configured in `ZAMMAD_REQUIRED_GREETING`. |

Universal checks (`P_TAG`, `DOUBLE_BR`, `ASCII_QUOTE`, `WRONG_CLOSING_QUOTE`,
`ASCII_APOSTROPHE`) are always on. The two configurable checks are silent
when their respective env-var is empty.

#### Example `reply_html`

```html
<div>
  <div>Sehr geehrter Herr Müller,</div>
  <div><br></div>
  <div>vielen Dank für Ihre Nachricht — wir haben das Problem behoben.</div>
  <div><br></div>
  <div>Viele Grüße</div>
</div>
```

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
    "ZAMMAD_REQUIRED_GREETING": "Viele Grüße"
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

## License

MIT
