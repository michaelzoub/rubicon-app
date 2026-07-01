"use client";

import { useEffect, useState } from "react";
import { getEmbeddedConnectedWallet, useWallets } from "@privy-io/react-auth";
import { ExternalLink, Loader2, X } from "lucide-react";
import { ACTIVE_CHAIN } from "@/lib/chain";
import { formatBalance, useNativeBalance } from "@/lib/onchain";
import {
  WITHDRAWAL_DELAY_DAYS,
  explorerTxUrl,
  formatUsdc,
  parseUsdcAmount,
  validateDestination,
  validateWithdrawAmount,
} from "@/lib/gateway";
import {
  completeWithdrawal,
  initiateWithdrawal,
  useGatewayBalance,
  type CompleteResult,
} from "@/lib/gateway-client";

type Props = { open: boolean; onClose: () => void; walletAddress: string };

type DoneState =
  | { type: "initiated"; hash: `0x${string}` }
  | { type: "completed"; result: CompleteResult };

function intentKey(address: string): string {
  return `rubicon.withdraw.${ACTIVE_CHAIN.id}.${address.toLowerCase()}`;
}

function readIntentDestination(address: string): string | null {
  try {
    const raw = localStorage.getItem(intentKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { destination?: string };
    return parsed.destination ?? null;
  } catch {
    return null;
  }
}

export function WithdrawDialog({ open, onClose, walletAddress }: Props) {
  const { wallets } = useWallets();
  const wallet = getEmbeddedConnectedWallet(wallets);
  const balance = useGatewayBalance(open ? walletAddress : null);
  const gasBalance = useNativeBalance(open && wallet ? wallet.address : null);

  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState(walletAddress);
  const [busy, setBusy] = useState<null | "initiating" | "completing">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);

  useEffect(() => {
    if (open) {
      setAmount("");
      setDestination(walletAddress);
      setBusy(null);
      setActionError(null);
      setDone(null);
    }
  }, [open, walletAddress]);

  if (!open) return null;

  const available = balance.availableAtomic ?? BigInt(0);
  const hasPending = balance.withdrawingAtomic > BigInt(0);
  const matured = hasPending && balance.withdrawalBlock > BigInt(0) && balance.currentBlock >= balance.withdrawalBlock;
  const blocksRemaining =
    hasPending && balance.withdrawalBlock > balance.currentBlock
      ? balance.withdrawalBlock - balance.currentBlock
      : BigInt(0);

  const amountError = amount ? validateWithdrawAmount(amount, available) : null;
  const destError = validateDestination(destination);
  const differentDestination = destination.toLowerCase() !== walletAddress.toLowerCase();
  const gasMissing = gasBalance.status === "success" && Number(gasBalance.value ?? "0") <= 0;
  const canInitiate =
    balance.status === "success" &&
    !hasPending &&
    !!amount &&
    !amountError &&
    !destError &&
    available > BigInt(0) &&
    !!wallet &&
    !gasMissing;

  const close = () => {
    if (!busy) onClose();
  };

  const onInitiate = async () => {
    if (!wallet) {
      setActionError("Connect your wallet in Settings first.");
      return;
    }
    const parsed = parseUsdcAmount(amount);
    if (typeof parsed === "object") {
      setActionError(parsed.error);
      return;
    }
    setBusy("initiating");
    setActionError(null);
    try {
      localStorage.setItem(intentKey(walletAddress), JSON.stringify({ destination }));
      const hash = await initiateWithdrawal(wallet, parsed);
      setDone({ type: "initiated", hash });
      gasBalance.refetch();
      balance.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not initiate the withdrawal.");
    } finally {
      setBusy(null);
    }
  };

  const onComplete = async () => {
    if (!wallet) {
      setActionError("Connect your wallet in Settings first.");
      return;
    }
    setBusy("completing");
    setActionError(null);
    try {
      const saved = readIntentDestination(walletAddress);
      const dest = saved && validateDestination(saved) === null ? saved : wallet.address;
      const result = await completeWithdrawal(wallet, { destination: dest, amountAtomic: balance.withdrawingAtomic });
      localStorage.removeItem(intentKey(walletAddress));
      setDone({ type: "completed", result });
      gasBalance.refetch();
      balance.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not complete the withdrawal.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Withdraw USDC"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--faint)] px-5 py-4">
          <h2 className="text-base font-semibold">Withdraw USDC</h2>
          <button
            type="button"
            onClick={close}
            disabled={!!busy}
            className="text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-4 p-5">
          {balance.status === "loading" && (
            <div className="flex items-center gap-2 py-6 text-sm text-[var(--muted)]">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading your Gateway balance…
            </div>
          )}

          {balance.status === "error" && (
            <div className="grid gap-3 py-4">
              <p className="text-sm text-[#8d2f2d]">{balance.error ?? "Could not load your balance."}</p>
              <button
                type="button"
                onClick={() => balance.refetch()}
                className="justify-self-start rounded-md border border-[var(--line)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
              >
                Try again
              </button>
            </div>
          )}

          {balance.status === "success" && (
            <>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
                <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--muted)]">Available balance</div>
                <div className="mt-1 text-xl font-semibold">
                  {balance.availableAtomic === null ? "—" : formatUsdc(available)}
                  <span className="ml-1.5 text-sm font-medium text-[var(--muted)]">USDC</span>
                </div>
                {hasPending && (
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Pending withdrawal: {formatUsdc(balance.withdrawingAtomic)} USDC
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-[var(--faint)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-[var(--muted)]">Gas balance</span>
                  <span className="mono text-xs text-[var(--ink)]">
                    {gasBalance.status === "success" ? formatBalance(gasBalance.value) : "—"} {ACTIVE_CHAIN.nativeCurrency.symbol}
                  </span>
                </div>
                {gasBalance.status === "success" && Number(gasBalance.value ?? "0") <= 0 && (
                  <p className="mt-2 text-xs text-[#8d2f2d]">
                    Add {ACTIVE_CHAIN.nativeCurrency.symbol} on {ACTIVE_CHAIN.name} before withdrawing.
                  </p>
                )}
              </div>

              {done ? (
                <SuccessPanel done={done} differentDestination={differentDestination} />
              ) : hasPending ? (
                <div className="grid gap-3">
                  <p className="text-sm text-[var(--muted)]">
                    A withdrawal of <span className="font-medium text-[var(--ink)]">{formatUsdc(balance.withdrawingAtomic)} USDC</span> is in
                    Circle Gateway&rsquo;s ~{WITHDRAWAL_DELAY_DAYS}-day security delay.
                  </p>
                  {matured ? (
                    <button
                      type="button"
                      onClick={onComplete}
                      disabled={!!busy || gasMissing}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--river-deep)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === "completing" && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                      Complete withdrawal
                    </button>
                  ) : (
                    <div className="rounded-md border border-[var(--faint)] px-3 py-2 text-xs text-[var(--muted)]">
                      Unlocks at block {balance.withdrawalBlock.toString()} — about {blocksRemaining.toString()} blocks
                      remaining (current block {balance.currentBlock.toString()}). Reopen this dialog after it matures to
                      finish.
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <label htmlFor="wd-amount" className="text-sm font-medium">
                      Amount
                    </label>
                    <div className="flex items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 focus-within:border-[var(--river)]">
                      <input
                        id="wd-amount"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="mono w-full bg-transparent text-sm outline-none"
                      />
                      <span className="text-xs text-[var(--muted)]">USDC</span>
                      <button
                        type="button"
                        onClick={() => setAmount(formatUsdc(available))}
                        disabled={available <= BigInt(0)}
                        className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--river-deep)] hover:bg-[var(--surface-muted)] disabled:opacity-40"
                      >
                        Max
                      </button>
                    </div>
                    {amountError && <p className="text-xs text-[#8d2f2d]">{amountError}</p>}
                  </div>

                  <div className="grid gap-1.5">
                    <label htmlFor="wd-dest" className="text-sm font-medium">
                      Destination address
                    </label>
                    <input
                      id="wd-dest"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      spellCheck={false}
                      className="mono w-full rounded-md border border-[var(--line)] px-3 py-2 text-xs outline-none focus:border-[var(--river)]"
                    />
                    {destError ? (
                      <p className="text-xs text-[#8d2f2d]">{destError}</p>
                    ) : differentDestination ? (
                      <p className="text-xs text-[var(--muted)]">
                        Funds withdraw to your wallet first, then transfer to this address once the withdrawal completes.
                      </p>
                    ) : null}
                  </div>

                  <p className="text-xs text-[var(--muted)]">
                    Earnings are held in Circle Gateway. Withdrawals use a ~{WITHDRAWAL_DELAY_DAYS}-day security delay: you
                    initiate now and return to complete it once the funds mature.
                  </p>

                  <button
                    type="button"
                    onClick={onInitiate}
                    disabled={!canInitiate || !!busy}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--river-deep)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === "initiating" && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                    Initiate withdrawal
                  </button>
                  {available <= BigInt(0) && (
                    <p className="text-center text-xs text-[var(--muted)]">No balance available to withdraw yet.</p>
                  )}
                </div>
              )}

              {actionError && <p className="text-sm text-[#8d2f2d]">{actionError}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TxLink({ label, hash }: { label: string; hash: `0x${string}` }) {
  return (
    <a
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-[var(--river-deep)] hover:underline"
    >
      {label} <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

function SuccessPanel({ done, differentDestination }: { done: DoneState; differentDestination: boolean }) {
  if (done.type === "initiated") {
    return (
      <div className="grid gap-2 rounded-lg border border-[var(--faint)] bg-[var(--surface-muted)] px-4 py-3">
        <p className="text-sm font-medium text-[var(--green)]">Withdrawal initiated.</p>
        <p className="text-xs text-[var(--muted)]">
          Your USDC is now in Circle Gateway&rsquo;s security delay. Reopen this dialog after it matures to complete the
          withdrawal.
        </p>
        <TxLink label="View initiation transaction" hash={done.hash} />
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border border-[var(--faint)] bg-[var(--surface-muted)] px-4 py-3">
      <p className="text-sm font-medium text-[var(--green)]">Withdrawal complete.</p>
      <p className="text-xs text-[var(--muted)]">
        {differentDestination
          ? "Your USDC was withdrawn and sent to your destination address."
          : "Your USDC has been returned to your wallet."}
      </p>
      <TxLink label="View withdrawal transaction" hash={done.result.withdrawHash} />
      {done.result.transferHash && <TxLink label="View transfer transaction" hash={done.result.transferHash} />}
    </div>
  );
}
