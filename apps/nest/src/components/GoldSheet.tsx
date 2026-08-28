import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import { namehash } from "viem/ens";
import { ADDRESSES, CHAIN } from "../config";
import { formatDate, formatEth, formatUSDG } from "../lib/format";
import { GOLD_BAND, goldAbi } from "../lib/gold";
import { useTx } from "../lib/useTx";
import { BandChip } from "./BandChip";
import { PixelBird } from "./PixelBird";

/** Go gold (or gift it): $6.99/month or $50/year, USDG or ETH. Half of every
 *  payment funds the public ROBIN buy-and-burn vault. */
export function GoldSheet({
  label,
  onClose,
  onDone,
}: {
  label: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const node = namehash(`${label}.robin`);
  const { address } = useAccount();
  const { run, busy, error, walletClient, publicClient } = useTx();
  const [yearly, setYearly] = useState(true);
  const [currency, setCurrency] = useState<"USDG" | "ETH">("USDG");
  const [paid, setPaid] = useState(false);

  const { data: until, refetch } = useReadContract({
    address: GOLD_BAND,
    abi: goldAbi,
    functionName: "goldUntil",
    args: [node],
  });
  const active = until !== undefined && Number(until) * 1000 > Date.now();

  const { data: usdgPrice } = useReadContract({
    address: GOLD_BAND,
    abi: goldAbi,
    functionName: "priceInUSDG",
    args: [1n, yearly],
  });
  const { data: weiPrice } = useReadContract({
    address: GOLD_BAND,
    abi: goldAbi,
    functionName: "priceInWei",
    args: [1n, yearly],
    query: { refetchInterval: 30_000 },
  });
  const price = currency === "USDG" ? usdgPrice : weiPrice;

  async function pay() {
    if (!walletClient || !publicClient || !address) return;
    if (currency === "USDG") {
      const fresh = await publicClient.readContract({
        address: GOLD_BAND,
        abi: goldAbi,
        functionName: "priceInUSDG",
        args: [1n, yearly],
      });
      const allowance = await publicClient.readContract({
        address: ADDRESSES.usdg,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, GOLD_BAND],
      });
      await run(
        "gold",
        [
          async () =>
            allowance >= fresh
              ? null
              : walletClient.writeContract({
                  address: ADDRESSES.usdg,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [GOLD_BAND, fresh],
                  chain: CHAIN,
                  account: address,
                }),
          async () =>
            walletClient.writeContract({
              address: GOLD_BAND,
              abi: goldAbi,
              functionName: "extendWithUSDG",
              args: [node, 1n, yearly],
              chain: CHAIN,
              account: address,
            }),
        ],
        finish,
      );
    } else {
      const fresh = await publicClient.readContract({
        address: GOLD_BAND,
        abi: goldAbi,
        functionName: "priceInWei",
        args: [1n, yearly],
      });
      await run(
        "gold",
        [
          async () =>
            walletClient.writeContract({
              address: GOLD_BAND,
              abi: goldAbi,
              functionName: "extendWithETH",
              args: [node, 1n, yearly],
              value: fresh,
              chain: CHAIN,
              account: address,
            }),
        ],
        finish,
      );
    }
  }

  function finish() {
    setPaid(true);
    refetch();
    onDone?.();
  }

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 12 }}>
          <PixelBird name={label} size={42} gold />
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>
              Gold band.
            </h3>
            <BandChip name={label} size="sm" />
          </div>
        </div>

        {paid && (
          <div className="toast" style={{ margin: "14px 0 0" }}>
            gold ✓ {label}.robin is banded in gold
            {until !== undefined && ` until ${formatDate(until)}`}
          </div>
        )}
        {!paid && active && until !== undefined && (
          <p className="small mono" style={{ margin: "12px 0 0", color: "#e8c24a" }}>
            gold until {formatDate(until)} — paying extends it.
          </p>
        )}

        <p className="small muted" style={{ margin: "12px 0 0" }}>
          the gold check on your bird — in the feed, on your profile, at pay
          time. half of every gold payment buys ROBIN and burns it.
        </p>

        <div className="field" style={{ margin: "16px 0 0" }}>
          <div className="chips">
            <button className={`chip${yearly ? "" : " on"}`} onClick={() => setYearly(false)}>
              monthly · $6.99
            </button>
            <button className={`chip${yearly ? " on" : ""}`} onClick={() => setYearly(true)}>
              yearly · $50
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

        <div className="row between" style={{ marginTop: 14 }}>
          <span className="muted mono">
            {price === undefined
              ? "…"
              : currency === "USDG"
                ? formatUSDG(price)
                : formatEth(price)}
          </span>
          <button className="btn small" disabled={busy !== null || !address} onClick={pay}>
            {busy ? <span className="progress-ring" /> : null}
            {active ? "extend gold" : "go gold"}
          </button>
        </div>

        {error && (
          <p className="notice danger" style={{ marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
