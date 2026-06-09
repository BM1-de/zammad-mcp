import { ZammadClient } from "../api-client.ts";

type SubLoader = (oid: number) => Promise<Record<string, unknown>>;

function stripTagsInsidePlaceholders(template: string): string {
  let prev = "";
  let cur = template;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/#\{([^{}]*?)\}/g, (_, inner: string) =>
      "#{" + inner.replace(/<[^>]+>/g, "") + "}",
    );
  }
  return cur;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function renderSignature(
  client: ZammadClient,
  signatureId: number,
  ticketId: number,
): Promise<string> {
  const sigResp = await client.request<{ body?: string }>(`/signatures/${signatureId}`);
  let body = sigResp.body ?? "";
  body = stripTagsInsidePlaceholders(body);

  const userMe = await client.request<Record<string, unknown>>("/users/me", { params: { expand: "true" } });
  const ticket = await client.request<Record<string, unknown>>(`/tickets/${ticketId}`, { params: { expand: "true" } });

  const cache = new Map<string, Record<string, unknown>>();
  const cached = async (key: string, loader: () => Promise<Record<string, unknown>>) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const val = await loader();
    cache.set(key, val);
    return val;
  };

  const subLoaders: Record<string, SubLoader> = {
    group: (oid) => client.request<Record<string, unknown>>(`/groups/${oid}`),
    customer: (oid) => client.request<Record<string, unknown>>(`/users/${oid}`, { params: { expand: "true" } }),
    owner: (oid) => client.request<Record<string, unknown>>(`/users/${oid}`, { params: { expand: "true" } }),
    organization: (oid) => client.request<Record<string, unknown>>(`/organizations/${oid}`),
    created_by: (oid) => client.request<Record<string, unknown>>(`/users/${oid}`, { params: { expand: "true" } }),
    updated_by: (oid) => client.request<Record<string, unknown>>(`/users/${oid}`, { params: { expand: "true" } }),
  };

  const roots: Record<string, Record<string, unknown>> = {
    user: userMe,
    current_user: userMe,
    ticket,
    config: { fqdn: client.fqdn(), http_type: "https" },
  };

  const resolve = async (path: string): Promise<string> => {
    const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return "";
    let obj: unknown = roots[parts[0]!];
    if (obj === undefined) return "";

    for (const seg of parts.slice(1)) {
      if (obj === null || obj === undefined) return "";
      if (!isPlainObject(obj)) return "";

      // Direct field access — but if the field is a string AND there's a *_id alongside,
      // we may need to deep-load when more path segments follow.
      const directVal = obj[seg];
      const idVal = obj[`${seg}_id`];

      if (directVal !== undefined && !(typeof directVal === "string" && typeof idVal === "number")) {
        obj = directVal;
        continue;
      }

      // Lazy-load via *_id + sub-loader
      if (typeof idVal === "number" && subLoaders[seg]) {
        const key = `${seg}:${idVal}`;
        obj = await cached(key, () => subLoaders[seg]!(idVal));
        continue;
      }

      // Fallback: take string value if present (terminal access)
      if (directVal !== undefined) {
        obj = directVal;
        continue;
      }

      return "";
    }
    return obj === null || obj === undefined ? "" : String(obj);
  };

  // Collect unique placeholders, resolve each once, then global-replace.
  const placeholders = Array.from(body.matchAll(/#\{([^{}]*?)\}/g));
  const resolved = new Map<string, string>();
  for (const m of placeholders) {
    const literal = m[0];
    if (resolved.has(literal)) continue;
    const inner = m[1]!.replace(/<[^>]+>/g, "").trim();
    resolved.set(literal, await resolve(inner));
  }
  for (const [literal, value] of resolved) {
    body = body.split(literal).join(value);
  }

  // Cleanup: empty paragraphs / trailing empty divs from missing fields
  body = body.replace(/<p>\s*<\/p>\s*/g, "");
  body = body.replace(/(<div>\s*<\/div>\s*)+$/g, "");

  return body;
}
