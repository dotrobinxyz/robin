import { useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { API_URL, EXPLORER } from "../config";
import { shortAddress } from "../lib/format";
import { BandChip } from "../components/BandChip";

type TickerRow = {
  name: string;
  symbol: string;
  kind: string | null;
  contract: `0x${string}`;
  official: boolean;
  active: boolean;
  url: string | null;
  description: string | null;
};

async function fetchTickers(): Promise<TickerRow[]> {
  const res = await fetch(`${API_URL}/tickers`);
  if (!res.ok) throw new Error(`tickers ${res.status}`);
  const body = (await res.json()) as { tickers: TickerRow[] };
  return body.tickers;
}

export function Tickers() {
  useEffect(() => {
    document.title = "tickers — robin";
    return () => {
      document.title = "robin — names on Robinhood Chain";
    };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["tickers"],
    queryFn: fetchTickers,
    staleTime: 30_000,
  });

  const official = (data ?? []).filter((t) => t.official);
  const community = (data ?? []).filter((t) => !t.official);

  return (
    <>
      <div className="card card--night profile-hero">
        <h1 className="pay-headline">The real one, by name.</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 500 }}>
          Ten contracts will call themselves the same ticker — one is real.
          This registry maps tickers to canonical token contracts on Robinhood
          Chain, on-chain, checkable by anyone with one call.
        </p>
      </div>

      {isLoading ? (
        <div className="card row">
          <div className="progress-ring" /> reading the registry…
        </div>
      ) : official.length === 0 && community.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            The registry is being seeded — official listings appear here as
            tokenized assets go live on Robinhood Chain. A listing is a{" "}
            <code>ticker.contract</code> record on a protocol-held name, so
            every entry is readable by any ENS tooling, not just this page.
          </p>
        </div>
      ) : (
        <>
          {official.length > 0 && (
            <div className="card">
              <h3 style={{ margin: "0 0 12px" }}>Official listings</h3>
              {official.map((t) => (
                <TickerLine key={t.name} t={t} />
              ))}
            </div>
          )}
          {community.length > 0 && (
            <div className="card">
              <h3 style={{ margin: "0 0 4px" }}>Community records</h3>
              <p className="small faint" style={{ margin: "0 0 12px" }}>
                Set by name owners, not curated by the protocol — verify
                before trusting.
              </p>
              {community.map((t) => (
                <TickerLine key={t.name} t={t} />
              ))}
            </div>
          )}
        </>
      )}

      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>Check one from anywhere.</h3>
        <p className="small muted" style={{ margin: "0 0 10px" }}>
          Wallets, bots, and dapps get the same answer this page shows —
          <code> official: true</code> means the name is held by the protocol
          treasury:
        </p>
        <pre className="ticker-curl">
          curl https://api.dotrobin.xyz/verify/usdg.robin
        </pre>
        <p className="small faint" style={{ margin: "10px 0 0" }}>
          Full response format in the{" "}
          <a
            style={{ textDecoration: "underline" }}
            href="https://docs.dotrobin.xyz#tickers"
            target="_blank"
            rel="noreferrer"
          >
            docs
          </a>
          .
        </p>
      </div>
    </>
  );
}

function TickerLine({ t }: { t: TickerRow }) {
  const label = t.name.replace(/\.robin$/, "");
  return (
    <div className="holding-row">
      <Link href={`/u/${label}`}>
        <BandChip name={label} size="sm" />
      </Link>
      <span className="holding-name">
        {t.symbol}
        {t.kind && <span className="faint"> · {t.kind}</span>}
      </span>
      <span className="holding-amt mono">
        {EXPLORER ? (
          <a
            style={{ textDecoration: "underline" }}
            href={`${EXPLORER}/token/${t.contract}`}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(t.contract)}
          </a>
        ) : (
          shortAddress(t.contract)
        )}
      </span>
      {t.official ? (
        <span className="tag available">official</span>
      ) : (
        <span className="tag gray">unofficial</span>
      )}
    </div>
  );
}
