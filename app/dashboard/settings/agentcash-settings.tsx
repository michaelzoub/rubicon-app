"use client";

import { getEmbeddedConnectedWallet, useCreateWallet, useWallets } from "@privy-io/react-auth";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { AGENTCASH_BASE_NETWORK, AGENTCASH_BASE_NETWORK_LABEL, isAgentCashEnabled } from "@/lib/rubicon/agentcash";
import { useRubiconMutation, useRubiconQuery } from "@/lib/rubicon/hooks";
import { Card, CardHeader, ErrorState, LoadingState, WalletStatePill } from "../_components/ui";
import { Reveal } from "../_components/charts";

export function AgentCashSettings() {
  const enabled = isAgentCashEnabled();
  const wallet = useRubiconQuery((c) => c.getAgentCashWallet(), [], { enabled, queryKey: ["agentcash-wallet"] });
  const updateWallet = useRubiconMutation((c, input: { address: string }) => c.updateAgentCashWallet(input));

  if (!enabled) return null;

  return (
    <Reveal delay={0.08}>
      <Card id="agentcash-wallet" className="scroll-mt-6">
        <CardHeader title="AgentCash on Base" />
        <div className="grid gap-4 p-5">
          {wallet.status === "loading" && <LoadingState />}
          {wallet.status === "error" && wallet.error && <ErrorState error={wallet.error} onRetry={wallet.refetch} />}
          {wallet.status === "success" && (
            <AgentCashWalletEditor
              address={wallet.data?.address ?? ""}
              verified={wallet.data?.verified ?? false}
              pending={updateWallet.pending}
              error={updateWallet.error?.message ?? null}
              onSave={async (address) => {
                await updateWallet.run({ address });
                wallet.refetch();
              }}
            />
          )}
        </div>
      </Card>
    </Reveal>
  );
}

function AgentCashWalletEditor({
  address,
  verified,
  pending,
  error,
  onSave,
}: {
  address: string;
  verified: boolean;
  pending: boolean;
  error: string | null;
  onSave: (address: string) => Promise<void>;
}) {
  const { ready, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const embedded = getEmbeddedConnectedWallet(wallets);

  const persist = async (walletAddress: string) => {
    setLocalError(null);
    setBusy(true);
    try {
      await onSave(walletAddress);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Could not save this Base wallet. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const useEmbeddedWallet = async () => {
    let walletAddress = embedded?.address ?? "";
    if (!walletAddress) {
      setBusy(true);
      try {
        const created = await createWallet();
        walletAddress = created?.address ?? "";
      } catch {
        setLocalError("Could not create an embedded EVM wallet. Try again.");
      } finally {
        setBusy(false);
      }
    }
    if (walletAddress) await persist(walletAddress);
  };

  const working = busy || pending;
  const shownError = localError ?? error;

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">Receive AgentCash payments</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Use a creator-owned EVM wallet for Base USDC x402 purchases.</p>
          </div>
          {address && <WalletStatePill verified={verified} />}
        </div>

        {address ? (
          <div className="mt-4 grid gap-1 rounded-lg border border-[var(--line)] bg-white px-3 py-2.5">
            <span className="mono truncate text-sm">{address}</span>
            <span className="text-xs text-[var(--muted)]">{AGENTCASH_BASE_NETWORK_LABEL} · {AGENTCASH_BASE_NETWORK} · {verified ? "Ownership verified" : "Verification required"}</span>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">No Base wallet connected yet.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void useEmbeddedWallet()}
            disabled={!ready || working}
            className="button button-primary min-h-10 text-sm disabled:opacity-50"
          >
            <Wallet size={15} aria-hidden="true" /> {working ? "Confirming…" : address ? "Use my Privy wallet" : "Connect Base wallet"}
          </button>
        </div>
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">This uses your Privy embedded EVM wallet. Rubicon stores only its public address, network, and verification state, never a private key.</p>
      {shownError && <p className="rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]" role="alert">{shownError}</p>}
    </div>
  );
}
