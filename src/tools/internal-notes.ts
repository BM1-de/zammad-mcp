import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ZammadClient, ZammadError } from "../api-client.ts";

interface CreatedArticle {
  id?: number;
  ticket_id?: number;
  type?: string;
  internal?: boolean;
}

export function registerInternalNoteTools(server: McpServer, client: ZammadClient) {
  server.tool(
    "zammad_add_internal_note",
    [
      "Add an internal note to a Zammad ticket. Internal notes are visible to",
      "agents only and never delivered as email — this tool hard-codes type='note'",
      "and internal=true so you cannot accidentally send an email to the customer.",
      "If you need to send something to the customer, use zammad_create_shared_draft",
      "instead (and let a human send it manually from the Zammad UI).",
    ].join(" "),
    {
      ticket_id: z.number().int().positive().describe(
        "Zammad ticket ID (numeric, from URL: /#ticket/zoom/<id>).",
      ),
      body: z.string().min(1).describe(
        "Body of the note. Format depends on content_type. For text/html: use plain HTML, " +
        "nothing fancy needed (no signature, no quote block — this is an internal note). " +
        "For text/plain: newlines are preserved.",
      ),
      content_type: z.enum(["text/html", "text/plain"]).default("text/html").describe(
        "MIME type of the body. Default: text/html.",
      ),
      subject: z.string().optional().describe(
        "Optional subject for the note. Most Zammad UIs render the body only; the subject is mostly for the article list.",
      ),
    },
    async ({ ticket_id, body, content_type, subject }) => {
      try {
        const payload: Record<string, unknown> = {
          ticket_id,
          body,
          type: "note",         // hard-coded — never "email"
          internal: true,       // hard-coded — never customer-visible
          sender: "Agent",
          content_type,
        };
        if (subject) payload.subject = subject;

        const created = await client.request<CreatedArticle>(
          "/ticket_articles",
          { method: "POST", body: payload },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  ticket_url: `https://${client.fqdn()}/#ticket/zoom/${ticket_id}`,
                  article_id: created.id ?? null,
                  type: created.type ?? "note",
                  internal: created.internal ?? true,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof ZammadError
          ? `Zammad API error (${err.status}) on ${err.path}: ${err.bodyText}`
          : err instanceof Error
            ? err.message
            : String(err);
        return {
          content: [
            { type: "text", text: JSON.stringify({ ok: false, error: msg }, null, 2) },
          ],
          isError: true,
        };
      }
    },
  );
}
