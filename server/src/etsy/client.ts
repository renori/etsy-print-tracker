import { db } from "../lib/db.js";

const API_BASE = process.env.ETSY_API_BASE ?? "https://openapi.etsy.com/v3/application"; // override only for testing
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

function keystring(): string {
  const key = process.env.ETSY_API_KEYSTRING;
  if (!key) throw new Error("ETSY_API_KEYSTRING is not set");
  return key;
}

// Since Feb 2026 Etsy rejects API calls whose x-api-key isn't "keystring:shared_secret".
function apiKeyHeader(): string {
  const secret = process.env.ETSY_SHARED_SECRET;
  if (!secret) throw new Error("ETSY_SHARED_SECRET is not set");
  return `${keystring()}:${secret}`;
}

export async function isEtsyConnected(): Promise<boolean> {
  const creds = await db.etsyCredentials.findUnique({ where: { id: 1 } });
  return !!creds?.accessToken;
}

async function refreshAccessToken(): Promise<string> {
  const creds = await db.etsyCredentials.findUniqueOrThrow({ where: { id: 1 } });
  if (!creds.refreshToken) throw new Error("No Etsy refresh token stored — reconnect via /etsy/connect");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: keystring(),
      refresh_token: creds.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Etsy token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

  await db.etsyCredentials.update({
    where: { id: 1 },
    data: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      tokenExpiresAt: new Date(Date.now() + json.expires_in * 1000),
    },
  });
  return json.access_token;
}

async function validAccessToken(): Promise<string> {
  const creds = await db.etsyCredentials.findUniqueOrThrow({ where: { id: 1 } });
  if (!creds.accessToken) throw new Error("Etsy is not connected — visit /etsy/connect");
  const expiresSoon = !creds.tokenExpiresAt || creds.tokenExpiresAt.getTime() < Date.now() + 60_000;
  return expiresSoon ? refreshAccessToken() : creds.accessToken;
}

export async function etsyGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const token = await validAccessToken();
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { "x-api-key": apiKeyHeader(), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Etsy API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
