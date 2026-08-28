import { useState } from "react";
import { useAccount, useEnsName, useReadContract } from "wagmi";
import { erc20Abi, type Hex } from "viem";
import {
  SECONDS_PER_YEAR,
  reverseRegistrarAbi,
  robinRegistrarControllerAbi,
} from "robin-names";
import { ADDRESSES, CHAIN, SITE } from "../config";
import { formatDate, formatEth, formatUSDG } from "../lib/format";
import { useTx } from "../lib/useTx";
import { BandChip } from "./BandChip";

const ZERO_REF = "0x".padEnd(66, "0") as Hex;

/**
 * In-app manage: the two actions people actually need on the go — renew and
 * set-primary — done right here with the connected wallet. Deep controls
 * (records, transfer, subname shop) stay on the web.
 */
export function ManageSheet({
  label,
  expiresAt,
  onClose,
  onChanged,
}: {
  label: string;
  expiresAt: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { address } = useAccount();
  const { run, busy, error, walletClient, publicClient } = useTx();
  const { data: primary, refetch: refetchPrimary } = useEnsName({
    address,
    query: { enabled: Boolean(address) },
  });
  const [years, setYears] = useState(1);
  const [currency, setCurrency] = useState<"USDG" | "ETH">("USDG");
  const [renewedYears, setRenewedYears] = useState(0);
  const duration = BigInt(years) * SECONDS_PER_YEAR;
  const full = `${label}.robin`;
  const isPrimary = primary === full;

  const { data: usdgQuote } = useReadContract({
    address: ADDRESSES.controller,
    abi: robinRegistrarControllerAbi,
    functionName: "rentPriceUSDG",
    args: [label, duration],
  });
  const { data: ethQuote } = useReadContract({
    address: ADDRESSES.controller,
    abi: robinRegistrarControllerAbi,
    functionName: "rentPrice",
    args: [label, duration],
  });
  const quote = currency === "USDG" ? usdgQuote?.base : ethQuote?.base;

  async function renew() {
    if (!walletClient || !publicClient || !address) return;
    setRenewedYears(0);
    if (currency === "USDG") {
      const fresh = await publicClient.readContract({
        address: ADDRESSES.controller,
        abi: robinRegistrarControllerAbi,
        functionName: "rentPriceUSDG",
        args: [label, duration],
      });
      const allowance = await publicClient.readContract({
        address: ADDRESSES.usdg,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, ADDRESSES.controller],
      });
      await run(
        "renew",
        [
          async () =>
            allowance >= fresh.base
              ? null
              : walletClient.writeContract({
                  address: ADDRESSES.usdg,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [ADDRESSES.controller, fresh.base],
                  chain: CHAIN,
                  account: address,
                }),
          async () =>
            walletClient.writeContract({
              address: ADDRESSES.controller,
              abi: robinRegistrarControllerAbi,
              functionName: "renewWithUSDG",
              args: [label, duration, ZERO_REF, fresh.base],
              chain: CHAIN,
              account: address,
            }),
        ],
        () => {
          setRenewedYears(years);
          onChanged();
        },
      );
    } else {
      const fresh = await publicClient.readContract({
        address: ADDRESSES.controller,
        abi: robinRegistrarControllerAbi,
        functionName: "rentPrice",
        args: [label, duration],
      });
      await run(
        "renew",
        [
          async () =>
            walletClient.writeContract({
              address: ADDRESSES.controller,
              abi: robinRegistrarControllerAbi,
              functionName: "renew",
              args: [label, duration, ZERO_REF],
              value: fresh.base,
              chain: CHAIN,
              account: address,
            }),
        ],
        () => {
          setRenewedYears(years);
          onChanged();
        },
      );
    }
  }

  function makePrimary() {
    run(
      "primary",
      [
        async () =>
          walletClient!.writeContract({
            address: ADDRESSES.reverseRegistrar,
            abi: reverseRegistrarAbi,
            functionName: "setName",
            args: [full],
            chain: CHAIN,
            account: address!,
          }),
      ],
      () => {
        refetchPrimary();
        onChanged();
      },
    );
  }

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <BandChip name={label} size="sm" variant="green-outline" />
          <span className="small muted mono">expires {formatDate(expiresAt)}</span>
        </div>

        {renewedYears > 0 && (
          <div className="toast" style={{ margin: "16px 0 0" }}>
            renewed ✓ +{renewedYears} {renewedYears === 1 ? "year" : "years"}
          </div>
        )}

        <div className="field" style={{ margin: "18px 0 0" }}>
          <label>extend</label>
          <div className="chips">
            <button className="chip" onClick={() => setYears(Math.max(1, years - 1))}>
              −
            </button>
            <span className="chip on" style={{ cursor: "default" }}>
              {years} {years === 1 ? "year" : "years"}
            </span>
            <button className="chip" onClick={() => setYears(Math.min(10, years + 1))}>
              +
            </button>
            <button
              className={`chip${currency === "USDG" ? " on" : ""}`}
              onClick={() => setCurrency("USDG")}
            >
              USDG
            </button>
            <button
              className={`chip${currency === "ETH" ? " on" : ""}`}
              onClick={() => setCurrency("ETH")}
            >
              ETH
            </button>
          </div>
        </div>
        <div className="row between" style={{ marginTop: 12 }}>
          <span className="muted mono">
            {quote === undefined
              ? "…"
              : currency === "USDG"
                ? formatUSDG(quote)
                : formatEth(quote)}
          </span>
          <button className="btn small" disabled={busy !== null} onClick={renew}>
            {busy === "renew" ? <span className="progress-ring" /> : null} renew
          </button>
        </div>

        <div className="row between" style={{ marginTop: 20 }}>
          <span className="small muted">primary name</span>
          {isPrimary ? (
            <span className="tag green">primary ✓</span>
          ) : (
            <button className="btn small secondary" disabled={busy !== null} onClick={makePrimary}>
              {busy === "primary" ? <span className="progress-ring" /> : null} make primary
            </button>
          )}
        </div>

        {error && (
          <p className="notice danger" style={{ marginTop: 14, marginBottom: 0 }}>
            {error}
          </p>
        )}

        <p className="small muted" style={{ margin: "20px 0 0" }}>
          records, transfer, subname shop —{" "}
          <a href={`${SITE}/name/${label}`} target="_blank" rel="noreferrer">
            full controls on the web →
          </a>
        </p>
      </div>
    </div>
  );
}
