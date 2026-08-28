import { useState } from "react";
import { useAccount } from "wagmi";
import { namehash } from "viem/ens";
import { useQuery } from "@tanstack/react-query";
import { EXPLORER, INDEXER_URL } from "../config";
import { formatEth, formatUSDG } from "../lib/format";
import { PixelBird } from "../components/PixelBird";
import { ProfileSheet } from "../components/ProfileSheet";

type FeedItem = {
  key: string;
  kind: "registration" | "renewal" | "subname" | "gold";
  label: string;
  owner: string;
  cost: string | null;
  timestamp: number;
  txHash: string | null;
};

type FeedData = {
  items: FeedItem[];
  totalNames: number;
  feesUsd: number | null;
  todayCount: number;
  goldNodes: Set<string>;
};

async function fetchFeed(): Promise<FeedData> {
  const [gqlRes, statsRes] = await Promise.all([
    fetch(`${INDEXER_URL}/graphql`, {
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
          stats(id: 1) { names ethRevenueWei usdgRevenue }
          goldBands(limit: 500) { items { node label until updatedAt } }
        }`,
      }),
    }),
    fetch(`${EXPLORER}/api/v2/stats`).catch(() => null),
  ]);
  const body = await gqlRes.json();
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

  const stats = body.data.stats;
  let feesUsd: number | null = null;
  try {
    const price = statsRes?.ok ? Number((await statsRes.json()).coin_price) : NaN;
    const eth = Number(BigInt(stats.ethRevenueWei)) / 1e18;
    const usdg = Number(BigInt(stats.usdgRevenue)) / 1e6;
    feesUsd = usdg + (Number.isFinite(price) ? eth * price : 0);
  } catch {
    feesUsd = null;
  }
  const nowSec = Date.now() / 1000;
  const goldRows = (body.data.goldBands?.items ?? []) as {
    node: string;
    label: string | null;
    until: string;
    updatedAt: string;
  }[];
  const goldNodes = new Set<string>(
    goldRows.filter((g) => Number(g.until) > nowSec).map((g) => g.node.toLowerCase()),
  );
  const golds: FeedItem[] = goldRows
    .filter((g) => g.label)
    .map((g) => ({
      key: `gold-${g.node}`,
      kind: "gold" as const,
      label: g.label!,
      owner: "",
      cost: null,
      timestamp: Number(g.updatedAt),
      txHash: null,
    }));
  const dayAgo = nowSec - 86400;
  return {
    items: [...regs, ...subs, ...golds]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 60),
    totalNames: Number(stats.names),
    feesUsd,
    todayCount: regs.filter((r) => r.kind === "registration" && r.timestamp > dayAgo).length,
    goldNodes,
  };
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
  subname: "minted",
  gold: "went gold",
};

function NameInline({ label }: { label: string }) {
  return (
    <span className="feed-name">
      {label}
      <span className="tld">.robin</span>
    </span>
  );
}

function Row({
  item,
  gold,
  onOpen,
}: {
  item: FeedItem;
  gold: boolean;
  onOpen: (label: string) => void;
}) {
  return (
    <div className="feed-row" role="button" onClick={() => onOpen(item.label)}>
      <PixelBird name={item.label} gold={gold || item.kind === "gold"} />
      <span className="feed-text">
        <NameInline label={item.label} />{" "}
        {item.kind === "gold" ? (
          <span style={{ color: "#e8c24a" }}>went gold ✦</span>
        ) : (
          VERB[item.kind]
        )}
        {item.cost ? ` — ${item.cost}` : ""}
      </span>
      <span className="feed-time">{ago(item.timestamp)}</span>
    </div>
  );
}

export function FeedTab({ onPay }: { onPay: (name: string) => void }) {
  const { address, isConnected } = useAccount();
  const [mine, setMine] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["feed"],
    queryFn: fetchFeed,
    refetchInterval: 30_000,
  });

  const items = (data?.items ?? []).filter(
    (i) => !mine || (address && i.owner.toLowerCase() === address.toLowerCase()),
  );

  return (
    <>
      <div className="row between" style={{ margin: "18px 0 14px" }}>
        <div className="h1" style={{ margin: 0 }}>
          The feed.
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

      {data && !mine && (
        <div className="pinned">
          <div className="pinned-tag">pinned</div>
          <div className="pinned-title">the flock is growing.</div>
          <div className="pinned-stats">
            {data.totalNames} names
            {data.feesUsd != null &&
              ` · $${Math.round(data.feesUsd).toLocaleString("en-US")} fees`}
            {data.todayCount > 0 && ` · ${data.todayCount} today`}
          </div>
        </div>
      )}

      {isLoading && <div className="empty">reading the wires…</div>}
      {!isLoading && items.length === 0 && (
        <div className="empty">{mine ? "nothing from your wallet yet." : "quiet out there."}</div>
      )}
      {items.map((i, idx) => (
        <div key={i.key}>
          <Row
            item={i}
            gold={Boolean(
              data?.goldNodes.has(namehash(`${i.label}.robin`).toLowerCase()),
            )}
            onOpen={setProfile}
          />
          {idx === 2 && !mine && data && data.todayCount > 0 && (
            <div className="feed-row">
              <span className="feed-square">
                <span />
              </span>
              <span className="feed-text muted">
                {data.todayCount} name{data.todayCount === 1 ? "" : "s"} banded today
              </span>
              <span className="feed-time">—</span>
            </div>
          )}
        </div>
      ))}
      {profile && (
        <ProfileSheet label={profile} onClose={() => setProfile(null)} onPay={onPay} />
      )}
    </>
  );
}
