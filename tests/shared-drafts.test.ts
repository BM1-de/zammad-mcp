import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSharedDraftTools } from "../src/tools/shared-drafts.ts";
import type { ZammadClient } from "../src/api-client.ts";
import type { ServerConfig } from "../src/config.ts";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

interface DraftPayload {
  new_article: { to: string; cc: string };
}

const config: ServerConfig = {
  zammadUrl: "https://mail.example/api/v1/",
  zammadHttpToken: "test",
  selfEmails: ["support@bm1.de", "baumgaertner@bm1.de"],
  bannedNamePatterns: [],
  requiredGreeting: "",
  defaultQuoteLocale: "de",
  defaultQuoteHistory: "trim",
};

// Runs zammad_create_shared_draft against canned responses and captures the PUT
// payload instead of sending it — no request leaves the process.
async function createDraft(
  headers: { to?: string; cc?: string },
  extraCc: string[] = [],
): Promise<{ result: ToolResult; payload?: DraftPayload }> {
  const responses: Record<string, unknown> = {
    "/ticket_articles/by_ticket/42": [
      {
        id: 7,
        sender: "Customer",
        type: "email",
        from: '"Schulz, Max" <max.schulz@klinikum.example>',
        to: '"BM1 • Support" <support@bm1.de>',
        subject: "AW: Anfrage",
        message_id: "<abc@klinikum.example>",
        created_at: "2026-06-24T06:45:49.098Z",
        ...headers,
      },
    ],
    "/ticket_articles/7": { body: "<div>Bitte prüfen.</div>" },
    "/users/me": { firstname: "Test", lastname: "Agent" },
    "/users/me?expand=true": { firstname: "Test", lastname: "Agent" },
    "/tickets/42": { group_id: 3 },
    "/tickets/42?expand=true": { id: 42, group_id: 3 },
    "/groups/3": { name: "Digital", email_address_id: 5 },
    "/email_addresses/5": { email: "support@bm1.de" },
    "/signatures/1": { body: "<div>#{user.firstname} #{user.lastname}</div>" },
  };

  let payload: DraftPayload | undefined;
  const client = {
    async request(
      path: string,
      opts: { method?: string; body?: unknown; params?: Record<string, unknown> } = {},
    ) {
      if (opts.method === "PUT") {
        payload = opts.body as DraftPayload;
        return { id: 1 };
      }
      const qs = new URLSearchParams(
        Object.entries(opts.params ?? {}).map(([k, v]) => [k, String(v)]),
      ).toString();
      const key = qs ? `${path}?${qs}` : path;
      if (!(key in responses)) throw new Error(`No mock response for: ${key}`);
      return responses[key];
    },
    fqdn: () => "mail.example",
  } as unknown as ZammadClient;

  let handler: ((args: Record<string, unknown>) => Promise<ToolResult>) | undefined;
  const server = {
    tool: (...args: unknown[]) => {
      handler = args[args.length - 1] as typeof handler;
    },
  } as unknown as McpServer;
  registerSharedDraftTools(server, client, config);

  const result = await handler!({
    ticket_id: 42,
    reply_html: "<div><div>Hallo Herr Schulz,</div><div><br></div><div>erledigt.</div></div>",
    signature_id: 1,
    extra_cc: extraCc,
  });
  return { result, payload };
}

test("shared draft writes CC as bare addresses (display name with a comma), drops self and duplicate extra_cc", async () => {
  const { result, payload } = await createDraft(
    {
      cc:
        '"Mustermann, Erika" <Erika.Mustermann@klinikum.example>, "BM1 • Support" <support@bm1.de>, ' +
        "Max Muster <max.muster@klinikum.example>",
    },
    ["erika.mustermann@klinikum.example", "neu@klinikum.example"],
  );
  assert.equal(result.isError, undefined, result.content[0]?.text);
  assert.equal(payload?.new_article.to, "max.schulz@klinikum.example");
  assert.equal(
    payload?.new_article.cc,
    "Erika.Mustermann@klinikum.example, max.muster@klinikum.example, neu@klinikum.example",
  );
});

test("shared draft moves the other To recipients into CC, without self and the sender", async () => {
  const { result, payload } = await createDraft({
    to:
      '"BM1 • Support" <support@bm1.de>, "Schulz, Max" <max.schulz@klinikum.example>, ' +
      "Kollegin Beispiel <kollegin@klinikum.example>",
    cc: '"Mustermann, Erika" <Erika.Mustermann@klinikum.example>',
  });
  assert.equal(result.isError, undefined, result.content[0]?.text);
  assert.equal(payload?.new_article.to, "max.schulz@klinikum.example");
  assert.equal(payload?.new_article.cc, "kollegin@klinikum.example, Erika.Mustermann@klinikum.example");
});
