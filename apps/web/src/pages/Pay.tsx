import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useAccount,
  useBalance,
  useEnsAddress,
  useEnsText,
  useReadContract,
} from "wagmi";
import {
  erc20Abi,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { robinRegistrarControllerAbi } from "robin-names";
import { renderSVG } from "uqr";
import { ADDRESSES, CHAIN, EXPLORER } from "../config";
import { formatEth, formatUSDG, shortAddress } from "../lib/format";
import { toFullName } from "../lib/names";
import { useTx } from "../lib/useTx";
import { BandChip } from "../components/BandChip";

type Currency = "USDG" | "ETH";

const ZERO = "0x0000000000000000000000000000000000000000";

function parseAmount(value: string, currency: Currency): bigint | null {
  const t = value.trim();
  if (!t || !/^\d*\.?\d+$/.test(t)) return null;
  try {
    const units = currency === "USDG" ? parseUnits(t, 6) : parseEther(t);
    return units > 0n ? units : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

/** /pay — find who to pay. */
export function PayHome() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");

  useEffect(() => {
    document.title = "pay — robin";
    return () => {
      document.title = "robin — names on Robinhood Chain";
    };
  }, []);

  function go() {
    const full = toFullName(query);
    if (!full) return;
    navigate(`/pay/${full.replace(/\.robin$/, "")}`);
  }

  return (
    <>
      <div className="card card--night profile-hero">
        <h1 className="pay-headline">Pay anyone by name.</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 460 }}>
          No addresses. Type a name, send USDG or ETH on Robinhood Chain —
          the name resolves on-chain to its wallet.
        </p>
      </div>
      <div className="card">
        <div className="row">
          <input
            className="input mono"
            placeholder="who are you paying? e.g. dallas"
            value={query}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
          <button className="btn" onClick={go} disabled={!toFullName(query)}>
            pay
          </button>
        </div>
        <p className="small faint" style={{ margin: "12px 0 0" }}>
          Own a name? Your payment link is dotrobin.xyz/pay/yourname — share
          it or show the QR and get paid to the address your band points at.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

/** /pay/:name — resolve and pay, or (if it's yours) build a request link. */
export function PayPage({ name }: { name: string }) {
  const full = toFullName(name);
  const label = full ? full.replace(/\.robin$/, "") : null;

  useEffect(() => {
    document.title = full ? `pay ${full} — robin` : "pay — robin";
    return () => {
      document.title = "robin — names on Robinhood Chain";
    };
  }, [full]);

  const { address: connected } = useAccount();

  const { data: recipient, isLoading } = useEnsAddress({
    name: full ?? undefined,
    query: { enabled: Boolean(full), refetchInterval: 30_000 },
  });
  const { data: avatar } = useEnsText({
    name: full ?? undefined,
    key: "avatar",
    query: { enabled: Boolean(full) },
  });

  // Only 2LD labels can be registered, so only offer that exit for them.
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
          <Link href="/pay">Try another.</Link>
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
          <img className="pay-avatar" src={avatar} alt="" />
        )}
        <BandChip name={label} variant="green-outline" size="xl" />
        {resolved && (
          <div className="chips">
            <span className="tag">
              pays to{" "}
              {EXPLORER ? (
                <a
                  href={`${EXPLORER}/address/${resolved}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  {shortAddress(resolved)}
                </a>
              ) : (
                shortAddress(resolved)
              )}
            </span>
            <span className="tag">
              <Link className="chip-link" href={`/u/${label}`}>
                profile
              </Link>
            </span>
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
              <Link href={`/name/${label}`}>register {full}</Link> and payments
              to it become yours.
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {full} doesn&rsquo;t point at an address yet, so it can&rsquo;t be
              paid. The owner can set one under Records on the name page.
            </p>
          )}
        </div>
      ) : isSelf ? (
        <RequestBuilder label={label} full={full} />
      ) : (
        <SendCard full={full} recipient={resolved} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function SendCard({ full, recipient }: { full: string; recipient: Address }) {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const { address, isConnected } = useAccount();
  const { run, busy, error, walletClient } = useTx();

  const [amount, setAmount] = useState(params.get("amt") ?? "");
  const [currency, setCurrency] = useState<Currency>(
    params.get("cur") === "ETH" ? "ETH" : "USDG",
  );
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [sentLine, setSentLine] = useState("");
  const memo = (params.get("memo") ?? "").slice(0, 140);

  const units = parseAmount(amount, currency);

  const { data: ethBalance } = useBalance({
    address,
    query: { enabled: Boolean(address) && currency === "ETH" },
  });
  const { data: usdgBalance } = useReadContract({
    address: ADDRESSES.usdg,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? ZERO],
    query: { enabled: Boolean(address) && currency === "USDG" },
  });

  const balance = currency === "ETH" ? ethBalance?.value : usdgBalance;
  const insufficient =
    units !== null && balance !== undefined && units > balance;

  async function send() {
    if (!walletClient || !address || units === null) return;
    const pretty = currency === "USDG" ? formatUSDG(units) : formatEth(units);
    await run(
      "pay",
      [
        async () => {
          const hash =
            currency === "USDG"
              ? await walletClient.writeContract({
                  address: ADDRESSES.usdg,
                  abi: erc20Abi,
                  functionName: "transfer",
                  args: [recipient, units],
                  chain: CHAIN,
                  account: address,
                })
              : await walletClient.sendTransaction({
                  to: recipient,
                  value: units,
                  chain: CHAIN,
                  account: address,
                });
          setTxHash(hash);
          return hash;
        },
      ],
      () => {
        setSentLine(`Paid. ${pretty} → ${full}`);
        setAmount("");
      },
    );
  }

  if (sentLine && txHash) {
    return (
      <div className="card">
        <div className="toast" style={{ marginBottom: 14 }}>
          {sentLine}
        </div>
        <div className="row between wrap">
          {EXPLORER && (
            <a
              className="small"
              style={{ textDecoration: "underline" }}
              href={`${EXPLORER}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              view transaction
            </a>
          )}
          <button
            className="btn small secondary"
            onClick={() => {
              setSentLine("");
              setTxHash(null);
            }}
          >
            send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {memo && (
        <p className="pay-memo">
          for: <span>{memo}</span>
        </p>
      )}
      <div className="field">
        <label>Amount</label>
        <div className="row">
          <input
            className="input mono"
            inputMode="decimal"
            placeholder={currency === "USDG" ? "25.00" : "0.01"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="seg" style={{ minWidth: 150 }}>
            <button
              className={currency === "USDG" ? "on" : ""}
              onClick={() => setCurrency("USDG")}
            >
              USDG
            </button>
            <button
              className={currency === "ETH" ? "on" : ""}
              onClick={() => setCurrency("ETH")}
            >
              ETH
            </button>
          </div>
        </div>
      </div>

      {isConnected && balance !== undefined && (
        <p className="small faint" style={{ margin: "0 0 12px" }}>
          your balance:{" "}
          {currency === "USDG" ? formatUSDG(balance) : formatEth(balance)}
          {insufficient && (
            <span className="pay-warn"> — not enough for this payment</span>
          )}
        </p>
      )}

      {!isConnected ? (
        <p className="muted small" style={{ margin: 0 }}>
          Connect a wallet to pay.
        </p>
      ) : (
        <button
          className="btn block"
          onClick={send}
          disabled={busy !== null || units === null || insufficient}
        >
          {busy ? <span className="progress-ring" /> : null}
          {units === null
            ? "enter an amount"
            : `send ${
                currency === "USDG" ? formatUSDG(units) : formatEth(units)
              }`}
        </button>
      )}

      <p className="small faint" style={{ margin: "12px 0 0" }}>
        Payments go straight to the address {full} points at — robin never
        holds funds.
      </p>
      {error && (
        <p className="notice danger small" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The owner's view of their own pay page: build + share a request link. */
export function RequestBuilder({
  label,
  full,
}: {
  label: string;
  full: string;
}) {
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    const base = `${window.location.origin}/pay/${label}`;
    const q = new URLSearchParams();
    if (parseAmount(amount, "USDG") !== null) q.set("amt", amount.trim());
    if (memo.trim()) q.set("memo", memo.trim());
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base;
  }, [label, amount, memo]);

  const qr = useMemo(() => renderSVG(url, { ecc: "M", border: 2 }), [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* input below stays selectable as the fallback */
    }
  }

  const canShare = typeof navigator.share === "function";

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 4px" }}>Get paid.</h3>
      <p className="small faint" style={{ margin: "0 0 14px" }}>
        This band points at your connected wallet. Share the link — or show
        the QR — and anyone can pay {full} without ever seeing an address.
      </p>

      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Amount (USDG, optional)</label>
          <input
            className="input mono"
            inputMode="decimal"
            placeholder="25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 2, minWidth: 170 }}>
          <label>What&rsquo;s it for? (optional)</label>
          <input
            className="input"
            maxLength={140}
            placeholder="lunch"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label>Your payment link</label>
        <input
          className="input mono"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn small" onClick={copy}>
          {copied ? "copied" : "copy link"}
        </button>
        {canShare && (
          <button
            className="btn small secondary"
            onClick={() => navigator.share({ url }).catch(() => {})}
          >
            share
          </button>
        )}
      </div>

      <div
        className="qr-tile"
        // uqr's renderSVG output is generated locally from the URL above.
        dangerouslySetInnerHTML={{ __html: qr }}
      />
    </div>
  );
}
