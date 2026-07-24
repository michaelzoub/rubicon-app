"use client";

import { Check, ChevronRight, Copy, ExternalLink, Menu, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { RubiconBrand } from "@/app/_components/rubicon-brand";
import { CopyConfetti } from "../_components/copy-confetti";

const npmBase = "https://www.npmjs.com/package";
const githubUrl = "https://github.com/michaelzoub/rubicon";

const navigation = [
  { id: "overview", label: "Introduction", group: "Get started" },
  { id: "quickstart", label: "Quickstart", group: "Get started" },
  { id: "agent-sdk", label: "Install the SDK", group: "Build" },
  { id: "discovery", label: "Discover content", group: "Build" },
  { id: "streaming", label: "Stream paid content", group: "Build" },
  { id: "cli", label: "CLI", group: "Packages" },
  { id: "core", label: "Core primitives", group: "Packages" },
  { id: "payments", label: "Set a spending budget", group: "Payments" },
  { id: "receipts", label: "Receipts and errors", group: "Payments" },
  { id: "api", label: "HTTP API", group: "Reference" },
];

const code = {
  install: "npm install @rubicon-caliga/agent-sdk",
  quickstart: `import Rubicon from "@rubicon-caliga/agent-sdk";

const rubicon = new Rubicon({
  baseUrl: "https://your-gateway.example.com",
  authorization: \`Bearer \${process.env.RUBICON_AGENT_API_KEY}\`,
});

const receipt = await rubicon.run({
  articleId: "live-article-id",
  goal: "Find the resale-fee clause",
  maxSpendAtomic: "20000",
  maxWords: 200,
  stopWhen: ({ text }) => /resale fee/i.test(text),
  onWord: (word) => process.stdout.write(\`\${word} \`),
});

console.log(receipt.stopReason, receipt.amountPaidAtomic);`,
  stream: `for await (const event of rubicon.read({
  articleId,
  goal: "Extract the contract termination conditions",
  maxSpendAtomic: "100000",
  chunkWords: 32,
  streamMode: "bundled",
})) {
  if (event.type === "article.bundle") process.stdout.write(event.bundleText);
  if (event.type === "article.completed") console.log(event.receipt.settlementIds);
}`,
  cli: `npm install --global @rubicon-caliga/cli

rubicon doctor --json
rubicon repository
rubicon search "stablecoin settlement"
rubicon article navigation <article-id> --goal "Find fee terms"
rubicon read <article-id> --max-usdc 0.10 --goal "Find fee terms" --summary`,
  core: `import { quotePerWord, usageForWords, type Budget } from "@rubicon-caliga/core";

const quote = quotePerWord({ pricePerWordAtomic: 10n, gatewayFeeBps: 0 });
const usage = usageForWords({ wordsDelivered: 137, pricePerWordAtomic: 10n });`,
  payment: `import Rubicon, { CircleCliGatewayPaymentEngine } from "@rubicon-caliga/agent-sdk";

const rubicon = new Rubicon({
  baseUrl: "https://your-gateway.example.com",
  paymentEngine: new CircleCliGatewayPaymentEngine({
    agentWalletAddress: process.env.CIRCLE_AGENT_WALLET_ADDRESS as \`0x\${string}\`,
    chain: "ARC-TESTNET",
  }),
});`,
};

function CodeBlock({ label, children }: { label: string; children: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  const tokens = children.split(/(\/\/.*$|`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:import|from|const|new|await|for|if|in|as|type|return)\b|\b\d+n?\b)/gm);
  const tone = (token: string) => token.startsWith("//") ? "comment" : (/^[`"']/.test(token) ? "string" : (/^\d/.test(token) ? "number" : (/^(import|from|const|new|await|for|if|in|as|type|return)$/.test(token) ? "keyword" : "")));
  return <div className="rubicon-docs-code"><div className="rubicon-docs-code-head"><span>{label}</span><CopyConfetti onCopy={copy}><span aria-label="Copy code">{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</span></CopyConfetti></div><pre><code>{tokens.map((token, index) => <span key={index} className={tone(token)}>{token}</span>)}</code></pre></div>;
}

function Resource({ name, description }: { name: string; description: string }) {
  return <a className="rubicon-docs-resource" href={`${npmBase}/${name}`} target="_blank" rel="noreferrer"><code>{name}</code><span>{description}</span><ExternalLink size={13} /></a>;
}

export default function DashboardDocsPage() {
  const [active, setActive] = useState("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => navigation.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") { setSearchOpen(false); setDrawerOpen(false); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (searchOpen) window.setTimeout(() => searchRef.current?.focus(), 0); }, [searchOpen]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-18% 0px -66% 0px", threshold: [0, .2, .6] });
    navigation.forEach(({ id }) => document.getElementById(id) && observer.observe(document.getElementById(id)!));
    return () => observer.disconnect();
  }, []);
  const jump = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); setDrawerOpen(false); setSearchOpen(false); };
  const groups = [...new Set(navigation.map((item) => item.group))];

  return <div className="rubicon-docs-shell">
    <header className="rubicon-docs-header"><div className="rubicon-docs-header-inner">
      <Link href="/dashboard/docs" className="rubicon-docs-brand" aria-label="Rubicon documentation"><RubiconBrand className="h-5" src="/w_logo.svg" /><span>Rubicon</span></Link>
      <span className="rubicon-docs-divider" /><span className="rubicon-docs-product">Documentation</span>
      <button type="button" className="rubicon-docs-search" onClick={() => setSearchOpen(true)}><Search size={17} /><span>Search docs...</span><kbd>⌘K</kbd></button>
      <Link className="rubicon-docs-dashboard" href="/dashboard">Dashboard <ChevronRight size={14} /></Link>
    </div></header>
    <div className="rubicon-docs-mobilebar"><button type="button" onClick={() => setDrawerOpen(true)}><Menu size={18} /> Browse docs</button></div>
    <div className="rubicon-docs-layout">
      <aside className={`rubicon-docs-nav ${drawerOpen ? "is-open" : ""}`} aria-label="Documentation navigation"><div className="rubicon-docs-nav-mobile"><strong>Documentation</strong><button onClick={() => setDrawerOpen(false)} aria-label="Close navigation"><X size={18} /></button></div><nav>{groups.map((group) => <div key={group}><p>{group}</p>{navigation.filter((item) => item.group === group).map((item) => <button key={item.id} onClick={() => jump(item.id)} className={active === item.id ? "is-active" : ""}>{item.label}</button>)}</div>)}</nav></aside>
      {drawerOpen && <button className="rubicon-docs-scrim" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}
      <main className="rubicon-docs-article">
        <section id="overview"><p className="rubicon-docs-eyebrow">Get started</p><h1>Build agents that pay only for what they read.</h1><p className="rubicon-docs-lead">Rubicon gives buyer agents a budgeted path from discovering valuable content to metered delivery. Decide what a read is worth, stream only what helps, and retain settlement evidence for every completed session.</p><div className="rubicon-docs-start"><h2>Start here</h2><div>{navigation.slice(2, 7).map((item) => <button key={item.id} onClick={() => jump(item.id)}>{item.label}<ChevronRight size={15} /></button>)}</div></div><div className="rubicon-docs-resources"><Resource name="@rubicon-caliga/agent-sdk" description="v0.1.4 · High-level discovery, paid streaming, and receipts" /><Resource name="@rubicon-caliga/cli" description="v0.1.5 · Terminal-native discovery and budgeted reads" /><Resource name="@rubicon-caliga/core" description="v0.1.3 · Protocol types, pricing math, and session primitives" /></div></section>
        <section id="quickstart"><p className="rubicon-docs-eyebrow">Quickstart</p><h2>Run your first budgeted read</h2><p>Install the SDK, create a client, and pass a hard spend ceiling in atomic USDC. One USDC has 1,000,000 atomic units.</p><CodeBlock label="Terminal">{code.install}</CodeBlock><CodeBlock label="TypeScript">{code.quickstart}</CodeBlock><div className="rubicon-docs-note"><ShieldCheck size={19} /><div><strong>Budget enforcement is part of the read.</strong><span><code>maxSpendAtomic</code>, <code>maxWords</code>, and <code>stopWhen</code> can all end delivery before the full article is purchased.</span></div></div></section>
        <section id="agent-sdk"><p className="rubicon-docs-eyebrow">Agent SDK</p><h2>Install the SDK</h2><p>The SDK is the quickest route to discovery, navigation, streaming, and receipts. Use <code>run()</code> for a complete read or <code>read()</code> when you need to handle events yourself.</p><CodeBlock label="Terminal">{code.install}</CodeBlock><div className="rubicon-docs-table"><table><thead><tr><th>Method</th><th>Use it for</th><th>Returns</th></tr></thead><tbody>{[["run(options)", "A complete read with callbacks", "ReadReceipt"], ["read(options)", "Handling every event in your own loop", "AsyncGenerator"], ["getRepository()", "Discovering public articles", "Article summaries"], ["getNavigation(id, goal)", "Finding the most relevant section", "Seller navigation"], ["abort(sessionId)", "Stopping an active read", "Promise<void>"]].map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 0 || index === 2 ? <code>{cell}</code> : cell}</td>)}</tr>)}</tbody></table></div></section>
        <section id="discovery"><p className="rubicon-docs-eyebrow">Discovery</p><h2>Discover content before you spend</h2><p>Browse the public repository, search for relevant work, then ask a seller agent to locate the section that answers your goal. Navigation happens before delivery, so your budget starts where the useful content does.</p><CodeBlock label="Terminal">{`rubicon repository\nrubicon search "stablecoin settlement"\nrubicon article navigation <article-id> --goal "Find fee terms"`}</CodeBlock></section>
        <section id="streaming"><p className="rubicon-docs-eyebrow">Streaming reads</p><h2>Stream paid content as it arrives</h2><p><code>read()</code> yields session, seller, content, usage, completion, and error events. Bundled mode reduces payment round trips without changing per-word accounting.</p><CodeBlock label="TypeScript">{code.stream}</CodeBlock><div className="rubicon-docs-events">{["session.started", "seller.message", "article.bundle", "article.usage", "article.completed", "article.error"].map((event) => <code key={event}>{event}</code>)}</div></section>
        <section id="cli"><p className="rubicon-docs-eyebrow">CLI</p><h2>Use Rubicon from the terminal</h2><p>The CLI is the shortest path for coding agents and shell workflows. Add <code>--json</code> when another process will consume the output.</p><CodeBlock label="Terminal">{code.cli}</CodeBlock></section>
        <section id="core"><p className="rubicon-docs-eyebrow">Core primitives</p><h2>Share contracts across your stack</h2><p>Use <code>core</code> when implementing gateway integrations, validating accounting, or sharing Rubicon types between services.</p><CodeBlock label="TypeScript">{code.core}</CodeBlock></section>
        <section id="payments"><p className="rubicon-docs-eyebrow">Payment engines</p><h2>Set a spending budget</h2><p>Use <code>StaticPaymentEngine</code> for a dev-mode gateway, <code>CircleCliGatewayPaymentEngine</code> to sign Circle and Arc authorization payloads through a Circle Agent Wallet, or <code>CircleAgentWalletEngine</code> for API-backed custody. Provision and fund the wallet before starting reads.</p><CodeBlock label="TypeScript">{code.payment}</CodeBlock></section>
        <section id="receipts"><p className="rubicon-docs-eyebrow">Receipts</p><h2>Handle receipts and errors</h2><p>A completed read returns word count, total paid amount, text, stop reason, and payment evidence. Treat <code>settlementIds</code> as primary proof for Gateway nanopayments.</p><ul className="rubicon-docs-checklist">{["Persist sessionId and articleId", "Store amountPaidAtomic and wordsRead", "Index settlementIds for reconciliation", "Record stopReason for agent audits"].map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul></section>
        <section id="api"><p className="rubicon-docs-eyebrow">HTTP API</p><h2>Gateway endpoints</h2><p>The SDK wraps the public gateway flow. Use endpoints directly only when building another language client or a custom runtime.</p><div className="rubicon-docs-endpoints">{[["GET", "/v1/repository", "List public articles."], ["GET", "/v1/articles/:id/navigation", "Ask for goal-aware section routing."], ["POST", "/v1/seller-agent/conversations", "Start a seller conversation."], ["POST", "/v1/sessions", "Open a budgeted reading session."]].map(([method, path, text]) => <div key={path}><b>{method}</b><code>{path}</code><span>{text}</span></div>)}</div></section>
        <footer className="rubicon-docs-pagination"><button onClick={() => jump("overview")}><span>Previous</span>Introduction</button><a href={githubUrl} target="_blank" rel="noreferrer"><span>Next</span>Explore the source <ExternalLink size={14} /></a></footer>
      </main>
      <aside className="rubicon-docs-toc"><p>On this page</p>{navigation.slice(0, 7).map((item) => <button key={item.id} onClick={() => jump(item.id)} className={active === item.id ? "is-active" : ""}>{item.label}</button>)}<a href={githubUrl} target="_blank" rel="noreferrer">View source <ExternalLink size={13} /></a></aside>
    </div>
    {searchOpen && <div className="rubicon-docs-search-modal" role="dialog" aria-modal="true" aria-label="Search documentation"><button className="rubicon-docs-search-dismiss" onClick={() => setSearchOpen(false)} aria-label="Close search" /><div><Search size={18} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documentation" /><kbd>Esc</kbd><div className="rubicon-docs-search-results">{results.map((item) => <button key={item.id} onClick={() => jump(item.id)}><span>{item.label}</span><small>{item.group}</small></button>)}{results.length === 0 && <p>No documentation matches that search.</p>}</div></div></div>}
  </div>;
}
