export const WRITER_OBJECTION_PROMPT_SEEN_KEY = "rubicon_writer_objection_prompt_seen";

export const OBJECTION_OPTIONS = [
  { value: "trust_and_pricing", label: "Me no trust agents pay / price confuse" },
  { value: "wallet_and_setup", label: "Wallet + setup too much work" },
  { value: "content_risk", label: "Scared to show my work" },
  { value: "not_ready", label: "Just looking / wait for mainnet" },
] as const;

export type WriterObjection = (typeof OBJECTION_OPTIONS)[number]["value"];

export function hasSeenWriterObjectionPrompt(storage: Pick<Storage, "getItem"> | undefined = globalThis.window?.sessionStorage) {
  if (!storage) return true;
  try {
    return storage.getItem(WRITER_OBJECTION_PROMPT_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markWriterObjectionPromptSeen(storage: Pick<Storage, "setItem"> | undefined = globalThis.window?.sessionStorage) {
  try {
    storage?.setItem(WRITER_OBJECTION_PROMPT_SEEN_KEY, "1");
  } catch {
    // Best effort: blocked storage should not prevent navigation.
  }
}

export function writerHomeUrl() {
  return (
    process.env.NEXT_PUBLIC_RUBICON_HOME_URL ??
    (process.env.NODE_ENV === "production" ? "https://rubiconpay.xyz" : "http://localhost:3000")
  );
}
