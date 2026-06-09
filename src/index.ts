#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZammadClient } from "./api-client.ts";
import { registerSharedDraftTools } from "./tools/shared-drafts.ts";

const token = process.env.ZAMMAD_HTTP_TOKEN;
if (!token) {
  console.error("Error: ZAMMAD_HTTP_TOKEN environment variable is required.");
  console.error("Generate a token in Zammad: Profile → Token Access");
  process.exit(1);
}

const baseUrl = process.env.ZAMMAD_URL;
const client = new ZammadClient(token, baseUrl);

const server = new McpServer({
  name: "zammad-mcp",
  version: "0.1.0",
  description: "MCP Server für Zammad — BM1-spezifische Workflows (Shared Drafts und mehr).",
});

registerSharedDraftTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
