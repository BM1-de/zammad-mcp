import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ZammadClient, ZammadError } from "../api-client.ts";
import { validateReplyHtml } from "../lib/validate.ts";
import { renderSignature } from "../lib/signature.ts";
import {
  buildQuoteBlock,
  composeFinalBody,
  ensureMessageIdBrackets,
  extractEmail,
  filterSelfFromCc,
  stripSubjectPrefix,
} from "../lib/compose.ts";

interface ZammadArticle {
  id: number;
  sender?: string;
  type?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  message_id?: string;
  type_id?: number;
  created_at?: string;
  body?: string;
}

interface ZammadUser {
  firstname?: string;
  lastname?: string;
}

interface ZammadTicket {
  group_id?: number;
}

interface ZammadGroup {
  name?: string;
  email_address_id?: number;
}

interface ZammadEmailAddress {
  email?: string;
}

async function findReplyTargetArticle(
  client: ZammadClient,
  ticketId: number,
): Promise<ZammadArticle> {
  const articles = await client.request<ZammadArticle[]>(
    `/ticket_articles/by_ticket/${ticketId}`,
  );
  if (!articles.length) {
    throw new Error(`Ticket ${ticketId} hat keine Artikel — kein Reply möglich.`);
  }
  const customerEmails = articles.filter(
    (a) => a.sender === "Customer" && a.type === "email",
  );
  return customerEmails.length > 0 ? customerEmails[customerEmails.length - 1]! : articles[articles.length - 1]!;
}

async function buildFromHeader(client: ZammadClient, ticketId: number): Promise<string> {
  const user = await client.request<ZammadUser>("/users/me");
  const ticket = await client.request<ZammadTicket>(`/tickets/${ticketId}`);
  if (!ticket.group_id) {
    throw new Error(`Ticket ${ticketId} hat keine group_id — kann from-Header nicht bauen.`);
  }
  const group = await client.request<ZammadGroup>(`/groups/${ticket.group_id}`);
  if (!group.email_address_id) {
    throw new Error(
      `Group ${group.name ?? ticket.group_id} hat keine email_address_id — kein Fallback.`,
    );
  }
  const addr = await client.request<ZammadEmailAddress>(
    `/email_addresses/${group.email_address_id}`,
  );
  if (!addr.email) {
    throw new Error(`email_address ${group.email_address_id} hat kein email-Feld.`);
  }
  const display = `${(user.firstname ?? "").trim()} ${(user.lastname ?? "").trim()}`.trim();
  return display ? `${display} <${addr.email}>` : `<${addr.email}>`;
}

export function registerSharedDraftTools(server: McpServer, client: ZammadClient) {
  server.tool(
    "zammad_create_shared_draft",
    [
      "Erstellt oder überschreibt den Shared Draft für ein Zammad-Ticket als Reply-All-Email.",
      "Holt automatisch den letzten Customer-Artikel und setzt to/cc/subject/in_reply_to korrekt.",
      "Rendert die Signatur frisch (inkl. Platzhalter-Substitution) und hängt das Original als",
      "Zitatblock an. PUT-Semantik: bestehender Draft wird überschrieben.",
      "",
      "Reply-HTML-Pflicht-Konventionen (werden strikt validiert):",
      "- Nur <div>...</div>-Struktur, KEIN <p>, KEIN <br><br>.",
      "- Deutsche Anführungszeichen: „…\" (U+201E + U+201D), nie ASCII \".",
      "- Apostroph ’ (U+2019), nie ASCII '.",
      "- Mit „Viele Grüße\" enden — NICHT „Phillip\" schreiben (das macht die Signatur).",
    ].join(" "),
    {
      ticket_id: z.number().int().positive().describe(
        "Zammad Ticket-ID (aus URL: /#ticket/zoom/<id>).",
      ),
      reply_html: z.string().min(1).describe(
        "Reply-Body als HTML mit verschachtelten <div>s. Beispiel: " +
        "<div><div>Hallo Herr Müller,</div><div><br></div>" +
        "<div>vielen Dank für Ihre Nachricht …</div><div><br></div>" +
        "<div>Viele Grüße</div></div>",
      ),
      signature_id: z.number().int().positive().default(1).describe(
        "Signatur-ID aus /signatures (default: 1).",
      ),
      extra_cc: z.array(z.string().email()).default([]).describe(
        "Zusätzliche CC-Adressen, die über das automatische Reply-All hinaus gesetzt werden sollen.",
      ),
    },
    async ({ ticket_id, reply_html, signature_id, extra_cc }) => {
      const issues = validateReplyHtml(reply_html);
      if (issues.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: false, error: "INVALID_REPLY_HTML", issues },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const ref = await findReplyTargetArticle(client, ticket_id);

        const toEmail = extractEmail(ref.from);
        if (!toEmail) {
          throw new Error(`Letzter Artikel hat kein 'from' — Reply-To unklar.`);
        }
        const ccList = filterSelfFromCc(ref.cc);
        for (const extra of extra_cc) {
          if (!ccList.includes(extra)) ccList.push(extra);
        }
        const ccString = ccList.join(", ");

        const subject = `RE: ${stripSubjectPrefix(ref.subject)}`;
        const inReplyTo = ensureMessageIdBrackets(ref.message_id);

        const fromHeader = await buildFromHeader(client, ticket_id);

        const renderedSig = await renderSignature(client, signature_id, ticket_id);

        const fullArticle = await client.request<ZammadArticle>(
          `/ticket_articles/${ref.id}`,
        );
        const originalBody = fullArticle.body ?? "";
        if (!ref.created_at) {
          throw new Error(`Artikel ${ref.id} hat kein created_at — Zitatblock-Datum unmöglich.`);
        }
        const quoteBlock = buildQuoteBlock(ref.created_at, ref.from ?? "", originalBody);

        const finalBody = composeFinalBody(reply_html, renderedSig, signature_id, quoteBlock);

        const payload = {
          new_article: {
            body: finalBody,
            type: "email",
            type_id: 1,
            sender_id: 1,
            content_type: "text/html",
            internal: false,
            from: fromHeader,
            to: toEmail,
            cc: ccString,
            subject,
            in_reply_to: inReplyTo,
            subtype: "",
          },
          ticket_attributes: {},
        };

        const draftResp = await client.request<{ id?: number }>(
          `/tickets/${ticket_id}/shared_draft`,
          { method: "PUT", body: payload },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  ticket_url: `https://${client.fqdn()}/#ticket/zoom/${ticket_id}`,
                  to: toEmail,
                  cc: ccString,
                  from: fromHeader,
                  subject,
                  in_reply_to: inReplyTo,
                  reference_article_id: ref.id,
                  draft_id: draftResp.id ?? null,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof ZammadError
          ? `Zammad API Fehler (${err.status}) auf ${err.path}: ${err.bodyText}`
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
