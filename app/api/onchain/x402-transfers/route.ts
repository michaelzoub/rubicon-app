import { isAddress } from "viem";
import { NextResponse } from "next/server";
import { ACTIVE_CHAIN_CAIP2 } from "@/lib/chain";

export const runtime = "nodejs";

// Circle Gateway x402 transfers API. Nanopayments settle to Gateway transfer
// records (UUID ids), not on-chain ERC-20 hashes, so the dashboard reads
// settlement state straight from Circle rather than from a block explorer or
// the local database. Testnet by default; override for mainnet.
const GATEWAY_API_URL = process.env.CIRCLE_GATEWAY_API_URL || "https://gateway-api-testnet.circle.com";

// The endpoint is unauthenticated (security: []), but we proxy it server-side
// to keep the base URL configurable and to paginate without CORS surprises.
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

type CircleTransfer = {
  id: string;
  status: "received" | "batched" | "confirmed" | "completed" | "failed";
  token: string;
  sendingNetwork: string;
  recipientNetwork: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  createdAt: string;
  updatedAt: string;
};

// Circle paginates with an RFC-5988 Link header. The cursor is an opaque base64
// token carried in the `rel="next"` URL — it is not echoed in the body and is
// not the resource id. Follow `next` until it's absent.
function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) return match[1];
  }
  return null;
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid address query param is required." }, { status: 400 });
  }

  const first = new URL("/v1/x402/transfers", GATEWAY_API_URL);
  first.searchParams.set("to", address);
  first.searchParams.set("network", ACTIVE_CHAIN_CAIP2);
  first.searchParams.set("token", "USDC");
  first.searchParams.set("pageSize", `${PAGE_SIZE}`);

  const transfers: CircleTransfer[] = [];
  let url: string | null = first.toString();

  try {
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      const res: Response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json({ error: "Circle Gateway transfers request failed." }, { status: 502 });
      }

      const body = (await res.json()) as { transfers?: CircleTransfer[] };
      const batch = body.transfers ?? [];
      transfers.push(...batch);

      // Stop on an empty page even if Circle keeps handing back a `next` link.
      url = batch.length === 0 ? null : nextLink(res.headers.get("link"));
    }

    return NextResponse.json({ transfers });
  } catch {
    return NextResponse.json({ error: "Could not reach the Circle Gateway API." }, { status: 502 });
  }
}
