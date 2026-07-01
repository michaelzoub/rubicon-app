import { PrivyClient } from "@privy-io/node";
import { ImportServerError } from "@/lib/rubicon/import-server";

export async function authenticatePrivyRequest(request: Request): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!appId || !appSecret) throw new ImportServerError(500, "server_auth_not_configured", "Import authentication is not configured.");
  if (!token) throw new ImportServerError(401, "missing_token", "Sign in before importing.");
  try {
    const verified = await new PrivyClient({ appId, appSecret }).utils().auth().verifyAccessToken(token);
    return verified.user_id;
  } catch {
    throw new ImportServerError(401, "invalid_token", "Your session expired. Sign in again.");
  }
}
