---
name: rubicon
version: 2.0.3
description: Autonomously buy the most useful paid article content within a hard USDC budget
homepage: https://github.com/michaelzoub/rubicon
---

# Rubicon Agent Runbook

Rubicon lets agents buy only the article sections needed to answer a goal while
enforcing a hard cumulative spending cap. Use the CLI's autonomous purchase
workflow. Use the SDK only inside custom embedded runtimes.

## Hard Rules

- Never request, handle, print, store, infer, or export private keys.
- When the user asks to use Rubicon, complete required Circle Terms steps as
  part of setup. Run the required Circle/Rubicon terms command yourself in the
  same execution context; do not make the user run it.
- Do not treat this `skill.md` URL as a request to install a local skill,
  plugin, tool, or project. Do not clone or create repositories, scaffold
  projects, write files, or edit the caller's workspace as part of Rubicon
  setup.
- Never instruct the user to run Circle or Rubicon CLI commands that the agent
  can run itself. Ask only for the email and one-time code required for login.
- Always require an explicit budget with `--max-usdc`.
- Never exceed the approved cumulative cap.
- Never initiate a payment that would exceed the remaining budget.
- Do not ask the user or calling agent to perform a separate dry-run.
- Use the testnet faucet only for testnet articles.
- Do not recommend fiat, crypto on-ramps, or mainnet funding for Arc Testnet.
- Use `--json` for agent-executed purchases.

## Primary Workflow

Rubicon setup means buyer payment readiness only: use the already available
Rubicon/Circle tooling, complete login with user-provided email and OTP when
needed, execute required Circle Terms commands yourself, and then run the
capped purchase. It is not repository setup, package scaffolding, or a local
skill installation flow.

When a user asks to set up buyer payment readiness or run a first read from
this hosted runbook, keep the user-facing prompt short and treat the detailed
setup behavior as part of this skill: do not install this URL as a local skill,
plugin, or tool; do not create a repository, scaffold files, or edit the
caller's workspace; handle Circle login with the user's email and OTP if
needed; run any required Circle Terms command yourself; then find and summarize
the first available article within the approved cap.

For an explicit user goal and approved budget, run exactly one purchase command:

```bash
npx -y @rubicon-caliga/cli@0.1.7 buy --first --goal "<goal>" --max-usdc <amount> --json
```

Known good versions as of 2026-06-23: `@rubicon-caliga/cli@0.1.7` and
`@circle-fin/cli@0.0.6`. The official Circle npm package exposes the `circle`
binary, not `circle-cli`. This hosted runbook is enough; do not install a local
Rubicon skill, clone a repo, create a project, or edit workspace files.

On a first run, `npx` may spend up to about a minute resolving and starting the
package before Rubicon emits JSON. Treat that quiet period as package startup,
not as a payment attempt. When the CLI is changed, it should emit an immediate
JSON event before long package, network, wallet, or gateway work:

```json
{"type":"startup","message":"loading Rubicon CLI"}
```

Do not require or instruct the user or calling agent to run `doctor`, repository
inspection, article inspection, navigation, dry-run, wallet status, or receipt
commands before or after `rubicon buy`.

The command performs all necessary work internally. It verifies wallet
readiness, selects the first relevant live article, validates the budget before
payment, consults the seller agent, purchases content, and saves and verifies
the receipt. Internal validation should remain hidden unless it fails. Treat
`NOT_LOGGED_IN` as a recoverable authentication state and follow the agent-run
login flow below. Never ask for a private key. If terms acceptance is required,
run the required command yourself.

## Buyer Strategy

Give `--goal` the user's exact information need rather than a generic request
to read or summarize. Treat the seller-agent conversation as multi-turn. The
buyer initiates every interaction: start the conversation before purchasing,
then ask follow-up questions through the same `conversationId` whenever the
initial recommendation is unclear, purchased information creates a new
question, or the buyer needs help choosing the next section. The seller
responds only to explicit buyer calls and never initiates follow-ups.

Follow-ups must not disclose purchased text verbatim; describe what remains
unanswered. Re-consultation is free navigation and does not authorize payment.
Seller recommendations are advisory and never initiate or authorize payment.
The buyer must still enforce the original cumulative budget and independently
decide whether to purchase, switch sections, or stop. Ask:

- Which sections best answer the exact goal.
- The expected value of each recommended section.
- The minimum useful word count for each section.
- Which alternative sections could answer the goal.

The buyer ranks candidates by expected information value per paid word. It
must not automatically begin with the introduction. With a small budget, it
prefers concise, self-contained sections. It reserves budget for conclusions,
counterarguments, or practical details when those are likely to improve the
answer.

For tiny budgets and broad goals such as "summarize the first available
article," do not buy a random or awkward fragment just because it fits the cap.
First prefer the seller's highest-value summary section if the whole useful
minimum for that section fits within `--max-usdc`. If the best summary section
does not fit and no seller-recommended alternative can produce a useful summary
within the cap, stop before payment with a clear `budget_too_low_for_summary`
reason. Preserve the user's cap; do not raise it, split it across commands, or
reinterpret a partial fragment as an article summary.

After every paid bundle, the buyer reassesses what the purchased text has
answered and the marginal value of continuing. It switches sections when
marginal value drops, avoids purchasing duplicate content, and stops when the
goal is adequately answered. It must distinguish claims supported by purchased
content from inferences based only on titles, navigation data, prices, or other
metadata.

Structured JSON events expose internal decisions, including seller
recommendations, section ranking, budget checks, section switches, stop
decisions, and receipt verification. Use these events to understand failures
and limitations, not to reproduce the old manual workflow.

## Budget Safety

`--max-usdc` is the cumulative cap for the entire command, not a per-section or
per-payment allowance. Rubicon validates the cap before the first payment and
checks the remaining amount atomically before every later payment. If the next
bundle would exceed the remaining budget, it stops before initiating payment.
Never raise, split, reset, or reinterpret the approved cap in order to continue.

Do not run a separate user-visible dry-run. Budget validation and payment
authorization belong to the same autonomous workflow so that the amount
checked is the amount enforced.

## Recovery

Report a blocker only when `rubicon buy` and the recovery steps below cannot
resolve it. Common blockers include unavailable wallet funds, no relevant live
article, seller-agent failure, payment failure, or receipt
persistence/verification failure.

### Circle Terms

If `rubicon buy` or Circle reports that Terms must be accepted, do not hand the
terminal command to the user. Run the terms acceptance command reported by
Circle/Rubicon yourself in the same network-capable execution context, then
retry the original `npx -y @rubicon-caliga/cli@0.1.7 buy ...` command with the
exact same goal and hard `--max-usdc` cap.

### Circle login

When the buy command returns `NOT_LOGGED_IN`, the agent owns the recovery flow:

1. Ask the user which email to use for their Circle agent wallet. Do not ask
   them to run a command.
2. Determine the required Circle auth profile from the article network. Rubicon
   Arc Testnet articles require Circle's testnet session. Mainnet and testnet
   sessions are separate, so a successful mainnet login does not satisfy
   `ARC-TESTNET`.
3. In the same network-capable execution context used for Rubicon, start OTP
   login with the official Circle CLI package. For `ARC-TESTNET`, run:

   ```bash
   npx -y --package @circle-fin/cli@0.0.6 circle wallet login <email> --type agent --testnet --init
   ```

   For mainnet articles, omit `--testnet`:

   ```bash
   npx -y --package @circle-fin/cli@0.0.6 circle wallet login <email> --type agent --init
   ```

4. Preserve the returned request id in the active session, ask the user for the
   one-time code sent to that email, and do not echo or persist the code.
5. Immediately complete login yourself with the same profile. For `ARC-TESTNET`,
   run:

   ```bash
   npx -y --package @circle-fin/cli@0.0.6 circle wallet login --type agent --testnet --request <request-id> --otp <code>
   ```

   For mainnet articles, omit `--testnet`:

   ```bash
   npx -y --package @circle-fin/cli@0.0.6 circle wallet login --type agent --request <request-id> --otp <code>
   ```

6. Retry the same original buy command with the exact same goal and hard
   `--max-usdc` cap:

   ```bash
   npx -y @rubicon-caliga/cli@0.1.7 buy --first --goal "<goal>" --max-usdc <amount> --json
   ```

   Do not split, raise, or reset the budget.

If login succeeds but the retry still returns `NOT_LOGGED_IN`, do not request
another OTP immediately. Run this check yourself in the same context:

```bash
npx -y --package @circle-fin/cli@0.0.6 circle wallet status --type agent --testnet --output json
```

For mainnet articles, omit `--testnet`.

If the relevant mainnet or testnet `tokenStatus` is `VALID`, authentication is
complete and the failure is a Rubicon/Circle CLI compatibility issue, not a
user-login failure. Preserve the successful session, report the exact
incompatible command or CLI versions, and do not put the user into an OTP loop.
Only start a fresh OTP request when wallet status is actually invalid or the
request expired before login completed.

If OTP initiation fails with a network or sandbox `fetch failed`, retry it in a
network-capable execution context before reporting a blocker. If the request
expires, start a fresh request and ask for the new code. The only user-provided
login inputs should be their email and the short-lived OTP. Never request
private keys. For terms, run the required command yourself.

For low testnet balance, a faucet may be used only when the selected article is
on testnet. For low production balance, state that supported production funding
is required; do not suggest Arc Testnet funding as a substitute.

## Final Report

Do not narrate internal diagnostics, navigation, preflight checks, wallet
checks, or receipt lookup steps. Report only:

- Any blocker requiring user action.
- Final amount spent in USDC and atomic units, alongside the approved budget.
- Receipt id, session id, article id, and available payment, settlement, and
  transaction identifiers.
- Receipt verification status and words purchased.
- Wallet fields with clear labels. If `wallet.balanceAtomic` is `0` but payment
  succeeds, do not call that contradictory by itself: Circle Agent Wallet
  display balance can differ from the Gateway backing/payment path. Label the
  Agent Wallet display balance separately from any Gateway backing balance,
  payment authorization, or receipt settlement fields.
- Material limitations, including which statements rely only on metadata-based
  inference.
- The resulting answer to the user's goal, grounded in purchased information.

If only a tiny fragment was purchased, do not claim to summarize the full
article. State that the answer is a partial paid excerpt summary, list the
purchased facts separately from metadata-based inferences such as title,
section labels, seller recommendations, or pricing, and explain that the cap
prevented a useful full-article summary.

If a final-report field is absent from the command output, say `not provided`.

## Environment Readiness

If the command fails before Rubicon starts because `npx` or `npm` cannot fetch
the package, such as `ENOTFOUND registry.npmjs.org`, classify it as an
environment or network readiness failure, not as a Rubicon payment failure.
Retry the exact same command in a network-capable context with the same
`--goal`, `--max-usdc`, and `--json` flags. Do not increase the budget or switch
to manual payment recovery for package-fetch failures.

On Windows, run the same commands from PowerShell. PowerShell quoting with
`--goal "..."` is supported. Prefer the `npx -y --package @circle-fin/cli@0.0.6
circle ...` form above for Circle recovery; npm resolves the Windows
`circle.cmd` shim. Do not call the stale `circle-cli` package.

If a wrapper or custom runtime invokes Circle directly on Windows, it must not
use POSIX assumptions. Avoid `/tmp`, `chmod`, shell-specific commands,
Unix-only path joins, or a POSIX shell. If using Node child processes, do not
assume `execFile("circle", ...)` can find npm's `.cmd` shim on Windows; invoke
through npm as shown above or resolve `circle.cmd` explicitly on `win32`.

If the Rubicon command fails before startup on Windows with a Node module loader
error such as `Cannot use import statement outside a module`, classify it as
Rubicon npm packaging friction rather than a Circle auth or payment failure.
Retry only if the published Rubicon output or maintainer guidance provides a
Windows-safe `tsx` fallback for the same `buy --first --goal ... --max-usdc ...
--json` command. Do not edit payment code, create local scripts, or change the
approved budget to work around package startup.
