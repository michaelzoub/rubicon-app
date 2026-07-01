import { createPublicClient, http, isAddress, parseUnits } from "viem";
import { NextResponse } from "next/server";
import { ACTIVE_CHAIN } from "@/lib/chain";
import {
  ARC_GATEWAY_DOMAIN,
  GATEWAY_WALLET_ABI,
  GATEWAY_WALLET_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/gateway";

export const runtime = "nodejs";

// Available (spendable) balance comes from Circle's Gateway accounting API; the
// withdrawing balance and maturity block are on-chain reads. The Gateway API is
// unauthenticated, like /v1/x402/transfers. Default to testnet.
const GATEWAY_API_URL = process.env.CIRCLE_GATEWAY_API_URL || "https://gateway-api-testnet.circle.com";

const transport = http(process.env.ARC_RPC_URL || undefined);
const publicClient = createPublicClient({ chain: ACTIVE_CHAIN, transport });

async function fetchAvailableAtomic(depositor: `0x${string}`): Promise<bigint | null> {
  const res = await fetch(new URL("/v1/balances", GATEWAY_API_URL), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      token: "USDC",
      sources: [{ domain: ARC_GATEWAY_DOMAIN, depositor }],
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { balances?: Array<{ balance?: string }> };
  const decimal = body.balances?.[0]?.balance;
  if (!decimal) return BigInt(0);
  return parseUnits(decimal as `${number}`, USDC_DECIMALS);
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid address query param is required." }, { status: 400 });
  }
  const depositor = address as `0x${string}`;

  try {
    const [withdrawingBalance, withdrawalBlock, currentBlock, availableAtomic] = await Promise.all([
      publicClient.readContract({
        address: GATEWAY_WALLET_ADDRESS,
        abi: GATEWAY_WALLET_ABI,
        functionName: "withdrawingBalance",
        args: [USDC_ADDRESS, depositor],
      }),
      publicClient.readContract({
        address: GATEWAY_WALLET_ADDRESS,
        abi: GATEWAY_WALLET_ABI,
        functionName: "withdrawalBlock",
        args: [USDC_ADDRESS, depositor],
      }),
      publicClient.getBlockNumber(),
      // Resilient: a Gateway API hiccup shouldn't hide a pending withdrawal.
      fetchAvailableAtomic(depositor).catch(() => null),
    ]);

    return NextResponse.json({
      availableAtomic: availableAtomic === null ? null : availableAtomic.toString(),
      withdrawingAtomic: withdrawingBalance.toString(),
      withdrawalBlock: withdrawalBlock.toString(),
      currentBlock: currentBlock.toString(),
    });
  } catch {
    return NextResponse.json({ error: "Could not read Gateway balance." }, { status: 502 });
  }
}
