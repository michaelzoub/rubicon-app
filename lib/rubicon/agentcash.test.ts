import { describe, expect, it } from "vitest";
import { AGENTCASH_BASE_NETWORK, isAgentCashEnabled, isEvmAddress, isLinkedEthereumWallet, isLinkedPrivyEthereumWallet } from "./agentcash";

describe("AgentCash Base wallet contract", () => {
  it("uses Base mainnet's CAIP-2 identifier", () => {
    expect(AGENTCASH_BASE_NETWORK).toBe("eip155:8453");
  });

  it("is unavailable outside development", () => {
    expect(isAgentCashEnabled()).toBe(false);
  });

  it("accepts only full EVM addresses", () => {
    expect(isEvmAddress("0x1234567890abcdef1234567890ABCDEF12345678")).toBe(true);
    expect(isEvmAddress("0x1234")).toBe(false);
    expect(isEvmAddress("not-an-address")).toBe(false);
  });

  it("accepts only a linked Ethereum wallet for ownership verification", () => {
    const address = "0x1234567890abcdef1234567890ABCDEF12345678";
    expect(isLinkedEthereumWallet({ type: "wallet", chain_type: "ethereum", address }, address)).toBe(true);
    expect(isLinkedEthereumWallet({ type: "wallet", chain_type: "solana", address }, address)).toBe(false);
    expect(isLinkedEthereumWallet({ type: "wallet", chain_type: "ethereum", address: "0x0000000000000000000000000000000000000000" }, address)).toBe(false);
  });

  it("rejects external wallets from the embedded-only AgentCash flow", () => {
    const address = "0x1234567890abcdef1234567890ABCDEF12345678";
    expect(isLinkedPrivyEthereumWallet({ type: "wallet", chain_type: "ethereum", address, wallet_client_type: "privy", connector_type: "embedded" }, address)).toBe(true);
    expect(isLinkedPrivyEthereumWallet({ type: "wallet", chain_type: "ethereum", address, wallet_client_type: "metamask", connector_type: "injected" }, address)).toBe(false);
  });
});
