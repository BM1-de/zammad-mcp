#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZammadClient } from "./api-client.ts";
import { loadConfig } from "./config.ts";
import { registerSharedDraftTools } from "./tools/shared-drafts.ts";
import { registerTicketTools } from "./tools/tickets.ts";
import { registerInternalNoteTools } from "./tools/internal-notes.ts";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const client = new ZammadClient(config.zammadHttpToken, config.zammadUrl);

const server = new McpServer({
  name: "zammad-mcp",
  version: "0.1.0",
  description: "MCP Server for Zammad — automated shared drafts with strict reply-HTML validation, fresh signature rendering and German-localised quote blocks.",
});

registerSharedDraftTools(server, client, config);
registerTicketTools(server, client);
registerInternalNoteTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
