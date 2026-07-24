import { PrivyClient } from "@privy-io/node";
import { NextResponse } from "next/server";
import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { AGENTCASH_BASE_NETWORK, isAgentCashEnabled, isEvmAddress, isLinkedPrivyEthereumWallet } from "@/lib/rubicon/agentcash";
import { ImportServerError, serviceClient } from "@/lib/rubicon/import-server";

export const runtime = "nodejs";

interface SaveWalletBody {
  address?: string;
}

/**
 * Persist a Base recipient only after Privy confirms that the authenticated
 * creator has linked that exact EVM address. The browser never chooses the
 * verified flag and this route never reads or handles private key material.
 */
export async function POST(request: Request) {
  if (!isAgentCashEnabled()) return error(404, "not_found", "Not found.");

  try {
    const creatorId = await authenticatePrivyRequest(request);
    const body = (await request.json().catch(() => ({}))) as SaveWalletBody;
    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (!isEvmAddress(address)) return error(400, "invalid_wallet_address", "Connect a valid EVM wallet before saving it for AgentCash.");

    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) throw new ImportServerError(500, "server_auth_not_configured", "Wallet verification is not configured.");

    const user = await new PrivyClient({ appId, appSecret }).users()._get(creatorId);
    if (!user.linked_accounts.some((account) => isLinkedPrivyEthereumWallet(account, address))) {
      return error(403, "wallet_not_embedded", "Use your Privy embedded EVM wallet for AgentCash.");
    }

    const { data, error: dbError } = await serviceClient()
      .from("creator_wallets")
      .upsert(
        {
          creator_id: creatorId,
          address,
          network: AGENTCASH_BASE_NETWORK,
          verified: true,
        },
        { onConflict: "creator_id,network" },
      )
      .select("address, network, verified")
      .single<{ address: string; network: string; verified: boolean }>();
    if (dbError || !data) {
      if (dbError?.code === "42P10") {
        throw new ImportServerError(503, "wallet_schema_pending", "Base wallet setup is not available yet. Apply the creator-wallet network migration, then try again.");
      }
      throw new ImportServerError(500, "wallet_save_failed", "Could not save the Base wallet.");
    }

    return NextResponse.json({ wallet: data });
  } catch (cause) {
    if (cause instanceof ImportServerError) return error(cause.status, cause.code, cause.message);
    return error(500, "wallet_verification_failed", "Could not verify this wallet with Privy.");
  }
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
