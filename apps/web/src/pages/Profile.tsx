import { useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useEnsAddress, useEnsText, useReadContract } from "wagmi";
import { type Address } from "viem";
import { robinRegistrarControllerAbi } from "robin-names";
import { ADDRESSES, EXPLORER } from "../config";
import { SHOP_ADDRESS, shopAbi } from "../lib/shop";
import { formatEth, formatUSDG, shortAddress } from "../lib/format";
import { namehash } from "robin-names";
import { toFullName } from "../lib/names";
import { fetchNamesByOwner } from "../indexer";
import { BandChip } from "../components/BandChip";

const ZERO = "0x0000000000000000000000000000000000000000";
const BLOCKSCOUT_API = EXPLORER ? `${EXPLORER}/api/v2` : null;

const TEXT_KEYS = [
  "avatar",
  "description",
  "url",
  "com.twitter",
  "org.telegram",
] as const;

type Holding = {
  symbol: string;
  name: string;
  icon: string | null;
  amount: number;
  usd: number | null;
  address: string;
};

function handleToUrl(kind: "x" | "telegram", raw: string): string {
  const v = raw.trim().replace(/^@/, "");
  if (/^https?:\/\//i.test(v)) return v;
  return kind === "x" ? `https://x.com/${v}` : `https://t.me/${v}`;
}

function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: n >= 1 ? 4 : 6,
  });
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

// ---------------------------------------------------------------------------

export function ProfilePage({ name }: { name: string }) {
  const full = toFullName(name);
  const label = full ? full.replace(/\.robin$/, "") : null;

  useEffect(() => {
    document.title = full ? `${full} — robin` : "robin";
    return () => {
      document.title = "robin — names on Robinhood Chain";
    };
  }, [full]);

  const { address: connected } = useAccount();

  const { data: recipient, isLoading } = useEnsAddress({
    name: full ?? undefined,
    query: { enabled: Boolean(full) },
  });

  const texts = TEXT_KEYS.map(
    (key) =>
      // Static key list — hook order is stable across renders.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEnsText({
        name: full ?? undefined,
        key,
        query: { enabled: Boolean(full) },
      }).data ?? "",
  );
  const [avatar, description, url, xHandle, tgHandle] = texts;

  const isSingleLabel = Boolean(label && !label.includes("."));
  const { data: available } = useReadContract({
    address: ADDRESSES.controller,
    abi: robinRegistrarControllerAbi,
    functionName: "available",
    args: [label ?? ""],
    query: { enabled: isSingleLabel && recipient === null },
  });

  if (!full || !label) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          That doesn&rsquo;t look like a valid name.{" "}
          <Link href="/">Search for one.</Link>
        </p>
      </div>
    );
  }

  const resolved =
    recipient && recipient !== ZERO ? (recipient as Address) : null;
  const isSelf =
    Boolean(connected && resolved) &&
    connected!.toLowerCase() === resolved!.toLowerCase();

  return (
    <>
      <div className="card card--night profile-hero">
        {avatar && /^https:\/\//i.test(avatar) && (
          <img className="profile-avatar" src={avatar} alt="" />
        )}
        <BandChip name={label} variant="green-outline" size="xl" />
        {description && <p className="profile-bio">{description}</p>}
        <div className="chips">
          {resolved && (
            <span className="tag">
              {EXPLORER ? (
                <a
                  className="chip-link"
                  href={`${EXPLORER}/address/${resolved}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(resolved)}
                </a>
              ) : (
                shortAddress(resolved)
              )}
            </span>
          )}
          {url && /^https?:\/\//i.test(url) && (
            <span className="tag">
              <a className="chip-link" href={url} target="_blank" rel="noreferrer">
                {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            </span>
          )}
          {xHandle && (
            <span className="tag">
              <a
                className="chip-link"
                href={handleToUrl("x", xHandle)}
                target="_blank"
                rel="noreferrer"
              >
                x/{xHandle.trim().replace(/^@/, "").replace(/^https?:\/\/(x|twitter)\.com\//i, "")}
              </a>
            </span>
          )}
          {tgHandle && (
            <span className="tag">
              <a
                className="chip-link"
                href={handleToUrl("telegram", tgHandle)}
                target="_blank"
                rel="noreferrer"
              >
                t.me/{tgHandle.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "")}
              </a>
            </span>
          )}
        </div>
        {resolved && (
          <div className="row wrap" style={{ marginTop: 16, gap: 10 }}>
            <Link href={`/pay/${label}`} className="btn">
              pay {label}
            </Link>
            {isSelf && (
              <Link href={`/name/${label}`} className="btn secondary">
                edit records
              </Link>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="card row">
          <div className="progress-ring" /> resolving name…
        </div>
      ) : !resolved ? (
        <div className="card">
          {available ? (
            <p className="muted" style={{ margin: 0 }}>
              Nobody holds this band yet —{" "}
              <Link href={`/name/${label}`}>register {full}</Link> and this
              profile becomes yours.
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {full} doesn&rsquo;t point at an address yet. The owner can set
              one under Records on the name page.
            </p>
          )}
        </div>
      ) : (
        <>
          <ShopBanner label={label} ownerKnown={Boolean(resolved)} />
          <HoldingsCard address={resolved} />
          <BandsCard address={resolved} self={full} />
        </>
      )}
    </>
  );
}

/** When this name runs a subname shop, invite visitors in. */
function ShopBanner({
  label,
  ownerKnown,
}: {
  label: string;
  ownerKnown: boolean;
}) {
  const node = namehash(`${label}.robin`) as `0x${string}`;
  const { data: listing } = useReadContract({
    address: SHOP_ADDRESS,
    abi: shopAbi,
    functionName: "listings",
    args: [node],
    query: { enabled: Boolean(SHOP_ADDRESS) && ownerKnown },
  });
  const seller = listing?.[0];
  const priceUSDG = listing?.[1] ?? 0n;
  const priceETH = listing?.[2] ?? 0n;
  if (!seller || seller === ZERO) return null;
  const priceLine =
    priceUSDG > 0n
      ? formatUSDG(priceUSDG)
      : priceETH > 0n
        ? formatEth(priceETH)
        : "";
  return (
    <div className="card">
      <div className="row between wrap">
        <div>
          <h3 style={{ margin: 0 }}>Shop open 🛍</h3>
          <p className="small faint" style={{ margin: "4px 0 0" }}>
            Get yourname.{label}.robin — {priceLine} each, yours forever.
          </p>
        </div>
        <Link href={`/name/${label}`} className="btn small">
          get yours
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HoldingsCard({ address }: { address: Address }) {
  const { data, isLoading } = useQuery({
    queryKey: ["blockscout-holdings", address],
    enabled: Boolean(BLOCKSCOUT_API),
    staleTime: 60_000,
    queryFn: async () => {
      const [addrRes, tokRes] = await Promise.all([
        fetch(`${BLOCKSCOUT_API}/addresses/${address}`),
        fetch(`${BLOCKSCOUT_API}/addresses/${address}/token-balances`),
      ]);
      // A never-seen address 404s on Blockscout — treat as empty, not an error.
      const addr = addrRes.ok
        ? ((await addrRes.json()) as {
            coin_balance: string | null;
            exchange_rate: string | null;
          })
        : { coin_balance: null, exchange_rate: null };
      const tokens = tokRes.ok
        ? ((await tokRes.json()) as {
            token: {
              address_hash: string;
              decimals: string | null;
              exchange_rate: string | null;
              icon_url: string | null;
              name: string | null;
              symbol: string | null;
              type: string;
            };
            value: string;
          }[])
        : [];

      const eth = BigInt(addr.coin_balance ?? "0");
      const ethUsd = addr.exchange_rate
        ? (Number(eth) / 1e18) * Number(addr.exchange_rate)
        : null;

      const holdings: Holding[] = tokens
        .filter((t) => t.token.type === "ERC-20" && t.token.decimals)
        .map((t) => {
          const amount = Number(t.value) / 10 ** Number(t.token.decimals);
          const rate = t.token.exchange_rate
            ? Number(t.token.exchange_rate)
            : null;
          return {
            symbol: t.token.symbol ?? "?",
            name: t.token.name ?? "Unknown token",
            icon: t.token.icon_url,
            amount,
            usd: rate !== null ? amount * rate : null,
            address: t.token.address_hash,
          };
        })
        .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.amount - a.amount);

      return { eth, ethUsd, holdings };
    },
  });

  if (isLoading) {
    return (
      <div className="card row">
        <div className="progress-ring" /> reading holdings…
      </div>
    );
  }
  if (!data) return null;

  const shown = data.holdings.slice(0, 12);
  const hasAnything = data.eth > 0n || shown.length > 0;

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 12px" }}>Holdings on Robinhood Chain</h3>
      {!hasAnything ? (
        <p className="muted small" style={{ margin: 0 }}>
          Nothing here yet.
        </p>
      ) : (
        <>
          <div className="holding-row">
            <span className="holding-sym">ETH</span>
            <span className="holding-name">Ether</span>
            <span className="holding-amt mono">
              {formatEth(data.eth)}
              {data.ethUsd !== null && data.ethUsd >= 0.01 && (
                <span className="faint"> · {fmtUsd(data.ethUsd)}</span>
              )}
            </span>
          </div>
          {shown.map((h) => (
            <div className="holding-row" key={h.address}>
              {h.icon ? (
                <img className="holding-icon" src={h.icon} alt="" />
              ) : (
                <span className="holding-sym">{h.symbol.slice(0, 4)}</span>
              )}
              <span className="holding-name">
                {h.name}
                <span className="faint"> · {h.symbol}</span>
              </span>
              <span className="holding-amt mono">
                {fmtAmount(h.amount)}
                {h.usd !== null && h.usd >= 0.01 && (
                  <span className="faint"> · {fmtUsd(h.usd)}</span>
                )}
              </span>
            </div>
          ))}
          {data.holdings.length > 12 && EXPLORER && (
            <p className="small" style={{ margin: "10px 0 0" }}>
              <a
                style={{ textDecoration: "underline" }}
                href={`${EXPLORER}/address/${address}?tab=tokens`}
                target="_blank"
                rel="noreferrer"
              >
                all {data.holdings.length} tokens on the explorer
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BandsCard({ address, self }: { address: Address; self: string }) {
  const { data } = useQuery({
    queryKey: ["names-by-owner", address],
    staleTime: 60_000,
    queryFn: () => fetchNamesByOwner(address),
  });

  if (!data) return null;
  const bands = [
    ...data.names.map((n) => n.label).filter((l): l is string => Boolean(l)),
    ...data.subnames.map((s) => s.name.replace(/\.robin$/, "")),
  ].filter((l) => `${l}.robin` !== self);
  if (bands.length === 0) return null;

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 12px" }}>Also banded</h3>
      <div className="row wrap" style={{ gap: 8 }}>
        {bands.slice(0, 24).map((l) => (
          <Link key={l} href={`/u/${l}`}>
            <BandChip name={l} size="sm" />
          </Link>
        ))}
      </div>
    </div>
  );
}
