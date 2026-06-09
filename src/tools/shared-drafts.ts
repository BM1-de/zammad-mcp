import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ZammadClient, ZammadError } from "../api-client.ts";
import { validateReplyHtml } from "../lib/validate.ts";
import { renderSignature } from "../lib/signature.ts";
import type { ServerConfig } from "../config.ts";
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
    throw new Error(`Ticket ${ticketId} has no articles — cannot build a reply.`);
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
    throw new Error(`Ticket ${ticketId} has no group_id — cannot build a from-header.`);
  }
  const group = await client.request<ZammadGroup>(`/groups/${ticket.group_id}`);
  if (!group.email_address_id) {
    throw new Error(
      `Group "${group.name ?? ticket.group_id}" has no email_address_id and there is no fallback.`,
    );
  }
  const addr = await client.request<ZammadEmailAddress>(
    `/email_addresses/${group.email_address_id}`,
  );
  if (!addr.email) {
    throw new Error(`email_address ${group.email_address_id} has no email field.`);
  }
  const display = `${(user.firstname ?? "").trim()} ${(user.lastname ?? "").trim()}`.trim();
  return display ? `${display} <${addr.email}>` : `<${addr.email}>`;
}

export function registerSharedDraftTools(
  server: McpServer,
  client: ZammadClient,
  config: ServerConfig,
) {
  server.tool(
    "zammad_create_shared_draft",
    [
      "Create or overwrite the shared draft of a Zammad ticket as a Reply-All email.",
      "Auto-detects the most recent customer article and derives to/cc/subject/in_reply_to from it.",
      "Renders the agent's signature fresh from Zammad (with placeholder substitution and lazy",
      "loading of related objects) and appends the original article as a localised <blockquote>.",
      "PUT semantics: any existing draft on the ticket is overwritten.",
      "",
      "reply_html validation (always on for universal rules, conditional for configured ones):",
      "- universal: no top-level <p>, no <br><br>, no ASCII straight quotes \", no ASCII apostrophe ' inside words",
      "- when ZAMMAD_BANNED_NAMES is set: body must not contain any banned name",
      "- when ZAMMAD_REQUIRED_GREETING is set: body must contain that greeting",
    ].join(" "),
    {
      ticket_id: z.number().int().positive().describe(
        "Zammad ticket ID (numeric, from URL: /#ticket/zoom/<id>).",
      ),
      reply_html: z.string().min(1).describe(
        "Reply body as HTML with a nested <div> structure. Example: " +
        "<div><div>Hello Mr Smith,</div><div><br></div>" +
        "<div>thank you for your message ...</div><div><br></div>" +
        "<div>Best regards</div></div>",
      ),
      signature_id: z.number().int().positive().default(1).describe(
        "Signature ID from /signatures (default: 1).",
      ),
      extra_cc: z.array(z.string().email()).default([]).describe(
        "Additional CC addresses to add on top of the automatic Reply-All set.",
      ),
      quote_locale: z.enum(["en", "de"]).optional().describe(
        "Locale for the quote block lead-in. 'en' → \"On Tuesday, 9 June 2026 at 10:00:00, X wrote:\". " +
        "'de' → \"Am Dienstag, 09. Juni 2026 um 10:00:00, schrieb X:\". " +
        "When omitted, falls back to ZAMMAD_QUOTE_LOCALE (server default).",
      ),
    },
    async ({ ticket_id, reply_html, signature_id, extra_cc, quote_locale }) => {
      const effectiveLocale = quote_locale ?? config.defaultQuoteLocale;
      const issues = validateReplyHtml(reply_html, {
        bannedNamePatterns: config.bannedNamePatterns,
        requiredGreeting: config.requiredGreeting,
        locale: effectiveLocale,
      });
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
          throw new Error("The reference article has no 'from' header — reply target is unknown.");
        }
        const ccList = filterSelfFromCc(ref.cc, config.selfEmails);
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
          throw new Error(`Article ${ref.id} has no created_at — cannot build a quote-block date.`);
        }
        const quoteBlock = buildQuoteBlock(
          ref.created_at,
          ref.from ?? "",
          originalBody,
          effectiveLocale,
        );

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
                  quote_locale: effectiveLocale,
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
