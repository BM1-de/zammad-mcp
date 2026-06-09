import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSignature } from "../src/lib/signature.ts";
import type { ZammadClient } from "../src/api-client.ts";

// Minimal mock client — captures called paths and serves canned responses.
function mockClient(responses: Record<string, unknown>): ZammadClient {
  const called: string[] = [];
  const client = {
    async request<T>(path: string, opts?: { params?: Record<string, unknown> }): Promise<T> {
      let key = path;
      if (opts?.params) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(opts.params)) {
          if (v !== undefined && v !== "") qs.set(k, String(v));
        }
        const qsStr = qs.toString();
        if (qsStr) key = `${path}?${qsStr}`;
      }
      called.push(key);
      if (!(key in responses) && !(path in responses)) {
        throw new Error(`No mock response for: ${key}`);
      }
      return (responses[key] ?? responses[path]) as T;
    },
    fqdn() {
      return "mail.bm1.de";
    },
  } as unknown as ZammadClient;
  (client as unknown as { _called: string[] })._called = called;
  return client;
}

test("renderSignature resolves user.firstname + user.lastname", async () => {
  const client = mockClient({
    "/signatures/1": { body: "<div>#{user.firstname} #{user.lastname}</div>" },
    "/users/me?expand=true": { firstname: "Phillip", lastname: "Baumgärtner" },
    "/tickets/42?expand=true": { id: 42, group_id: 1 },
  });
  const result = await renderSignature(client, 1, 42);
  assert.equal(result, "<div>Phillip Baumgärtner</div>");
});

test("renderSignature strips HTML inside placeholders", async () => {
  const client = mockClient({
    "/signatures/1": {
      body: '<div>#{<a href="x">user.firstname</a>}</div>',
    },
    "/users/me?expand=true": { firstname: "Phillip", lastname: "Baumgärtner" },
    "/tickets/42?expand=true": { id: 42 },
  });
  const result = await renderSignature(client, 1, 42);
  assert.equal(result, "<div>Phillip</div>");
});

test("renderSignature lazy-loads ticket.group", async () => {
  const client = mockClient({
    "/signatures/1": { body: "<div>#{ticket.group.name}</div>" },
    "/users/me?expand=true": { firstname: "P", lastname: "B" },
    "/tickets/42?expand=true": { id: 42, group_id: 7 },
    "/groups/7": { id: 7, name: "Support" },
  });
  const result = await renderSignature(client, 1, 42);
  assert.equal(result, "<div>Support</div>");
});

test("renderSignature returns empty string for unknown placeholder", async () => {
  const client = mockClient({
    "/signatures/1": { body: "<div>Hallo #{user.does_not_exist}!</div>" },
    "/users/me?expand=true": { firstname: "P", lastname: "B" },
    "/tickets/42?expand=true": { id: 42 },
  });
  const result = await renderSignature(client, 1, 42);
  assert.equal(result, "<div>Hallo !</div>");
});

test("renderSignature dedupes repeated placeholders (one fetch per sub-object)", async () => {
  const client = mockClient({
    "/signatures/1": {
      body: "<div>#{ticket.group.name}, nochmal #{ticket.group.name}</div>",
    },
    "/users/me?expand=true": { firstname: "P", lastname: "B" },
    "/tickets/42?expand=true": { id: 42, group_id: 7 },
    "/groups/7": { id: 7, name: "Support" },
  });
  const result = await renderSignature(client, 1, 42);
  assert.equal(result, "<div>Support, nochmal Support</div>");

  const called = (client as unknown as { _called: string[] })._called;
  const groupCalls = called.filter((p) => p === "/groups/7").length;
  assert.equal(groupCalls, 1, "Sub-object should be cached, only fetched once");
});

test("renderSignature handles config.fqdn", async () => {
  const client = mockClient({
    "/signatures/1": { body: "<div>https://#{config.fqdn}/</div>" },
    "/users/me?expand=true": { firstname: "P", lastname: "B" },
    "/tickets/42?expand=true": { id: 42 },
  });
  const result = await renderSignature(client, 1, 42);
  assert.equal(result, "<div>https://mail.bm1.de/</div>");
});
