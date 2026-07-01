import { createHmac } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 5 * 60;

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function signSupabaseJwt(payload: Record<string, unknown>, secret: string) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function serverConfig() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!appId || !appSecret || !supabaseJwtSecret) {
    return null;
  }

  return { appId, appSecret, supabaseJwtSecret };
}

export async function POST(request: Request) {
  const config = serverConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: {
          code: "server_auth_not_configured",
          message: "Set NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_SECRET, and SUPABASE_JWT_SECRET on the server.",
        },
      },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const privyAccessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!privyAccessToken) {
    return NextResponse.json(
      {
        error: {
          code: "missing_privy_token",
          message: "Missing Privy access token.",
        },
      },
      { status: 401 },
    );
  }

  try {
    const privy = new PrivyClient({ appId: config.appId, appSecret: config.appSecret });
    const verified = await privy.utils().auth().verifyAccessToken(privyAccessToken);
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(verified.expiration, now + TOKEN_TTL_SECONDS);
    const token = signSupabaseJwt(
      {
        aud: "authenticated",
        exp,
        iat: now,
        iss: "rubicon-nextjs",
        role: "authenticated",
        sub: verified.user_id,
        session_id: verified.session_id,
        privy_user_id: verified.user_id,
      },
      config.supabaseJwtSecret,
    );

    return NextResponse.json({
      token,
      expiresAt: exp,
      userId: verified.user_id,
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_privy_token",
          message: "Your Privy session could not be verified. Sign in again.",
        },
      },
      { status: 401 },
    );
  }
}
