/**
 * Network configuration for Rubicon.
 *
 * Transactions settle on Arc — starting on Arc Testnet. Arc is Circle's
 * USDC-native L1 (USDC is the gas token). Keep this local instead of importing
 * from `viem/chains`, whose barrel export pulls every chain into the bundle.
 */
import { defineChain } from "viem/chains/utils";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        "https://rpc.testnet.arc.network",
        "https://rpc.quicknode.testnet.arc.network",
        "https://rpc.blockdaemon.testnet.arc.network",
      ],
      webSocket: [
        "wss://rpc.testnet.arc.network",
        "wss://rpc.quicknode.testnet.arc.network",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
      apiUrl: "https://testnet.arcscan.app/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 0,
    },
  },
  testnet: true,
});

/** The chain the app currently operates on. Swap to Arc mainnet when ready. */
export const ACTIVE_CHAIN = arcTestnet;

/** CAIP-2 network identifier for the active chain (e.g. "eip155:5042002").
 *  Used to filter Circle Gateway x402 transfers by network. */
export const ACTIVE_CHAIN_CAIP2 = `eip155:${ACTIVE_CHAIN.id}`;

/** Value stored in `creator_wallets.network` for receiving wallets. */
export const RECEIVING_NETWORK = "arc-testnet";

/** Human-readable label for the active network. */
export const RECEIVING_NETWORK_LABEL = ACTIVE_CHAIN.name;
