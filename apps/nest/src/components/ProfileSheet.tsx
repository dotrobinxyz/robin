import { useState } from "react";
import { useEnsAddress, useEnsName } from "wagmi";
import { namehash } from "viem/ens";
import { useQuery } from "@tanstack/react-query";
import { EXPLORER, INDEXER_URL } from "../config";
import { formatEth, shortAddress } from "../lib/format";
import { BandChip } from "./BandChip";
import { PixelBird } from "./PixelBird";

/**
 * In-app profile for any name: who holds it, records, live holdings, their
 * other birds — no bouncing to the explorer. Tapping another name chip
 * navigates inside the sheet.
 */
export function ProfileSheet({
  label: initial,
  onClose,
  onPay,
}: {
  label: string;
  onClose: () => void;
  onPay: (name: string) => void;
}) {
  const [label, setLabel] = useState(initial);
  const full = `${label}.robin`;
  const node = namehash(full);

  const { data: addr } = useEnsAddress({ name: full });
  const resolved = addr && addr !== "0x0000000000000000000000000000000000000000" ? addr : null;
  const { data: ownerPrimary } = useEnsName({
    address: resolved ?? undefined,
    query: { enabled: Boolean(resolved) },
  });

  const { data: records } = useQuery({
    queryKey: ["profile-records", node],
    queryFn: async () => {
      const r = await fetch(`${INDEXER_URL}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `query ($n: String!) {
            textRecords(where: { node: $n }, limit: 20) { items { key value } }
          }`,
          variables: { n: node },
        }),
      });
      const body = await r.json();
      const map: Record<string, string> = {};
      for (const t of body.data.textRecords.items) if (t.value) map[t.key] = t.value;
      return map;
    },
  });

  const { data: holdings } = useQuery({
    queryKey: ["profile-holdings", resolved],
    enabled: Boolean(resolved),
    staleTime: 60_000,
    queryFn: async () => {
      const [a, t] = await Promise.all([
        fetch(`${EXPLORER}/api/v2/addresses/${resolved}`).then((r) =>
          r.ok ? r.json() : { coin_balance: "0" },
        ),
        fetch(`${EXPLORER}/api/v2/addresses/${resolved}/token-balances`).then((r) =>
          r.ok ? r.json() : [],
        ),
      ]);
      const tokens = (t as any[])
        .filter((x) => x.token?.type === "ERC-20" && x.token.decimals)
        .map((x) => ({
          symbol: x.token.symbol ?? "?",
          amount: Number(x.value) / 10 ** Number(x.token.decimals),
          usd: x.token.exchange_rate
            ? (Number(x.value) / 10 ** Number(x.token.decimals)) * Number(x.token.exchange_rate)
            : null,
        }))
        .sort((p: any, q: any) => (q.usd ?? 0) - (p.usd ?? 0))
        .slice(0, 5);
      return { eth: BigInt(a.coin_balance ?? "0"), tokens };
    },
  });

  const { data: theirNames } = useQuery({
    queryKey: ["profile-names", resolved],
    enabled: Boolean(resolved),
    queryFn: async () => {
      const r = await fetch(`${INDEXER_URL}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `query ($o: String!) {
            names(where: { owner: $o }, orderBy: "expiresAt", orderDirection: "asc", limit: 8) {
              items { label }
            }
          }`,
          variables: { o: resolved!.toLowerCase() },
        }),
      });
      const body = await r.json();
      return (body.data.names.items as { label: string | null }[])
        .map((n) => n.label)
        .filter(Boolean) as string[];
    },
  });

  const xHandle = records?.["com.twitter"];

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet scroll" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 12 }}>
          <PixelBird name={label} size={46} />
          <div style={{ minWidth: 0 }}>
            <BandChip name={label} size="sm" variant="green-outline" />
            <p className="small muted mono" style={{ margin: "6px 0 0" }}>
              {resolved
                ? ownerPrimary && ownerPrimary !== full
                  ? `held by ${ownerPrimary}`
                  : shortAddress(resolved)
                : addr === null
                  ? "no address set"
                  : "…"}
            </p>
          </div>
        </div>

        {records?.description && (
          <p style={{ margin: "14px 0 0", fontSize: 14.5 }}>{records.description}</p>
        )}
        {(records?.url || xHandle) && (
          <p className="small mono" style={{ margin: "10px 0 0" }}>
            {records?.url && (
              <a href={records.url} target="_blank" rel="noreferrer">
                {records.url.replace(/^https?:\/\//, "")}
              </a>
            )}
            {records?.url && xHandle && <span className="muted"> · </span>}
            {xHandle && (
              <a href={`https://x.com/${xHandle.replace(/^@/, "")}`} target="_blank" rel="noreferrer">
                @{xHandle.replace(/^@/, "")}
              </a>
            )}
          </p>
        )}

        {holdings && (
          <div style={{ marginTop: 16 }}>
            <p className="small muted mono" style={{ margin: "0 0 4px" }}>
              holdings
            </p>
            <div className="holding-row">
              <span className="holding-sym">Ξ</span>
              <span className="holding-name">ETH</span>
              <span className="holding-right">
                <div className="amt">{formatEth(holdings.eth).replace(" ETH", "")}</div>
              </span>
            </div>
            {holdings.tokens.map((t) => (
              <div className="holding-row" key={t.symbol}>
                <span className="holding-sym">{t.symbol.slice(0, 1).toLowerCase()}</span>
                <span className="holding-name">{t.symbol}</span>
                <span className="holding-right">
                  <div className="amt">
                    {t.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </div>
                  {t.usd != null && t.usd >= 0.01 && (
                    <div className="usd">${t.usd.toFixed(2)}</div>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {theirNames && theirNames.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <p className="small muted mono" style={{ margin: "0 0 8px" }}>
              their birds
            </p>
            <div className="row wrap" style={{ gap: 8 }}>
              {theirNames
                .filter((n) => n !== label)
                .map((n) => (
                  <button
                    key={n}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                    onClick={() => setLabel(n)}
                  >
                    <BandChip name={n} size="sm" />
                  </button>
                ))}
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <button
            className="btn small"
            disabled={!resolved}
            onClick={() => {
              onClose();
              onPay(label);
            }}
          >
            pay {label}
          </button>
          {resolved && (
            <a
              className="small mono muted"
              href={`${EXPLORER}/address/${resolved}`}
              target="_blank"
              rel="noreferrer"
            >
              explorer ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
