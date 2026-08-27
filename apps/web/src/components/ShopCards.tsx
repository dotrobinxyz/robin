import { useMemo, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { erc20Abi, parseEther, parseUnits, type Address, type Hex } from "viem";
import { normalize, robinWrapperAbi } from "robin-names";
import { ADDRESSES, CHAIN, NETWORK } from "../config";
import { SHOP_ADDRESS, shopAbi } from "../lib/shop";
import { formatEth, formatUSDG } from "../lib/format";
import { useTx } from "../lib/useTx";
import { BandChip } from "./BandChip";

const ZERO = "0x0000000000000000000000000000000000000000";
const CANNOT_UNWRAP = 1;

/** Storefront — visible to every visitor of a name with an open shop. */
export function ShopBuyCard({
  label,
  node,
  ownerAddress,
}: {
  label: string;
  node: Hex;
  ownerAddress: Address | undefined;
}) {
  const { address, isConnected } = useAccount();
  const { run, busy, error, setError, walletClient, publicClient } = useTx();
  const [sublabel, setSublabel] = useState("");
  const [currency, setCurrency] = useState<"USDG" | "ETH">("USDG");
  const [boughtLine, setBoughtLine] = useState("");

  const { data: listing, refetch } = useReadContract({
    address: SHOP_ADDRESS,
    abi: shopAbi,
    functionName: "listings",
    args: [node],
    query: { enabled: Boolean(SHOP_ADDRESS), refetchInterval: 30_000 },
  });

  const seller = listing?.[0];
  const priceUSDG = listing?.[1] ?? 0n;
  const priceETH = listing?.[2] ?? 0n;
  const live =
    Boolean(seller && seller !== ZERO) &&
    Boolean(ownerAddress) &&
    seller!.toLowerCase() === ownerAddress!.toLowerCase();

  const normalized = useMemo(() => {
    try {
      const n = normalize(sublabel.trim());
      return n && !n.includes(".") ? n : null;
    } catch {
      return null;
    }
  }, [sublabel]);

  if (!SHOP_ADDRESS || !live) return null;

  const bothCurrencies = priceUSDG > 0n && priceETH > 0n;
  const activeCurrency = bothCurrencies
    ? currency
    : priceUSDG > 0n
      ? "USDG"
      : "ETH";
  const price = activeCurrency === "USDG" ? priceUSDG : priceETH;

  async function buy() {
    if (!walletClient || !publicClient || !address || !normalized) return;
    await run(
      "buy-subname",
      [
        async () => {
          if (activeCurrency === "USDG") {
            const allowance = await publicClient.readContract({
              address: ADDRESSES.usdg,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address, SHOP_ADDRESS!],
            });
            if (allowance < priceUSDG) {
              const h = await walletClient.writeContract({
                address: ADDRESSES.usdg,
                abi: erc20Abi,
                functionName: "approve",
                args: [SHOP_ADDRESS!, priceUSDG],
                chain: CHAIN,
                account: address,
              });
              await publicClient.waitForTransactionReceipt({ hash: h });
            }
            return walletClient.writeContract({
              address: SHOP_ADDRESS!,
              abi: shopAbi,
              functionName: "buyWithUSDG",
              args: [node, normalized],
              chain: CHAIN,
              account: address,
            });
          }
          return walletClient.writeContract({
            address: SHOP_ADDRESS!,
            abi: shopAbi,
            functionName: "buyWithETH",
            args: [node, normalized],
            value: priceETH,
            chain: CHAIN,
            account: address,
          });
        },
      ],
      () => {
        setBoughtLine(`Banded. ${normalized}.${label}.robin is yours.`);
        setSublabel("");
        void refetch();
      },
    );
  }

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 4px" }}>Get your name under {label}.robin</h3>
      <p className="small faint" style={{ margin: "0 0 12px" }}>
        The owner sells subnames here — yours permanently, they can never
        revoke it. {activeCurrency === "USDG"
          ? formatUSDG(price)
          : formatEth(price)}{" "}
        each.
      </p>
      {boughtLine && (
        <div className="toast" style={{ marginBottom: 12 }}>
          {boughtLine}
        </div>
      )}
      <div className="field">
        <input
          className="input mono"
          placeholder="yourname"
          value={sublabel}
          autoCapitalize="none"
          onChange={(e) => {
            setSublabel(e.target.value);
            setError(null);
          }}
        />
        {normalized && (
          <div style={{ marginTop: 10 }}>
            <BandChip name={`${normalized}.${label}`} size="sm" />
          </div>
        )}
      </div>
      {bothCurrencies && (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button
            className={activeCurrency === "USDG" ? "on" : ""}
            onClick={() => setCurrency("USDG")}
          >
            USDG
          </button>
          <button
            className={activeCurrency === "ETH" ? "on" : ""}
            onClick={() => setCurrency("ETH")}
          >
            ETH
          </button>
        </div>
      )}
      {!isConnected ? (
        <p className="muted small" style={{ margin: 0 }}>
          Connect a wallet to buy.
        </p>
      ) : (
        <button
          className="btn block"
          onClick={buy}
          disabled={busy !== null || !normalized}
        >
          {busy ? <span className="progress-ring" /> : null}
          {normalized
            ? `buy ${normalized}.${label}.robin — ${
                activeCurrency === "USDG"
                  ? formatUSDG(price)
                  : formatEth(price)
              }`
            : "enter a name"}
        </button>
      )}
      {error && (
        <p className="notice danger small" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Owner controls — open, reprice, or close the shop on a wrapped name. */
export function ShopOwnerCard({
  label,
  node,
  wrapped,
  fuses,
  onDone,
}: {
  label: string;
  node: Hex;
  wrapped: boolean;
  fuses: number;
  onDone: () => void;
}) {
  const { address } = useAccount();
  const { run, busy, error, setError, walletClient, publicClient } = useTx();
  const [usd, setUsd] = useState("");
  const [eth, setEth] = useState("");

  const { data: reads, refetch } = useReadContracts({
    contracts: [
      {
        address: SHOP_ADDRESS ?? ZERO,
        abi: shopAbi,
        functionName: "listings",
        args: [node],
      },
      {
        address: ADDRESSES.wrapper,
        abi: robinWrapperAbi,
        functionName: "isApprovedForAll",
        args: [address ?? ZERO, SHOP_ADDRESS ?? ZERO],
      },
    ],
    query: { enabled: Boolean(SHOP_ADDRESS && address) },
  });

  if (!SHOP_ADDRESS || !wrapped) return null;

  const listing = reads?.[0]?.result as
    | readonly [Address, bigint, bigint]
    | undefined;
  const approved = Boolean(reads?.[1]?.result);
  const locked = (fuses & CANNOT_UNWRAP) !== 0;
  const open =
    Boolean(listing && listing[0] !== ZERO) &&
    listing![0].toLowerCase() === address?.toLowerCase();

  const priceUSDG = usd.trim() === "" ? 0n : parseUnits(usd.trim(), 6);
  const priceETH = eth.trim() === "" ? 0n : parseEther(eth.trim());

  async function openShop() {
    if (!walletClient || !publicClient || !address) return;
    if (priceUSDG === 0n && priceETH === 0n) {
      setError("Set at least one price.");
      return;
    }
    await run(
      "open-shop",
      [
        // 1. lock the parent (irreversible; skipped when already locked)
        async () =>
          locked
            ? null
            : walletClient.writeContract({
                address: ADDRESSES.wrapper,
                abi: robinWrapperAbi,
                functionName: "setFuses",
                args: [node, CANNOT_UNWRAP],
                chain: CHAIN,
                account: address,
              }),
        // 2. approve the shop as wrapper operator (skipped when done)
        async () =>
          approved
            ? null
            : walletClient.writeContract({
                address: ADDRESSES.wrapper,
                abi: robinWrapperAbi,
                functionName: "setApprovalForAll",
                args: [SHOP_ADDRESS!, true],
                chain: CHAIN,
                account: address,
              }),
        // 3. list
        async () =>
          walletClient.writeContract({
            address: SHOP_ADDRESS!,
            abi: shopAbi,
            functionName: "openShop",
            args: [node, priceUSDG, priceETH],
            chain: CHAIN,
            account: address,
          }),
      ],
      () => {
        setUsd("");
        setEth("");
        void refetch();
        onDone();
      },
    );
  }

  async function closeShop() {
    if (!walletClient || !address) return;
    await run(
      "close-shop",
      [
        async () =>
          walletClient.writeContract({
            address: SHOP_ADDRESS!,
            abi: shopAbi,
            functionName: "closeShop",
            args: [node],
            chain: CHAIN,
            account: address,
          }),
      ],
      () => {
        void refetch();
        onDone();
      },
    );
  }

  return (
    <div className="card">
      <div className="row between wrap">
        <h3 style={{ margin: 0 }}>Subname shop</h3>
        {open && <span className="tag available">open</span>}
      </div>
      <p className="small faint" style={{ margin: "6px 0 12px" }}>
        Sell subnames under {label}.robin — buyers self-serve, you earn 90% of
        every sale instantly (10% goes to the protocol). Sold subnames are
        theirs permanently.
      </p>
      {open && listing && (
        <p className="small muted" style={{ margin: "0 0 12px" }}>
          current prices:{" "}
          {listing[1] > 0n ? formatUSDG(listing[1]) : "—"} ·{" "}
          {listing[2] > 0n ? formatEth(listing[2]) : "—"}
        </p>
      )}
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label>price in USDG</label>
          <input
            className="input mono"
            inputMode="decimal"
            placeholder="5.00"
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label>price in ETH (optional)</label>
          <input
            className="input mono"
            inputMode="decimal"
            placeholder="0.002"
            value={eth}
            onChange={(e) => setEth(e.target.value)}
          />
        </div>
      </div>
      {!locked && (
        <p className="notice warn small" style={{ margin: "0 0 12px" }}>
          Opening a shop permanently locks {label}.robin as a wrapped name (it
          stays tradeable as an NFT, but can never unwrap). This is what makes
          sold subnames truly belong to their buyers.
        </p>
      )}
      <div className="row" style={{ gap: 10 }}>
        <button
          className="btn"
          onClick={openShop}
          disabled={busy !== null}
        >
          {busy === "open-shop" ? <span className="progress-ring" /> : null}
          {open ? "update prices" : locked ? "open shop" : "lock + open shop"}
        </button>
        {open && (
          <button
            className="btn secondary"
            onClick={closeShop}
            disabled={busy !== null}
          >
            close shop
          </button>
        )}
      </div>
      {error && (
        <p className="notice danger small" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
      {NETWORK !== "robinhood" && (
        <p className="muted small" style={{ marginTop: 10 }}>
          Shops are live on mainnet only.
        </p>
      )}
    </div>
  );
}
