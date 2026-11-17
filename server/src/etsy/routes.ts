import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { codeChallengeFromVerifier, generateCodeVerifier, generateState } from "./pkce.js";
import { isEtsyConnected } from "./client.js";
import { syncNow } from "./sync.js";

const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
const SCOPES = "transactions_r listings_r shops_r";

// Short-lived; the OAuth dance completes within minutes, so in-memory is fine
// for a single-instance NAS deployment.
const pendingStates = new Map<string, string>();

export default async function etsyRoutes(app: FastifyInstance) {
  app.get("/etsy/status", async () => ({ connected: await isEtsyConnected() }));

  app.get("/etsy/connect", async (req, reply) => {
    const keystring = process.env.ETSY_API_KEYSTRING;
    const redirectUri = process.env.ETSY_REDIRECT_URI;
    if (!keystring || !redirectUri) {
      reply.code(400);
      return { error: "Set ETSY_API_KEYSTRING and ETSY_REDIRECT_URI in .env first" };
    }
    const verifier = generateCodeVerifier();
    const state = generateState();
    pendingStates.set(state, verifier);

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", keystring);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallengeFromVerifier(verifier));
    url.searchParams.set("code_challenge_method", "S256");

    reply.redirect(url.toString());
  });

  app.get("/etsy/callback", async (req, reply) => {
    const q = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    const verifier = pendingStates.get(q.state);
    if (!verifier) {
      reply.code(400);
      return { error: "Unknown or expired OAuth state — try /etsy/connect again" };
    }
    pendingStates.delete(q.state);

    const keystring = process.env.ETSY_API_KEYSTRING!;
    const redirectUri = process.env.ETSY_REDIRECT_URI!;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: keystring,
        redirect_uri: redirectUri,
        code: q.code,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      reply.code(502);
      return { error: `Etsy token exchange failed: ${res.status} ${await res.text()}` };
    }
    const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

    await db.etsyCredentials.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        tokenExpiresAt: new Date(Date.now() + json.expires_in * 1000),
      },
      update: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        tokenExpiresAt: new Date(Date.now() + json.expires_in * 1000),
      },
    });

    return { connected: true };
  });

  app.post("/etsy/sync-now", async () => syncNow());
}
