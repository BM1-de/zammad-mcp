# zammad-mcp

MCP-Server für Zammad — BM1-spezifische Workflows.

Co-existiert mit dem generischen [`basher83/zammad-mcp`](https://github.com/basher83/zammad-mcp).
Der hier deckt nur Workflows ab, die `basher83/zammad-mcp` **nicht** kann oder
nicht in der gewünschten Form macht — angefangen mit Shared Drafts inkl.
korrekter Reply-All-Logik, frisch gerenderter Signatur und deutschem
Zitatblock.

## Tools

### `zammad_create_shared_draft`

Erstellt oder überschreibt den Shared Draft eines Tickets als Reply-All-Email.

Was der Server für dich macht:
- Letzten Customer-Artikel finden (`sender=Customer, type=email`, fallback: letzter Artikel)
- `to`, `cc`, `subject`, `in_reply_to`, `from` automatisch berechnen
- Eigene Adressen (`support@bm1.de`, `baumgaertner@bm1.de`) aus CC filtern
- Signatur frisch holen + Platzhalter substituieren (lazy-loaded, mit Cache)
- HTML-Tags innerhalb `#{...}` defensiv strippen
- Original-Body als deutsch lokalisierten Zitatblock anhängen (Europe/Berlin, CEST/CET)
- `data-signature`-Marker setzen, damit Zammad keine zweite Signatur draufpackt
- `PUT /tickets/<id>/shared_draft` aufrufen

Was du lieferst:
- `ticket_id`
- `reply_html` — der reine Antworttext als `<div>...</div>`-Struktur

Konventionen, die strikt validiert werden (Tool returnt Fehler mit `isError: true`):

| Code | Regel |
|---|---|
| `P_TAG` | Keine `<p>`-Tags auf Top-Level (Blockquote ausgenommen) |
| `DOUBLE_BR` | Kein `<br><br>` — nutze `<div><br></div>` |
| `ASCII_QUOTE` | Keine geraden Anführungszeichen `"` im Fließtext |
| `WRONG_CLOSING_QUOTE` | Kein englisches `"` (U+201C) als Schluss |
| `ASCII_APOSTROPHE` | Apostroph in Wörtern muss `’` (U+2019) sein |
| `SIGNATURE_DUPLICATE` | Kein „Phillip" / „Phillip Baumgärtner" im Body (kommt aus Signatur) |
| `MISSING_GREETING` | Body muss „Viele Grüße" enthalten |

Beispiel `reply_html`:

```html
<div>
  <div>Sehr geehrter Herr Müller,</div>
  <div><br></div>
  <div>vielen Dank für Ihre Nachricht. Wir haben das Problem behoben.</div>
  <div><br></div>
  <div>Viele Grüße</div>
</div>
```

Tool-Rückgabe bei Erfolg:

```json
{
  "ok": true,
  "ticket_url": "https://mail.bm1.de/#ticket/zoom/12345",
  "to": "kunde@firma.de",
  "cc": "kollege@firma.de",
  "from": "Phillip Baumgärtner <support@bm1.de>",
  "subject": "RE: Anfrage Hosting",
  "in_reply_to": "<abc123@firma.de>",
  "reference_article_id": 98765,
  "draft_id": 42
}
```

## Setup

```bash
cd ~/Sites/Dev/zammad-mcp
npm install
npm run build
npm test
```

## Registrierung

### Claude Code (`~/.claude.json`)

```jsonc
{
  "mcpServers": {
    "mcp-zammad": {
      "command": "node",
      "args": ["/Users/phillip/Sites/Dev/zammad-mcp/dist/index.js"],
      "env": {
        "ZAMMAD_URL":        "https://mail.bm1.de/api/v1/",
        "ZAMMAD_HTTP_TOKEN": "<token>"
      }
    }
  }
}
```

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

Identischer Eintrag wie oben unter `mcpServers`.

Nach jeder Änderung Claude Desktop neu starten; bei Claude Code reicht ein neuer
Chat.

## Geplante Erweiterungen

Slot für weitere Tools in `src/tools/`:
- `zammad_get_ticket_thread` — Ticket inkl. aller Artikel-Bodies in einem Call
- `zammad_add_internal_note` — sicherer Wrapper für `type: "note"`, schließt
  versehentliches `type: "email"` aus
- `zammad_close_ticket` — Status auf `closed` setzen

Pattern: neue Datei in `src/tools/`, exportiert `register<Name>Tools(server, client)`,
in `src/index.ts` einmal aufrufen — fertig.

## Tests

```bash
npm test
```

Unit-Tests laufen ohne Zammad-Verbindung (mit gemocktem Client für `signature.ts`).
Den Live-Pfad gegen Zammad gibt's bewusst nicht in der Test-Suite — der hängt an
echten Ticket-IDs und ist Manual-Smoke-Test gegen ein Test-Ticket.
