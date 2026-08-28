import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { EXPLORER, INDEXER_URL } from "../config";
import { formatEth, formatUSDG } from "../lib/format";
import { BandChip } from "../components/BandChip";

type FeedItem = {
  key: string;
  kind: "registration" | "renewal" | "subname";
  label: string;
  owner: string;
  cost: string | null;
  timestamp: number;
  txHash: string | null;
};

async function fetchFeed(): Promise<FeedItem[]> {
  const res = await fetch(`${INDEXER_URL}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query {
        registrationEvents(orderBy: "timestamp", orderDirection: "desc", limit: 50) {
          items { id label kind owner baseCost premium currency timestamp txHash }
        }
        subnames(orderBy: "createdAt", orderDirection: "desc", limit: 20) {
          items { id name owner createdAt }
        }
      }`,
    }),
  });
  const body = await res.json();
  const regs: FeedItem[] = body.data.registrationEvents.items.map((e: any) => {
    const paid = BigInt(e.baseCost) + BigInt(e.premium);
    return {
      key: e.id,
      kind: e.kind as "registration" | "renewal",
      label: e.label,
      owner: e.owner,
      cost: paid === 0n ? null : e.currency === "USDG" ? formatUSDG(paid) : formatEth(paid),
      timestamp: Number(e.timestamp),
      txHash: e.txHash,
    };
  });
  const subs: FeedItem[] = body.data.subnames.items.map((s: any) => ({
    key: s.id,
    kind: "subname" as const,
    label: s.name.replace(/\.robin$/, ""),
    owner: s.owner,
    cost: null,
    timestamp: Number(s.createdAt),
    txHash: null,
  }));
  return [...regs, ...subs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 60);
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const VERB: Record<FeedItem["kind"], string> = {
  registration: "banded",
  renewal: "renewed",
  subname: "subname minted",
};

export function FeedTab() {
  const { address, isConnected } = useAccount();
  const [mine, setMine] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["feed"],
    queryFn: fetchFeed,
    refetchInterval: 30_000,
  });

  const items = (data ?? []).filter(
    (i) => !mine || (address && i.owner.toLowerCase() === address.toLowerCase()),
  );

  return (
    <>
      <div className="row between" style={{ margin: "18px 0 12px" }}>
        <div className="h1" style={{ margin: 0 }}>
          The flock.
        </div>
        {isConnected && (
          <div className="chips">
            <button className={`chip${mine ? "" : " on"}`} onClick={() => setMine(false)}>
              all
            </button>
            <button className={`chip${mine ? " on" : ""}`} onClick={() => setMine(true)}>
              mine
            </button>
          </div>
        )}
      </div>
      {isLoading && <div className="empty">reading the wires…</div>}
      {!isLoading && items.length === 0 && (
        <div className="empty">
          {mine ? "nothing from your wallet yet." : "quiet out there."}
        </div>
      )}
      {items.map((i) => {
        const row = (
          <div className="feed-row" key={i.key}>
            <BandChip name={i.label} size="sm" />
            <span className="feed-verb">
              {VERB[i.kind]}
              {i.cost ? ` · ${i.cost}` : ""}
            </span>
            <span className="feed-time">{ago(i.timestamp)}</span>
          </div>
        );
        return i.txHash ? (
          <a
            key={i.key}
            href={`${EXPLORER}/tx/${i.txHash}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "inherit", display: "block" }}
          >
            {row}
          </a>
        ) : (
          row
        );
      })}
    </>
  );
}
