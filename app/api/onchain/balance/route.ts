import { createPublicClient, formatUnits, http, isAddress } from "viem";
import { NextResponse } from "next/server";
import { ACTIVE_CHAIN } from "@/lib/chain";

export const runtime = "nodejs";

// Prefer the Canteen RPC (carries a secret token, server-only). Fall back to the
// chain's public RPC so balances still load if ARC_RPC_URL isn't configured.
const transport = http(process.env.ARC_RPC_URL || undefined);
const publicClient = createPublicClient({ chain: ACTIVE_CHAIN, transport });

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid address query param is required." }, { status: 400 });
  }

  try {
    const balance = await publicClient.getBalance({ address });
    return NextResponse.json({
      value: formatUnits(balance, ACTIVE_CHAIN.nativeCurrency.decimals),
      symbol: ACTIVE_CHAIN.nativeCurrency.symbol,
      chainId: ACTIVE_CHAIN.id,
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the Arc RPC." }, { status: 502 });
  }
}
