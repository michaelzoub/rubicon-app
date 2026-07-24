import { createPublicClient, fallback, formatUnits, http, isAddress } from "viem";
import { NextResponse } from "next/server";
import { ACTIVE_CHAIN } from "@/lib/chain";

export const runtime = "nodejs";

// Prefer the Canteen RPC (carries a secret token, server-only), but retain the
// chain's public endpoints as actual failover transports. A preview deployment
// can otherwise show an unavailable balance whenever its ARC_RPC_URL is stale.
const rpcUrls = [
  ...(process.env.ARC_RPC_URL ? [process.env.ARC_RPC_URL] : []),
  ...ACTIVE_CHAIN.rpcUrls.default.http,
];
const transport = fallback([...new Set(rpcUrls)].map((url) => http(url)), { rank: false });
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
