import { useAccount, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { robinBaseRegistrarAbi, robinTokenId } from "robin-names";
import { ADDRESSES, EXPLORER, INDEXER_URL, SITE } from "../config";
import { formatDate, formatEth } from "../lib/format";
import { BandChip } from "../components/BandChip";

type IndexedName = {
  id: string;
  label: string | null;
  owner: string;
  expiresAt: string;
  wrapped: boolean;
};
type IndexedSubname = { id: string; name: string };

async function fetchOwned(owner: string): Promise<{
  names: IndexedName[];
  subnames: IndexedSubname[];
}> {
  const res = await fetch(`${INDEXER_URL}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query ($o: String!) {
        names(where: { owner: $o }, orderBy: "expiresAt", orderDirection: "asc", limit: 100) {
          items { id label owner expiresAt wrapped }
        }
        subnames(where: { owner: $o }, orderBy: "createdAt", orderDirection: "desc", limit: 100) {
          items { id name }
        }
      }`,
      variables: { o: owner.toLowerCase() },
    }),
  });
  const body = await res.json();
  return {
    names: body.data.names.items,
    subnames: body.data.subnames.items,
  };
}

/** One bird: on-chain art straight from the registrar's tokenURI. */
function BirdCard({ name }: { name: IndexedName }) {
  const { data: uri } = useReadContract({
    address: ADDRESSES.baseRegistrar,
    abi: robinBaseRegistrarAbi,
    functionName: "tokenURI",
    args: [robinTokenId(name.label!)],
    query: { staleTime: 300_000 },
  });

  let image: string | null = null;
  try {
    if (uri) {
      const json = JSON.parse(atob((uri as string).split("base64,")[1]!));
      image = json.image as string;
    }
  } catch {
    image = null;
  }

  const soon =
    Number(name.expiresAt) - Date.now() / 1000 < 30 * 86400;

  return (
    <div className="bird-card">
      {image && <img src={image} alt={`${name.label}.robin`} loading="lazy" />}
      <div className="meta">
        <BandChip name={name.label!} size="sm" variant="green-outline" />
        <span className="exp">
          {soon ? "⚠ " : ""}expires {formatDate(name.expiresAt)}
        </span>
        <a
          className="btn small"
          href={`${SITE}/name/${name.label}`}
          target="_blank"
          rel="noreferrer"
        >
          manage
        </a>
      </div>
    </div>
  );
}

function Tokens({ address }: { address: `0x${string}` }) {
  const { data } = useQuery({
    queryKey: ["nest-holdings", address],
    staleTime: 60_000,
    queryFn: async () => {
      const [a, t] = await Promise.all([
        fetch(`${EXPLORER}/api/v2/addresses/${address}`).then((r) =>
          r.ok ? r.json() : { coin_balance: "0", exchange_rate: null },
        ),
        fetch(`${EXPLORER}/api/v2/addresses/${address}/token-balances`).then(
          (r) => (r.ok ? r.json() : []),
        ),
      ]);
      const eth = BigInt(a.coin_balance ?? "0");
      const rate = a.exchange_rate ? Number(a.exchange_rate) : null;
      const tokens = (t as any[])
        .filter((x) => x.token?.type === "ERC-20" && x.token.decimals)
        .map((x) => ({
          symbol: x.token.symbol ?? "?",
          name: x.token.name ?? "?",
          icon: x.token.icon_url as string | null,
          amount: Number(x.value) / 10 ** Number(x.token.decimals),
          usd: x.token.exchange_rate
            ? (Number(x.value) / 10 ** Number(x.token.decimals)) *
              Number(x.token.exchange_rate)
            : null,
        }))
        .sort((p: any, q: any) => (q.usd ?? 0) - (p.usd ?? 0));
      return { eth, ethUsd: rate ? (Number(eth) / 1e18) * rate : null, tokens };
    },
  });

  if (!data) return null;
  return (
    <div className="card">
      <h3 className="card-title" style={{ fontSize: 15 }}>Tokens</h3>
      <div className="holding-row">
        <span className="holding-sym">Ξ</span>
        <span className="holding-name">ETH</span>
        <span className="holding-right">
          <div className="amt">{formatEth(data.eth).replace(" ETH", "")}</div>
          {data.ethUsd != null && data.ethUsd >= 0.01 && (
            <div className="usd">${data.ethUsd.toFixed(2)}</div>
          )}
        </span>
      </div>
      {data.tokens.slice(0, 10).map((t: any) => (
        <div className="holding-row" key={t.symbol + t.name}>
          {t.icon ? (
            <img className="holding-icon" src={t.icon} alt="" />
          ) : (
            <span
              className="holding-sym"
              style={
                t.symbol === "ROBIN" ? { color: "var(--green)" } : undefined
              }
            >
              {t.symbol === "USDG" ? "$" : t.symbol.slice(0, 1).toLowerCase()}
            </span>
          )}
          <span className="holding-name">{t.symbol}</span>
          <span className="holding-right">
            <div className="amt">
              {t.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })}
            </div>
            {t.usd != null && t.usd >= 0.01 && (
              <div className="usd">${t.usd.toFixed(2)}</div>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function NestTab() {
  const { address, isConnected } = useAccount();
  const { data } = useQuery({
    queryKey: ["nest-owned", address],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    queryFn: () => fetchOwned(address!),
  });

  if (!isConnected || !address) {
    return (
      <div className="empty">
        connect a wallet to see your nest —<br />
        your birds, your tokens, your names.
      </div>
    );
  }

  const named = (data?.names ?? []).filter((n) => n.label);

  return (
    <>
      <div className="h1">Your nest.</div>
      {named.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No birds yet —{" "}
            <a href={SITE} target="_blank" rel="noreferrer">
              band your first name
            </a>{" "}
            and it lives here.
          </p>
        </div>
      )}
      {named.map((n) => (
        <BirdCard key={n.id} name={n} />
      ))}
      {(data?.subnames ?? []).length > 0 && (
        <div className="card">
          <h3 className="card-title" style={{ fontSize: 15 }}>
            Subnames
          </h3>
          <div className="row wrap" style={{ gap: 8 }}>
            {data!.subnames.map((s) => (
              <BandChip
                key={s.id}
                name={s.name.replace(/\.robin$/, "")}
                size="sm"
              />
            ))}
          </div>
        </div>
      )}
      <Tokens address={address} />
    </>
  );
}
