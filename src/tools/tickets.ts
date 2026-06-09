import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ZammadClient, ZammadError } from "../api-client.ts";

interface ZammadTicket {
  id: number;
  number?: string;
  title?: string;
  state?: string;
  state_id?: number;
  priority?: string;
  priority_id?: number;
  group?: string;
  group_id?: number;
  customer?: string;
  customer_id?: number;
  owner?: string;
  owner_id?: number;
  organization?: string;
  organization_id?: number;
  article_count?: number;
  created_at?: string;
  updated_at?: string;
  close_at?: string | null;
  first_response_at?: string | null;
  last_contact_at?: string | null;
  last_contact_customer_at?: string | null;
  last_contact_agent_at?: string | null;
}

interface ZammadArticle {
  id: number;
  ticket_id?: number;
  sender?: string;
  type?: string;
  internal?: boolean;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  content_type?: string;
  message_id?: string;
  in_reply_to?: string;
  created_at?: string;
}

function summariseTicket(t: ZammadTicket) {
  return {
    id: t.id,
    number: t.number ?? null,
    title: t.title ?? null,
    state: t.state ?? null,
    priority: t.priority ?? null,
    group: t.group ?? null,
    customer: t.customer ?? null,
    owner: t.owner ?? null,
    organization: t.organization ?? null,
    article_count: t.article_count ?? null,
    created_at: t.created_at ?? null,
    updated_at: t.updated_at ?? null,
    close_at: t.close_at ?? null,
    last_contact_at: t.last_contact_at ?? null,
    last_contact_customer_at: t.last_contact_customer_at ?? null,
    last_contact_agent_at: t.last_contact_agent_at ?? null,
  };
}

function summariseArticle(a: ZammadArticle, includeBody: boolean) {
  const base: Record<string, unknown> = {
    id: a.id,
    sender: a.sender ?? null,
    type: a.type ?? null,
    internal: a.internal ?? null,
    from: a.from ?? null,
    to: a.to ?? null,
    cc: a.cc ?? null,
    subject: a.subject ?? null,
    content_type: a.content_type ?? null,
    message_id: a.message_id ?? null,
    in_reply_to: a.in_reply_to ?? null,
    created_at: a.created_at ?? null,
  };
  if (includeBody) {
    base.body = a.body ?? null;
  }
  return base;
}

export function registerTicketTools(server: McpServer, client: ZammadClient) {
  server.tool(
    "zammad_get_ticket_thread",
    [
      "Fetch a Zammad ticket together with all of its articles in a single call.",
      "Combines /tickets/<id>?expand=true and /ticket_articles/by_ticket/<id>",
      "so the model gets ticket meta + full conversation in one round-trip.",
      "Use this instead of basher's get_ticket whenever you need the actual",
      "article bodies for context (e.g. to write a draft reply).",
    ].join(" "),
    {
      ticket_id: z.number().int().positive().describe(
        "Zammad ticket ID (numeric, from URL: /#ticket/zoom/<id>).",
      ),
      include_internal: z.boolean().default(true).describe(
        "If false, internal notes are excluded from the response.",
      ),
      include_bodies: z.boolean().default(true).describe(
        "If false, only article meta (sender/type/from/to/subject/...) is returned, not the body. Use for cheap overviews of long threads.",
      ),
      max_articles: z.number().int().positive().optional().describe(
        "Cap the number of articles. If set, returns the most recent N articles.",
      ),
    },
    async ({ ticket_id, include_internal, include_bodies, max_articles }) => {
      try {
        const ticket = await client.request<ZammadTicket>(
          `/tickets/${ticket_id}`,
          { params: { expand: "true" } },
        );
        let articles = await client.request<ZammadArticle[]>(
          `/ticket_articles/by_ticket/${ticket_id}`,
        );
        if (!include_internal) {
          articles = articles.filter((a) => a.internal !== true);
        }
        const totalAfterFilter = articles.length;
        let truncated = false;
        if (max_articles && articles.length > max_articles) {
          articles = articles.slice(-max_articles);
          truncated = true;
        }

        const payload = {
          ok: true,
          ticket_url: `https://${client.fqdn()}/#ticket/zoom/${ticket_id}`,
          ticket: summariseTicket(ticket),
          article_count_returned: articles.length,
          article_count_total: totalAfterFilter,
          truncated,
          articles: articles.map((a) => summariseArticle(a, include_bodies)),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
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
