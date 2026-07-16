"use client";

import { getEmbeddedConnectedWallet, useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, CircleAlert, Copy, ExternalLink, KeyRound, LogOut, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { useRubiconMutation, useRubiconQuery } from "@/lib/rubicon/hooks";
import { RECEIVING_NETWORK, RECEIVING_NETWORK_LABEL } from "@/lib/chain";
import { Reveal } from "../_components/charts";
import { AgentCashSettings } from "./agentcash-settings";
import {
  Card,
  CardHeader,
  ErrorState,
  LoadingState,
  PageHeader,
  WalletStatePill,
} from "../_components/ui";

export default function SettingsPage() {
  const { user, logout } = usePrivy();
  const creator = useRubiconQuery((c) => c.getCreator(), [], { queryKey: ["creator"] });
  const wallet = useRubiconQuery((c) => c.getWallet(), [], { queryKey: ["wallet"] });
  const updateCreator = useRubiconMutation((c, ...a: Parameters<typeof c.updateCreator>) => c.updateCreator(...a));
  const updateWallet = useRubiconMutation((c, walletInput: { address: string; network: string; verified: boolean }) => c.updateWallet(walletInput));
  // The payout card renders after its queries resolve, so repeat the native
  // hash jump once the destination exists.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#payout-connection") return;
    if (creator.status !== "success" || wallet.status === "loading") return;
    document.getElementById("payout-connection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [creator.status, wallet.status]);

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description="Manage your writer profile, receiving wallet, and developer access." />

      {creator.status === "loading" && <LoadingState />}
      {creator.status === "error" && creator.error && <ErrorState error={creator.error} onRetry={creator.refetch} />}

      {creator.status === "success" && (
        <>
          {/* Account */}
          <Reveal>
            <Card>
              <CardHeader
                title="Account"
                action={
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f6ef] px-2.5 py-0.5 text-xs font-medium text-[#165c3e]">
                    <ShieldCheck size={13} aria-hidden="true" /> Active
                  </span>
                }
              />
              <div className="grid gap-4 p-5">
                <AccountName
                  initial={creator.data?.displayName ?? ""}
                  username={creator.data?.username ?? ""}
                  connectedIdentity={user?.email?.address ?? user?.twitter?.username ?? null}
                  pending={updateCreator.pending}
                  onSave={async (name) => {
                    await updateCreator.run({ displayName: name });
                    creator.refetch();
                  }}
                />
                <div className="flex items-center justify-between rounded-lg bg-[var(--surface-muted)] p-4">
                  <span className="text-sm text-[var(--muted)]">Sign out of this device.</span>
                  <button type="button" onClick={() => logout()} className="button button-secondary text-sm">
                    <LogOut size={15} aria-hidden="true" /> Sign out
                  </button>
                </div>
              </div>
            </Card>
          </Reveal>

          {/* Payout connection */}
          <Reveal delay={0.04}>
            <Card id="payout-connection" className="scroll-mt-6">
              <CardHeader
                title="Payout connection"
                action={
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                    className="button button-secondary inline-flex items-center gap-1.5 text-sm"
                  >
                    Get Arc testnet USDC <ExternalLink size={14} aria-hidden="true" />
                  </a>
                }
              />
              <div className="grid gap-4 p-5">
                {wallet.status === "loading" && <LoadingState />}
                {wallet.status === "error" && wallet.error && <ErrorState error={wallet.error} onRetry={wallet.refetch} />}
                {wallet.status === "success" && (
                  <>
                    <WalletEditor
                      address={wallet.data?.address ?? ""}
                      network={wallet.data?.network ?? RECEIVING_NETWORK}
                      verified={wallet.data?.verified ?? false}
                      pending={updateWallet.pending}
                      error={updateWallet.error?.message ?? null}
                      onSave={async (addr, network, verified) => {
                        await updateWallet.run({ address: addr, network, verified });
                        wallet.refetch();
                      }}
                    />
                  </>
                )}
              </div>
            </Card>
          </Reveal>

          <AgentCashSettings />

          <Reveal delay={0.12}>
            <ExtensionAccess />
          </Reveal>

          {/* Developer information */}
          <Reveal delay={0.16}>
            <DeveloperInfo creatorId={creator.data?.id ?? ""} privyId={user?.id ?? ""} />
          </Reveal>
        </>
      )}
    </div>
  );
}

function ExtensionAccess() {
  const tokens = useRubiconQuery((c) => c.listExtensionTokens(), [], { queryKey: ["extension-tokens"] });
  const createToken = useRubiconMutation((c, label?: string) => c.createExtensionToken(label));
  const revokeToken = useRubiconMutation((c, id: string) => c.revokeExtensionToken(id));
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    const result = await createToken.run("Chrome extension");
    setNewToken(result.token);
    setCopied(false);
    tokens.refetch();
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
  }

  // When arriving from the Chrome extension (.../settings#extension-token),
  // scroll this section into view once it has rendered. The page mounts before
  // the creator query resolves, so the browser's native hash jump misses it.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#extension-token") return;
    if (tokens.status === "loading") return;
    document.getElementById("extension-token")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tokens.status]);

  return (
    <Card id="extension-token" className="scroll-mt-6">
      <CardHeader title="Send to Rubicon extension" />
      <div className="grid gap-4 p-5">
        <p className="text-sm leading-6 text-[var(--muted)]">
          Generate a token, then paste it into the Chrome extension. Imported content always arrives as a draft.
        </p>

        <AnimatePresence initial={false}>
          {newToken && (
            <motion.div
              key="new-token"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="rounded-lg bg-[#e8f6ef] p-4"
            >
              <div className="text-sm font-medium text-[#165c3e]">Copy this token now. It will not be shown again.</div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <code className="mono min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 text-xs">{newToken}</code>
                <button type="button" onClick={copyToken} className="button button-secondary text-sm">
                  <span className="relative inline-grid size-[15px] shrink-0 place-items-center">
                    <AnimatePresence>
                      <motion.span
                        key={copied ? "check" : "copy"}
                        initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                        className="absolute inset-0 grid place-items-center"
                      >
                        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {tokens.status === "loading" && <LoadingState />}
        {tokens.status === "error" && tokens.error && <ErrorState error={tokens.error} onRetry={tokens.refetch} />}
        {tokens.status === "success" && (
          <div className="grid gap-2">
            {tokens.data?.filter((token) => !token.revokedAt).map((token) => (
              <div key={token.id} className="flex items-center justify-between gap-4 rounded-lg bg-[var(--surface-muted)] px-4 py-3">
                <div className="min-w-0">
                  <div className="mono text-sm">{token.prefix}...</div>
                  <div className="mt-0.5 text-xs text-[var(--muted)]">
                    {token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "Never used"}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Revoke token ${token.prefix}`}
                  onClick={async () => {
                    await revokeToken.run(token.id);
                    tokens.refetch();
                  }}
                  disabled={revokeToken.pending}
                  className="button button-secondary text-sm text-[#8d2f2d] disabled:opacity-50"
                >
                  <Trash2 size={15} aria-hidden="true" /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {(createToken.error || revokeToken.error) && (
          <p className="rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">
            {(createToken.error ?? revokeToken.error)?.message}
          </p>
        )}
        <button type="button" onClick={generate} disabled={createToken.pending} className="button button-primary w-fit text-sm disabled:opacity-50">
          <KeyRound size={15} aria-hidden="true" /> {createToken.pending ? "Generating..." : "Generate extension token"}
        </button>
      </div>
    </Card>
  );
}

const inputClass = "h-11 rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]";

function AccountName({
  initial,
  username,
  connectedIdentity,
  pending,
  onSave,
}: {
  initial: string;
  username: string;
  connectedIdentity: string | null;
  pending: boolean;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial]);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputClass} />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Username</span>
        <input value={username ? `@${username}` : "—"} readOnly className={`${inputClass} bg-[var(--surface-muted)] text-[var(--muted)]`} />
      </label>
      <label className="grid gap-2 sm:col-span-2">
        <span className="text-sm font-medium">Connected identity</span>
        <input value={connectedIdentity ?? "—"} readOnly className={`${inputClass} bg-[var(--surface-muted)] text-[var(--muted)]`} />
      </label>
      <div className="sm:col-span-2">
        <button type="button" onClick={() => onSave(name.trim())} disabled={pending || name.trim() === initial} className="button button-primary text-sm disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function WalletEditor({
  address,
  network,
  verified,
  pending,
  error,
  onSave,
}: {
  address: string;
  network: string;
  verified: boolean;
  pending: boolean;
  error: string | null;
  onSave: (addr: string, network: string, verified: boolean) => void;
}) {
  const { ready, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const embedded = getEmbeddedConnectedWallet(wallets);
  const embeddedAddress = embedded?.address ?? "";
  const payoutNetwork = network || RECEIVING_NETWORK;
  const networkLabel = payoutNetwork === RECEIVING_NETWORK ? RECEIVING_NETWORK_LABEL : payoutNetwork;
  const isConnected = Boolean(address) && address.toLowerCase() === embeddedAddress.toLowerCase();

  // Self-heal wallets that were connected before verification was persisted:
  // if the stored address is the creator's embedded EOA but the row is still
  // unverified, possessing the wallet proves control, so mark it verified.
  // Without this the gateway reports `creator_wallet_not_configured` and never
  // settles payouts. The `!verified` guard makes this fire at most once.
  useEffect(() => {
    if (ready && isConnected && !verified && !pending) {
      onSave(address, payoutNetwork, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isConnected, verified, pending]);

  const connect = async () => {
    setLocalError(null);
    let addr = embeddedAddress;
    if (!addr) {
      setBusy(true);
      try {
        const created = await createWallet();
        addr = created?.address ?? "";
      } catch {
        setLocalError("Could not create your wallet. Try again.");
      } finally {
        setBusy(false);
      }
    }
    // `addr` is always the Privy embedded EOA here — either the existing one or
    // the one we just created — so possessing it proves control. Mark the
    // wallet verified so the gateway will settle payouts to it. (We can't
    // compare against `embeddedAddress` because `useWallets()` hasn't refreshed
    // yet for a freshly created wallet.)
    if (addr) onSave(addr, payoutNetwork, true);
  };

  const working = busy || pending;
  const shownError = localError ?? error;

  return (
    <div className="grid gap-4">
      {address ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-muted)] px-4 py-3">
            <div className="grid min-w-0 gap-0.5">
              <span className="mono truncate text-sm">{address}</span>
              <span className="text-xs text-[var(--muted)]">
                {isConnected ? "Privy connection" : "External payout address"} · {networkLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <WalletStatePill verified={verified} />
              {!isConnected && (
                <button type="button" onClick={connect} disabled={working || !ready} className="button button-secondary text-sm disabled:opacity-50">
                  {working ? "Confirming…" : "Use Privy connection"}
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-[var(--muted)]">Article earnings are routed to this connection. Rubicon never takes custody.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--river-line)] bg-white text-[var(--river-deep)]">
              <CircleAlert size={18} aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold">Receive article earnings</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Create your secure payout connection.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={connect}
            disabled={working || !ready}
            className="button button-primary inline-flex shrink-0 items-center gap-2 text-sm disabled:opacity-50"
          >
            <Wallet size={15} aria-hidden="true" /> {working ? "Setting up…" : "Set up payouts"}
          </button>
        </div>
      )}

      {shownError && <p className="rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">{shownError}</p>}
    </div>
  );
}

function DeveloperInfo({ creatorId, privyId }: { creatorId: string; privyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <span className="text-base font-semibold">Developer information</span>
        <ChevronDown size={18} className={`text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="grid gap-3 bg-[var(--surface-muted)] p-5 text-sm">
          <DevRow label="Privy ID" value={<code className="mono">{privyId || "—"}</code>} />
          <DevRow label="Writer ID" value={<code className="mono">{creatorId || "—"}</code>} />
        </div>
      )}
    </Card>
  );
}

function DevRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-baseline gap-4 rounded-[10px] px-3 py-2 even:bg-[var(--surface-muted)]">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}
