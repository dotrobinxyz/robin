import { useMemo, useState } from "react";
import { useEnsAddress, usePublicClient } from "wagmi";
import { isAddress, parseEther, type Address } from "viem";
import { useQuery } from "@tanstack/react-query";
import { renderSVG } from "uqr";
import { EXPLORER } from "../config";
import { formatEth, shortAddress } from "../lib/format";
import { toFullName } from "../lib/names";
import {
  createWallet,
  forgetWallet,
  sendBatch,
  storedWallet,
  type NestWallet,
} from "../lib/wallet";

/**
 * The nest wallet (beta): a passkey-owned smart account. Create with
 * Face ID, receive at the address immediately, send with Face ID — gas
 * sponsored by the relayer. Beta rule: pocket money only.
 */
export function NestWalletSheet({ onClose }: { onClose: () => void }) {
  const publicClient = usePublicClient();
  const [wallet, setWallet] = useState<NestWallet | null>(() => storedWallet());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const { data: balance, refetch } = useQuery({
    queryKey: ["nest-wallet-balance", wallet?.address],
    enabled: Boolean(wallet && publicClient),
    refetchInterval: 15_000,
    queryFn: () => publicClient!.getBalance({ address: wallet!.address }),
  });

  const qr = useMemo(
    () => (wallet ? renderSVG(wallet.address, { ecc: "M", border: 2 }) : null),
    [wallet],
  );

  const directAddress = isAddress(to.trim()) ? (to.trim() as Address) : null;
  const full = directAddress ? null : toFullName(to);
  const { data: resolvedName } = useEnsAddress({
    name: full ?? undefined,
    query: { enabled: Boolean(full) },
  });
  const recipient =
    directAddress ??
    (resolvedName && resolvedName !== "0x0000000000000000000000000000000000000000"
      ? (resolvedName as Address)
      : null);

  const units = useMemo(() => {
    try {
      const u = parseEther(amount.trim() || "0");
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  }, [amount]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      setWallet(await createWallet());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!wallet || !recipient || !units) return;
    setBusy(true);
    setError("");
    setSent(null);
    try {
      const res = await sendBatch(wallet, [
        { target: recipient, value: units, data: "0x" },
      ]);
      setSent(res.txHash);
      setAmount("");
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet scroll" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 8 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            nest wallet
          </h3>
          <span className="tag">beta</span>
        </div>

        {!wallet ? (
          <>
            <p className="small muted" style={{ margin: "12px 0 0" }}>
              a wallet with no seed phrase: the key is a passkey in your
              phone's secure chip, unlocked by Face ID / fingerprint, synced
              by iCloud or Google. transactions are free — nest pays the gas.
            </p>
            <p className="small muted" style={{ margin: "8px 0 0" }}>
              beta rule: pocket money only while it earns trust.
            </p>
            <button
              className="btn block"
              style={{ marginTop: 16 }}
              disabled={busy}
              onClick={create}
            >
              {busy ? <span className="progress-ring" /> : null}
              create with Face ID / fingerprint
            </button>
          </>
        ) : (
          <>
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="mono small">{shortAddress(wallet.address)}</span>
              <button
                className="chip"
                onClick={() =>
                  navigator.clipboard?.writeText(wallet.address).catch(() => {})
                }
              >
                copy
              </button>
            </div>
            <p className="mono" style={{ margin: "10px 0 0", fontSize: 22 }}>
              {balance === undefined ? "…" : formatEth(balance)}
            </p>
            {qr && (
              <div className="qr-tile" dangerouslySetInnerHTML={{ __html: qr }} />
            )}
            <p className="small muted" style={{ textAlign: "center", margin: "8px 0 0" }}>
              receive at this address — it works even before your first send.
            </p>

            <div className="field" style={{ margin: "16px 0 0" }}>
              <label>send to (name or address)</label>
              <input
                className="input mono"
                placeholder="dallas — or 0x…"
                value={to}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setTo(e.target.value);
                  setSent(null);
                }}
              />
              {full && (
                <p className="small muted mono" style={{ margin: "6px 0 0" }}>
                  {recipient ? `resolves ✓ ${shortAddress(recipient)}` : "…"}
                </p>
              )}
            </div>
            <div className="field">
              <label>amount (ETH)</label>
              <input
                className="input mono"
                inputMode="decimal"
                placeholder="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <button
              className="btn block"
              disabled={busy || !recipient || !units}
              onClick={send}
            >
              {busy ? <span className="progress-ring" /> : null}
              send — Face ID confirms
            </button>
            {sent && (
              <p className="small mono" style={{ marginTop: 10 }}>
                sent ✓{" "}
                <a href={`${EXPLORER}/tx/${sent}`} target="_blank" rel="noreferrer">
                  view tx ↗
                </a>
              </p>
            )}
            <button
              className="chip"
              style={{ marginTop: 16 }}
              onClick={() => {
                if (
                  window.confirm(
                    "forget this wallet on this device? the passkey stays in your keychain; funds stay at the address.",
                  )
                ) {
                  forgetWallet();
                  setWallet(null);
                }
              }}
            >
              forget on this device
            </button>
          </>
        )}

        {error && (
          <p className="notice danger" style={{ marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
