const DEFAULT_BASE_URL = "https://mail.bm1.de/api/v1/";

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

export class ZammadError extends Error {
  status: number;
  bodyText: string;
  path: string;

  constructor(status: number, bodyText: string, path: string) {
    super(`Zammad API ${status} on ${path}: ${bodyText}`);
    this.name = "ZammadError";
    this.status = status;
    this.bodyText = bodyText;
    this.path = path;
  }
}

export class ZammadClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, params } = options;

    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : "/" + path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Token token=${this.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ZammadError(response.status, text, path);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  fqdn(): string {
    return new URL(this.baseUrl).host;
  }
}
