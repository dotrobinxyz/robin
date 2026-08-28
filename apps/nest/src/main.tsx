import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  WagmiProvider,
  useAccount,
  useConnect,
  useDisconnect,
  useEnsName,
  useSwitchChain,
} from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CHAIN, SITE, wagmiConfig } from "./config";
import { NestTab } from "./tabs/Nest";
import { PayTab } from "./tabs/Pay";
import { FeedTab } from "./tabs/Feed";
import { TradeTab } from "./tabs/Trade";
import { shortAddress } from "./lib/format";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/nest/sw.js").catch(() => {});
  });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

type Tab = "nest" | "pay" | "trade" | "feed";

function WalletSheet({ onClose }: { onClose: () => void }) {
  const { connectors, connect, isPending, error } = useConnect();
  const [copied, setCopied] = useState(false);
  const metaMask = connectors.find((c) => c.type === "metaMask");

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title" style={{ marginBottom: 4 }}>
          Connect a wallet.
        </h3>
        <p className="small muted" style={{ margin: 0 }}>
          nest never holds keys — your wallet signs everything.
        </p>
        {metaMask && (
          <button
            className="wallet-opt"
            disabled={isPending}
            onClick={() => connect({ connector: metaMask })}
          >
            <span aria-hidden>🦊</span> MetaMask
            {isPending && (
              <span className="small muted mono" style={{ marginLeft: "auto" }}>
                approve in the app…
              </span>
            )}
          </button>
        )}
        <p className="small muted" style={{ margin: "16px 0 6px" }}>
          using another wallet? open this link inside its built-in browser:
        </p>
        <div className="row" style={{ gap: 8 }}>
          <span className="input mono" style={{ flex: 1, padding: "10px 12px", fontSize: 14 }}>
            dotrobin.xyz/nest
          </span>
          <button
            className="chip"
            onClick={() =>
              navigator.clipboard
                ?.writeText(`${SITE}/nest/`)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
        {error && (
          <p className="notice danger" style={{ marginTop: 12, marginBottom: 0 }}>
            {(error as { shortMessage?: string }).shortMessage ?? error.message}
          </p>
        )}
      </div>
    </div>
  );
}

function Connect() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: primary } = useEnsName({ address, query: { enabled: Boolean(address) } });
  const [sheet, setSheet] = useState(false);

  const wrongChain = isConnected && chainId !== CHAIN.id;

  // Fresh MetaMask sessions land on whatever chain the wallet was last on —
  // pull them to Robinhood Chain once (adds it if missing). If the user
  // declines, the chip below stays as a manual switch.
  useEffect(() => {
    if (isConnected && chainId !== CHAIN.id) switchChain({ chainId: CHAIN.id });
    if (isConnected) setSheet(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  if (isConnected && address) {
    if (wrongChain) {
      return (
        <button
          className="band sm warn"
          disabled={switching}
          onClick={() => switchChain({ chainId: CHAIN.id })}
        >
          {switching ? "switching…" : "wrong network — tap to fix"}
        </button>
      );
    }
    const label = primary?.replace(/\.robin$/, "");
    return (
      <button
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        onClick={() => disconnect()}
        title="disconnect"
      >
        {label ? (
          <span className="band sm">
            {label}
            <span className="tld">.robin</span>
          </span>
        ) : (
          <span className="band sm">{shortAddress(address)}</span>
        )}
      </button>
    );
  }

  // In-wallet browsers and extensions inject a provider — connect it directly,
  // same as before. No provider (Chrome tab, installed PWA) → offer options.
  const hasInjected = typeof window !== "undefined" && Boolean((window as any).ethereum);
  const injectedConnector =
    connectors.find((c) => c.type === "injected" && c.id !== "injected") ??
    connectors.find((c) => c.type === "injected");

  return (
    <>
      <button
        className="btn small"
        onClick={() => {
          if (hasInjected && injectedConnector) connect({ connector: injectedConnector });
          else setSheet(true);
        }}
      >
        connect
      </button>
      {sheet && <WalletSheet onClose={() => setSheet(false)} />}
    </>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("nest");
  const [payTo, setPayTo] = useState("");

  const openPay = (name: string) => {
    setPayTo(name);
    setTab("pay");
  };

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <span className="brand">
            <img src="/nest/mark.svg" alt="" />
            <span className="wordmark">nest</span>
          </span>
          <div className="spacer" />
          <Connect />
        </header>
        {tab === "nest" && <NestTab onPay={openPay} />}
        {tab === "pay" && <PayTab prefill={payTo} />}
        {tab === "trade" && <TradeTab />}
        {tab === "feed" && <FeedTab onPay={openPay} />}
      </div>
      <nav className="tabbar">
        <button className={tab === "nest" ? "on" : ""} onClick={() => setTab("nest")}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12c0 5 4 8 9 8s9-3 9-8" /><path d="M5 12c2-1.5 4.5-2 7-2s5 .5 7 2" /><circle cx="12" cy="7" r="3" /></svg>
          nest
        </button>
        <button className={tab === "pay" ? "on" : ""} onClick={() => setTab("pay")}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M17 7.5C17 5.5 14.8 4.5 12 4.5S7 5.5 7 7.5 9 10.5 12 10.5s5 1 5 3-2.2 3-5 3-5-1-5-3" /></svg>
          pay
        </button>
        <button className={tab === "trade" ? "on" : ""} onClick={() => setTab("trade")}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
          trade
        </button>
        <button className={tab === "feed" ? "on" : ""} onClick={() => setTab("feed")}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h10" /></svg>
          feed
        </button>
      </nav>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
