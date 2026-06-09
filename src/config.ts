/**
 * Runtime configuration for the Zammad MCP server.
 *
 * All fields are optional except `zammadUrl` and `zammadHttpToken`. When a
 * field is empty, the related feature is disabled (e.g. an empty
 * `bannedNamePatterns` means no `SIGNATURE_DUPLICATE` check). This keeps the
 * public/generic server fully functional without any environment customisation
 * while letting BM1 (or any other deployment) inject opinionated defaults via
 * env-vars.
 */
export interface ServerConfig {
  /** Zammad REST base URL, e.g. `https://mail.example.com/api/v1/`. */
  zammadUrl: string;
  /** Zammad HTTP token (`Profile → Token Access`). */
  zammadHttpToken: string;
  /** Addresses that should never appear as CC of an outgoing reply. */
  selfEmails: string[];
  /**
   * Patterns of names that must not appear in `reply_html` because they're
   * part of the signature. Stored as raw strings, compiled to RegExp at
   * validation time. Match is case-sensitive and uses word-boundaries.
   */
  bannedNamePatterns: string[];
  /**
   * Greeting that the reply body must contain. When empty, the check is
   * skipped. Useful defaults: "Viele Grüße", "Mit freundlichen Grüßen",
   * "Best regards".
   */
  requiredGreeting: string;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const zammadUrl = env.ZAMMAD_URL?.trim();
  const zammadHttpToken = env.ZAMMAD_HTTP_TOKEN?.trim();

  if (!zammadUrl) {
    throw new Error(
      "ZAMMAD_URL environment variable is required, e.g. https://mail.example.com/api/v1/",
    );
  }
  if (!zammadHttpToken) {
    throw new Error(
      "ZAMMAD_HTTP_TOKEN environment variable is required. Generate a token in Zammad: Profile → Token Access",
    );
  }

  return {
    zammadUrl,
    zammadHttpToken,
    selfEmails: parseList(env.ZAMMAD_SELF_EMAILS),
    bannedNamePatterns: parseList(env.ZAMMAD_BANNED_NAMES),
    requiredGreeting: env.ZAMMAD_REQUIRED_GREETING?.trim() ?? "",
  };
}
