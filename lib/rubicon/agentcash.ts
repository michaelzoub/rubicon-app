/** AgentCash settles whole-article x402 purchases in Base mainnet USDC. */
export const AGENTCASH_BASE_NETWORK = "eip155:8453";
export const AGENTCASH_BASE_NETWORK_LABEL = "Base Mainnet";

/** AgentCash is not available in production while the integration is in development. */
export function isAgentCashEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

/** Keep browser validation aligned with the database and gateway guards. */
export function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

/** Privy only marks a wallet linked after its ownership-verification flow. */
export function isLinkedEthereumWallet(account: unknown, address: string): boolean {
  if (!account || typeof account !== "object") return false;
  const candidate = account as { type?: unknown; chain_type?: unknown; address?: unknown };
  return (
    candidate.type === "wallet" &&
    candidate.chain_type === "ethereum" &&
    typeof candidate.address === "string" &&
    candidate.address.toLowerCase() === address.toLowerCase()
  );
}

/** AgentCash settings deliberately use only the creator's Privy embedded EVM wallet. */
export function isLinkedPrivyEthereumWallet(account: unknown, address: string): boolean {
  if (!isLinkedEthereumWallet(account, address)) return false;
  const candidate = account as { wallet_client_type?: unknown; connector_type?: unknown };
  return candidate.wallet_client_type === "privy" && candidate.connector_type === "embedded";
}
