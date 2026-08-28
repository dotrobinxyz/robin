import { useEffect, useState } from "react";
import { useAccount, useEnsName, useReadContract, useReadContracts } from "wagmi";
import { encodeFunctionData, erc20Abi } from "viem";
import {
  REVERSE_RECORD_CHAIN,
  SECONDS_PER_YEAR,
  makeCommitment,
  makeRegistration,
  publicResolverAbi,
  randomSecret,
  robinNode,
  robinRegistrarControllerAbi,
  robinReservedListAbi,
  type Registration,
} from "robin-names";
import { ADDRESSES, CHAIN } from "../config";
import { formatEth, formatUSDG } from "../lib/format";
import { useTx } from "../lib/useTx";
import {
  clearPending,
  lastPendingLabel,
  loadPending,
  savePending,
  type PendingRegistration,
} from "../lib/pending";
import { BandChip } from "./BandChip";
import { PixelBird } from "./PixelBird";

const MIN_COMMIT_AGE = 60; // seconds; matches deployed config

/** Band a new name without leaving the app: commit → 60s → register. */
export function RegisterSheet({
  onClose,
  onDone,
  onViewProfile,
}: {
  onClose: () => void;
  onDone: () => void;
  onViewProfile: (label: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const { run, busy, error, setError, walletClient, publicClient } = useTx();
  const { data: myPrimary } = useEnsName({
    address,
    query: { enabled: Boolean(address) },
  });

  const [query, setQuery] = useState(() => lastPendingLabel(CHAIN.id) ?? "");
  const [years, setYears] = useState(1);
  const [currency, setCurrency] = useState<"USDG" | "ETH">("USDG");
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [banded, setBanded] = useState("");

  const label = query.trim().toLowerCase();
  const plausible = /^[a-z0-9-]{3,}$/.test(label);

  useEffect(() => {
    setPending(plausible ? loadPending(CHAIN.id, label) : null);
    setBanded("");
  }, [label, plausible]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: checks } = useReadContracts({
    contracts: [
      {
        address: ADDRESSES.controller,
        abi: robinRegistrarControllerAbi,
        functionName: "available",
        args: [label],
      },
      {
        address: ADDRESSES.controller,
        abi: robinRegistrarControllerAbi,
        functionName: "valid",
        args: [label],
      },
      {
        address: ADDRESSES.reservedList,
        abi: robinReservedListAbi,
        functionName: "isReserved",
        args: [label],
      },
    ],
    query: { enabled: plausible, refetchInterval: 15_000 },
  });
  const available = checks?.[0]?.result as boolean | undefined;
  const valid = checks?.[1]?.result as boolean | undefined;
  const reserved = checks?.[2]?.result as boolean | undefined;

  const duration = BigInt(years) * SECONDS_PER_YEAR;
  const quoteDuration = pending?.registration.duration ?? duration;
  const activeCurrency = pending?.currency ?? currency;
  const { data: quote } = useReadContract({
    address: ADDRESSES.controller,
    abi: robinRegistrarControllerAbi,
    functionName: activeCurrency === "USDG" ? "rentPriceUSDG" : "rentPrice",
    args: [label, quoteDuration],
    query: { enabled: plausible && available === true, refetchInterval: 12_000 },
  });
  const total = quote ? quote.base + quote.premium : undefined;

  const waitLeft = pending ? pending.committedAt + MIN_COMMIT_AGE - now : 0;

  async function commit() {
    if (!walletClient || !address) return;
    const registration = makeRegistration({
      label,
      owner: address,
      duration,
      secret: randomSecret(),
      resolver: ADDRESSES.publicResolver,
      data: [
        encodeFunctionData({
          abi: publicResolverAbi,
          functionName: "setAddr",
          args: [robinNode(label), address],
        }),
      ],
      // First bird becomes the primary name automatically; never clobber an
      // existing primary from the app.
      reverseRecord: myPrimary ? 0 : REVERSE_RECORD_CHAIN,
    });
    const commitment = makeCommitment(registration);
    await run("commit", [
      async () =>
        walletClient.writeContract({
          address: ADDRESSES.controller,
          abi: robinRegistrarControllerAbi,
          functionName: "commit",
          args: [commitment],
          chain: CHAIN,
          account: address,
        }),
    ]);
    const record: PendingRegistration = {
      registration,
      commitment,
      committedAt: Math.floor(Date.now() / 1000),
      currency,
    };
    savePending(CHAIN.id, record);
    setPending(record);
  }

  async function register() {
    if (!walletClient || !publicClient || !pending || !address) return;
    const registration = pending.registration as Registration;

    if (pending.currency === "USDG") {
      const fresh = await publicClient.readContract({
        address: ADDRESSES.controller,
        abi: robinRegistrarControllerAbi,
        functionName: "rentPriceUSDG",
        args: [label, registration.duration],
      });
      const maxTotal = fresh.base + fresh.premium;
      const allowance = await publicClient.readContract({
        address: ADDRESSES.usdg,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, ADDRESSES.controller],
      });
      await run(
        "register",
        [
          async () =>
            allowance >= maxTotal
              ? null
              : walletClient.writeContract({
                  address: ADDRESSES.usdg,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [ADDRESSES.controller, maxTotal],
                  chain: CHAIN,
                  account: address,
                }),
          async () =>
            walletClient.writeContract({
              address: ADDRESSES.controller,
              abi: robinRegistrarControllerAbi,
              functionName: "registerWithUSDG",
              args: [registration, maxTotal],
              chain: CHAIN,
              account: address,
            }),
        ],
        finish,
      );
    } else {
      const fresh = await publicClient.readContract({
        address: ADDRESSES.controller,
        abi: robinRegistrarControllerAbi,
        functionName: "rentPrice",
        args: [label, registration.duration],
      });
      await run(
        "register",
        [
          async () =>
            walletClient.writeContract({
              address: ADDRESSES.controller,
              abi: robinRegistrarControllerAbi,
              functionName: "register",
              args: [registration],
              value: fresh.base + fresh.premium,
              chain: CHAIN,
              account: address,
            }),
        ],
        finish,
      );
    }
  }

  function finish() {
    clearPending(CHAIN.id, label);
    setPending(null);
    setBanded(label);
    onDone();
  }

  function cancelPending() {
    clearPending(CHAIN.id, label);
    setPending(null);
    setError(null);
  }

  const status = !plausible
    ? null
    : reserved
      ? "reserved"
      : valid === false
        ? "invalid"
        : available === false
          ? "taken"
          : available === true
            ? "available"
            : "checking";

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet scroll" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title" style={{ marginBottom: 12 }}>
          Band a name.
        </h3>

        {banded ? (
          <>
            <div className="toast">
              banded ✓ {banded}.robin is yours — it's in your nest.
            </div>
            <button className="btn block" onClick={onClose}>
              done
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <input
                className="input mono"
                placeholder="yourname"
                value={query}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={Boolean(pending)}
                onChange={(e) => setQuery(e.target.value)}
              />
              {plausible && (
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <PixelBird name={label} size={30} />
                  <BandChip name={label} size="sm" />
                  {status === "available" && <span className="tag green">available</span>}
                  {status === "taken" && <span className="tag">taken</span>}
                  {status === "reserved" && <span className="tag">reserved</span>}
                  {status === "invalid" && <span className="tag">invalid</span>}
                </div>
              )}
            </div>

            {status === "taken" && (
              <button
                className="btn small secondary"
                onClick={() => {
                  onClose();
                  onViewProfile(label);
                }}
              >
                view profile
              </button>
            )}
            {status === "reserved" && (
              <p className="small muted" style={{ margin: 0 }}>
                reserved — tickers, protocol names, and brand-abuse terms are held back.
              </p>
            )}

            {status === "available" && !pending && (
              <>
                <div className="field">
                  <label>period + currency</label>
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
                <div className="row between" style={{ marginBottom: 12 }}>
                  <span className="muted mono">
                    {total === undefined
                      ? "…"
                      : activeCurrency === "USDG"
                        ? formatUSDG(total)
                        : formatEth(total)}
                  </span>
                </div>
                <button
                  className="btn block"
                  disabled={!isConnected || busy !== null || total === undefined}
                  onClick={commit}
                >
                  {busy === "commit" ? <span className="progress-ring" /> : null}
                  {isConnected ? "band it" : "connect a wallet first"}
                </button>
                <p className="small muted" style={{ margin: "10px 0 0" }}>
                  two taps: a quick lock-in now, then confirm after ~60s. stay in the app.
                </p>
              </>
            )}

            {pending && waitLeft > 0 && (
              <>
                <div className="notice" style={{ background: "var(--line)", marginBottom: 12 }}>
                  locking in your name… {waitLeft}s
                </div>
                <button className="btn small secondary" onClick={cancelPending}>
                  cancel
                </button>
              </>
            )}
            {pending && waitLeft <= 0 && (
              <button className="btn block" disabled={busy !== null} onClick={register}>
                {busy === "register" ? <span className="progress-ring" /> : null}
                confirm — pay{" "}
                {total === undefined
                  ? "…"
                  : activeCurrency === "USDG"
                    ? formatUSDG(total)
                    : formatEth(total)}
              </button>
            )}

            {error && (
              <p className="notice danger" style={{ marginTop: 12, marginBottom: 0 }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
