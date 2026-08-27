import { useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useEnsAddress,
  useEnsName,
} from "wagmi";
import { erc20Abi, parseUnits, type Address } from "viem";
import { useQuery } from "@tanstack/react-query";
import { renderSVG } from "uqr";
import { CHAIN, EXPLORER, SITE } from "../config";
import { toFullName } from "../lib/names";
import { formatEth } from "../lib/format";
import { useTx } from "../lib/useTx";
import { BandChip } from "../components/BandChip";

type TokenOpt = {
  symbol: string;
  address: Address | null; // null = native ETH
  decimals: number;
  balance: bigint;
};

export function PayTab() {
  const { address, isConnected } = useAccount();
  const { run, busy, error, walletClient } = useTx();
  const { data: primary } = useEnsName({
    address,
    query: { enabled: Boolean(address) },
  });

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenIdx, setTokenIdx] = useState(0);
  const [sent, setSent] = useState("");

  const full = toFullName(to);
  const { data: recipient } = useEnsAddress({
    name: full ?? undefined,
    query: { enabled: Boolean(full) },
  });
  const resolved =
    recipient && recipient !== "0x0000000000000000000000000000000000000000"
      ? (recipient as Address)
      : null;

  const { data: ethBal } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  const { data: tokens } = useQuery({
    queryKey: ["pay-tokens", address],
    enabled: Boolean(address),
    staleTime: 60_000,
    queryFn: async (): Promise<TokenOpt[]> => {
      const r = await fetch(
        `${EXPLORER}/api/v2/addresses/${address}/token-balances`,
      );
      const list = r.ok ? await r.json() : [];
      return (list as any[])
        .filter((x) => x.token?.type === "ERC-20" && x.token.decimals)
        .map((x) => ({
          symbol: x.token.symbol ?? "?",
          address: x.token.address_hash as Address,
          decimals: Number(x.token.decimals),
          balance: BigInt(x.value),
        }));
    },
  });

  const options: TokenOpt[] = useMemo(
    () => [
      {
        symbol: "ETH",
        address: null,
        decimals: 18,
        balance: ethBal?.value ?? 0n,
      },
      ...(tokens ?? []),
    ],
    [ethBal, tokens],
  );
  const token = options[Math.min(tokenIdx, options.length - 1)]!;

  const units = useMemo(() => {
    const t = amount.trim();
    if (!t || !/^\d*\.?\d+$/.test(t)) return null;
    try {
      const u = parseUnits(t, token.decimals);
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  }, [amount, token]);

  const insufficient = units !== null && units > token.balance;

  async function send() {
    if (!walletClient || !address || !resolved || units === null) return;
    await run(
      "send",
      [
        async () =>
          token.address === null
            ? walletClient.sendTransaction({
                to: resolved,
                value: units,
                chain: CHAIN,
                account: address,
              })
            : walletClient.writeContract({
                address: token.address,
                abi: erc20Abi,
                functionName: "transfer",
                args: [resolved, units],
                chain: CHAIN,
                account: address,
              }),
      ],
      () => {
        setSent(`Sent. ${amount} ${token.symbol} → ${full}`);
        setAmount("");
      },
    );
  }

  const myPayUrl = primary
    ? `${SITE}/pay/${primary.replace(/\.robin$/, "")}`
    : null;
  const qr = useMemo(
    () => (myPayUrl ? renderSVG(myPayUrl, { ecc: "M", border: 2 }) : null),
    [myPayUrl],
  );

  if (!isConnected) {
    return <div className="empty">connect a wallet to send + receive.</div>;
  }

  return (
    <>
      <div className="card">
        <h3 style={{ margin: "0 0 10px", fontFamily: "var(--display)" }}>
          Send by name
        </h3>
        {sent && <div className="toast">{sent}</div>}
        <div className="field">
          <label>to</label>
          <input
            className="input mono"
            placeholder="dallas"
            value={to}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setTo(e.target.value);
              setSent("");
            }}
          />
          {full && (
            <div style={{ marginTop: 8 }}>
              <BandChip name={full.replace(/\.robin$/, "")} size="sm" />
              <span className="small muted" style={{ marginLeft: 8 }}>
                {resolved
                  ? "resolves ✓"
                  : recipient === null
                    ? "no address set"
                    : "…"}
              </span>
            </div>
          )}
        </div>
        <div className="field">
          <label>token</label>
          <select
            className="input mono"
            value={tokenIdx}
            onChange={(e) => setTokenIdx(Number(e.target.value))}
          >
            {options.map((t, i) => (
              <option key={t.symbol + i} value={i}>
                {t.symbol} —{" "}
                {t.address === null
                  ? formatEth(t.balance)
                  : (Number(t.balance) / 10 ** t.decimals).toLocaleString(
                      "en-US",
                      { maximumFractionDigits: 4 },
                    )}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>amount</label>
          <input
            className="input mono"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {insufficient && (
            <p className="small" style={{ color: "#a33b30", margin: "6px 0 0" }}>
              not enough {token.symbol}
            </p>
          )}
        </div>
        <button
          className="btn block"
          onClick={send}
          disabled={busy !== null || !resolved || units === null || insufficient}
        >
          {busy ? <span className="progress-ring" /> : null}
          {!resolved
            ? "enter a name"
            : units === null
              ? "enter an amount"
              : `send ${amount} ${token.symbol}`}
        </button>
        {error && (
          <p className="notice danger" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 6px", fontFamily: "var(--display)" }}>
          Receive
        </h3>
        {myPayUrl && qr ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              show this — they scan, they pay {primary}. no addresses.
            </p>
            <div className="qr-tile" dangerouslySetInnerHTML={{ __html: qr }} />
            <p
              className="small mono muted"
              style={{ textAlign: "center", margin: "8px 0 0" }}
            >
              {myPayUrl.replace("https://", "")}
            </p>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Set a primary name on{" "}
            <a href={SITE} target="_blank" rel="noreferrer">
              dotrobin.xyz
            </a>{" "}
            and your payment QR appears here.
          </p>
        )}
      </div>
    </>
  );
}
