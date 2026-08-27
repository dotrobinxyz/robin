import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider, useAccount, useConnect, useDisconnect, useEnsName } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./config";
import { NestTab } from "./tabs/Nest";
import { PayTab } from "./tabs/Pay";
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

function Connect() {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: primary } = useEnsName({ address, query: { enabled: Boolean(address) } });

  if (isConnected && address) {
    return (
      <button className="btn small secondary" onClick={() => disconnect()}>
        {primary ?? shortAddress(address)}
      </button>
    );
  }
  return (
    <button
      className="btn small"
      onClick={() => connectors[0] && connect({ connector: connectors[0] })}
    >
      connect
    </button>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("nest");

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <span className="brand">
            <img src="/nest/icon-192.png" alt="" />
            <span className="wordmark">nest</span>
          </span>
          <Connect />
        </header>
        {tab === "nest" && <NestTab />}
        {tab === "pay" && <PayTab />}
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
        <button disabled title="coming soon">
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
          trade
        </button>
        <button disabled title="coming soon">
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
