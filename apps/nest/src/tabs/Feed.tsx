import { useEffect, useRef, useState } from "react";
import { namehash } from "viem/ens";
import { useActive } from "../lib/activeAccount";
import { useSessionSigner } from "../lib/signer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EXPLORER, INDEXER_URL } from "../config";
import { formatEth, formatUSDG } from "../lib/format";
import {
  ensureSession,
  social,
  storedSession,
  uploadImage,
  type Chirp,
  type Notification,
} from "../lib/social";
import { PixelBird } from "../components/PixelBird";
import { ProfileSheet } from "../components/ProfileSheet";
import { ChirpRow, timeAgo } from "../components/ChirpRow";

type FeedItem = {
  key: string;
  kind: "registration" | "renewal" | "subname" | "gold";
  label: string;
  owner: string;
  cost: string | null;
  timestamp: number;
  txHash: string | null;
};

type ProtocolData = {
  items: FeedItem[];
  totalNames: number;
  feesUsd: number | null;
  todayCount: number;
  goldNodes: Set<string>;
};

async function fetchProtocol(): Promise<ProtocolData> {
  const [gqlRes, statsRes] = await Promise.all([
    fetch(`${INDEXER_URL}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query {
          registrationEvents(orderBy: "timestamp", orderDirection: "desc", limit: 50) {
            items { id label kind owner baseCost premium currency timestamp txHash }
          }
          subnames(orderBy: "createdAt", orderDirection: "desc", limit: 20) {
            items { id name owner createdAt }
          }
          stats(id: 1) { names ethRevenueWei usdgRevenue }
          goldBands(limit: 500) { items { node label until updatedAt } }
        }`,
      }),
    }),
    fetch(`${EXPLORER}/api/v2/stats`).catch(() => null),
  ]);
  const body = await gqlRes.json();
  const regs: FeedItem[] = body.data.registrationEvents.items.map((e: any) => {
    const paid = BigInt(e.baseCost) + BigInt(e.premium);
    return {
      key: e.id,
      kind: e.kind as "registration" | "renewal",
      label: e.label,
      owner: e.owner,
      cost: paid === 0n ? null : e.currency === "USDG" ? formatUSDG(paid) : formatEth(paid),
      timestamp: Number(e.timestamp),
      txHash: e.txHash,
    };
  });
  const subs: FeedItem[] = body.data.subnames.items.map((s: any) => ({
    key: s.id,
    kind: "subname" as const,
    label: s.name.replace(/\.robin$/, ""),
    owner: s.owner,
    cost: null,
    timestamp: Number(s.createdAt),
    txHash: null,
  }));
  const nowSec = Date.now() / 1000;
  const goldRows = (body.data.goldBands?.items ?? []) as {
    node: string;
    label: string | null;
    until: string;
    updatedAt: string;
  }[];
  const goldNodes = new Set<string>(
    goldRows.filter((g) => Number(g.until) > nowSec).map((g) => g.node.toLowerCase()),
  );
  const golds: FeedItem[] = goldRows
    .filter((g) => g.label)
    .map((g) => ({
      key: `gold-${g.node}`,
      kind: "gold" as const,
      label: g.label!,
      owner: "",
      cost: null,
      timestamp: Number(g.updatedAt),
      txHash: null,
    }));

  const stats = body.data.stats;
  let feesUsd: number | null = null;
  try {
    const price = statsRes?.ok ? Number((await statsRes.json()).coin_price) : NaN;
    const eth = Number(BigInt(stats.ethRevenueWei)) / 1e18;
    const usdg = Number(BigInt(stats.usdgRevenue)) / 1e6;
    feesUsd = usdg + (Number.isFinite(price) ? eth * price : 0);
  } catch {
    feesUsd = null;
  }
  const dayAgo = nowSec - 86400;
  return {
    items: [...regs, ...subs, ...golds]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 60),
    totalNames: Number(stats.names),
    feesUsd,
    todayCount: regs.filter((r) => r.kind === "registration" && r.timestamp > dayAgo).length,
    goldNodes,
  };
}

const VERB: Record<FeedItem["kind"], string> = {
  registration: "banded",
  renewal: "renewed",
  subname: "minted",
  gold: "went gold",
};

function NameInline({ label }: { label: string }) {
  return (
    <span className="feed-name">
      {label}
      <span className="tld">.robin</span>
    </span>
  );
}

function EventRow({
  item,
  gold,
  onOpen,
}: {
  item: FeedItem;
  gold: boolean;
  onOpen: (label: string) => void;
}) {
  return (
    <div className="feed-row" role="button" onClick={() => onOpen(item.label)}>
      <PixelBird name={item.label} gold={gold || item.kind === "gold"} />
      <span className="feed-text">
        <NameInline label={item.label} />{" "}
        {item.kind === "gold" ? (
          <span style={{ color: "#e8c24a" }}>went gold ✦</span>
        ) : (
          VERB[item.kind]
        )}
        {item.cost ? ` — ${item.cost}` : ""}
      </span>
      <span className="feed-time">{timeAgo(item.timestamp)}</span>
    </div>
  );
}

const NOTIF_TEXT: Record<Notification["kind"], string> = {
  follow: "followed you",
  mention: "mentioned you",
  reply: "replied to you",
  like: "liked your chirp",
};

export function FeedTab({ onPay }: { onPay: (name: string) => void }) {
  const active = useActive();
  const address = active.address;
  const isConnected = active.kind !== "none";
  const signer = useSessionSigner();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"all" | "following" | "mine">("all");
  const [profile, setProfile] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [session, setSession] = useState(() => storedSession(address));
  const [text, setText] = useState("");
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSession(storedSession(address));
  }, [address]);
  const token = session?.token;

  const { data: proto } = useQuery({
    queryKey: ["feed"],
    queryFn: fetchProtocol,
    refetchInterval: 30_000,
  });
  const { data: chirpData, refetch: refetchChirps } = useQuery({
    queryKey: ["chirps", scope === "following" ? "following" : "all", token ?? ""],
    queryFn: () => social.feed(scope === "following" ? "following" : "all", token),
    refetchInterval: 20_000,
  });
  const { data: inbox, refetch: refetchInbox } = useQuery({
    queryKey: ["inbox", token ?? ""],
    enabled: Boolean(token),
    queryFn: () => social.inbox(token!),
    refetchInterval: 60_000,
  });
  const unread = (inbox?.notifications ?? []).filter((n) => !n.read).length;

  async function signIn() {
    if (!signer) throw new Error("connect a wallet first");
    const s = await ensureSession(signer);
    setSession(s);
    return s;
  }

  async function post() {
    setError("");
    setPosting(true);
    try {
      const s = session ?? (await signIn());
      let imageUrl: string | undefined;
      if (imgFile) imageUrl = await uploadImage(s.token, imgFile);
      await social.post(s.token, { text: text.trim(), imageUrl });
      setText("");
      setImgFile(null);
      refetchChirps();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  async function authed<T>(fn: (tok: string) => Promise<T>): Promise<T | null> {
    try {
      const s = session ?? (await signIn());
      return await fn(s.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  function bumpLike(c: Chirp) {
    queryClient.setQueriesData<{ chirps: Chirp[] }>({ queryKey: ["chirps"] }, (old) =>
      old
        ? {
            chirps: old.chirps.map((x) =>
              x.id === c.id
                ? { ...x, liked: !c.liked, likes: c.likes + (c.liked ? -1 : 1) }
                : x,
            ),
          }
        : old,
    );
    void authed((tok) => social.like(tok, c.id, !c.liked));
  }

  const myLabel = session?.name?.replace(/\.robin$/, "") ?? null;

  const chirps = (chirpData?.chirps ?? []).filter(
    (c) => scope !== "mine" || c.name === myLabel,
  );
  const events =
    scope === "following"
      ? []
      : (proto?.items ?? []).filter(
          (i) =>
            scope !== "mine" ||
            (address && i.owner.toLowerCase() === address.toLowerCase()),
        );
  const stream: ({ t: "e"; e: FeedItem } | { t: "c"; c: Chirp })[] = [
    ...events.map((e) => ({ t: "e" as const, e })),
    ...chirps.map((c) => ({ t: "c" as const, c })),
  ].sort((a, b) => (b.t === "e" ? b.e.timestamp : b.c.createdAt) - (a.t === "e" ? a.e.timestamp : a.c.createdAt));

  return (
    <>
      <div className="row between" style={{ margin: "18px 0 12px" }}>
        <div className="h1" style={{ margin: 0 }}>
          The feed.
        </div>
        <div className="row" style={{ gap: 8 }}>
          {isConnected && (
            <button
              className="bell"
              onClick={async () => {
                const ok = await authed(async () => true);
                if (ok) setInboxOpen(true);
              }}
            >
              ◉{unread > 0 && <span className="bell-dot">{Math.min(unread, 9)}</span>}
            </button>
          )}
          <div className="chips">
            <button className={`chip${scope === "all" ? " on" : ""}`} onClick={() => setScope("all")}>
              all
            </button>
            <button
              className={`chip${scope === "following" ? " on" : ""}`}
              onClick={() => setScope("following")}
            >
              following
            </button>
            {isConnected && (
              <button
                className={`chip${scope === "mine" ? " on" : ""}`}
                onClick={() => setScope("mine")}
              >
                mine
              </button>
            )}
          </div>
        </div>
      </div>

      {isConnected && (
        <div className="compose">
          <textarea
            className="compose-input"
            placeholder={session?.name ? `chirp as ${session.name}…` : "chirp something…"}
            value={text}
            rows={2}
            maxLength={session?.gold ? 1000 : 280}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row between">
            <span className="row" style={{ gap: 8 }}>
              {session?.gold && (
                <>
                  <button className="chip" onClick={() => fileRef.current?.click()}>
                    {imgFile ? "📷 ✓" : "📷"}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => setImgFile(e.target.files?.[0] ?? null)}
                  />
                </>
              )}
              <span className="small muted mono">
                {text.length > 0 && `${text.length}/${session?.gold ? 1000 : 280}`}
              </span>
            </span>
            <button
              className="btn small"
              disabled={posting || (!text.trim() && !imgFile)}
              onClick={post}
            >
              {posting ? <span className="progress-ring" /> : null} chirp
            </button>
          </div>
          {error && (
            <p className="notice danger" style={{ margin: "8px 0 0" }}>
              {error}
            </p>
          )}
        </div>
      )}

      {proto && scope === "all" && (
        <div className="pinned">
          <div className="pinned-tag">pinned</div>
          <div className="pinned-title">the flock is growing.</div>
          <div className="pinned-stats">
            {proto.totalNames} names
            {proto.feesUsd != null && ` · $${Math.round(proto.feesUsd).toLocaleString("en-US")} fees`}
            {proto.todayCount > 0 && ` · ${proto.todayCount} today`}
          </div>
        </div>
      )}

      {stream.length === 0 && (
        <div className="empty">
          {scope === "following" ? "follow some birds — their chirps land here." : "quiet out there."}
        </div>
      )}
      {stream.map((s) =>
        s.t === "e" ? (
          <EventRow
            key={s.e.key}
            item={s.e}
            gold={Boolean(proto?.goldNodes.has(namehash(`${s.e.label}.robin`).toLowerCase()))}
            onOpen={setProfile}
          />
        ) : (
          <ChirpRow
            key={s.c.id}
            chirp={s.c}
            mine={s.c.name === myLabel}
            onOpenProfile={setProfile}
            onOpenThread={setThread}
            onLike={bumpLike}
            onDelete={(id) =>
              void authed(async (tok) => {
                await social.remove(tok, id);
                refetchChirps();
              })
            }
            onReport={(id) =>
              window.confirm("report this chirp?") &&
              void authed((tok) => social.report(tok, id))
            }
          />
        ),
      )}

      {profile && (
        <ProfileSheet label={profile} onClose={() => setProfile(null)} onPay={onPay} />
      )}
      {thread && (
        <ThreadSheet
          id={thread}
          session={session}
          signIn={signIn}
          onClose={() => setThread(null)}
          onOpenProfile={(l) => {
            setThread(null);
            setProfile(l);
          }}
        />
      )}
      {inboxOpen && (
        <div className="sheet-back" onClick={() => setInboxOpen(false)}>
          <div className="sheet scroll" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-title">Inbox.</h3>
            {(inbox?.notifications ?? []).length === 0 && (
              <p className="small muted">nothing yet — chirp and they will come.</p>
            )}
            {(inbox?.notifications ?? []).map((n) => (
              <div
                className="feed-row"
                role="button"
                key={n.id}
                style={{ opacity: n.read ? 0.55 : 1 }}
                onClick={() => {
                  setInboxOpen(false);
                  if (n.chirp_id) setThread(n.chirp_id);
                  else setProfile(n.actor);
                }}
              >
                <PixelBird name={n.actor} size={30} />
                <span className="feed-text">
                  <NameInline label={n.actor} /> {NOTIF_TEXT[n.kind]}
                </span>
                <span className="feed-time">{timeAgo(Number(n.created_at))}</span>
              </div>
            ))}
            {unread > 0 && (
              <button
                className="btn small secondary"
                style={{ marginTop: 12 }}
                onClick={() =>
                  void authed(async (tok) => {
                    await social.inboxRead(tok);
                    refetchInbox();
                  })
                }
              >
                mark all read
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ThreadSheet({
  id,
  session,
  signIn,
  onClose,
  onOpenProfile,
}: {
  id: string;
  session: ReturnType<typeof storedSession>;
  signIn: () => Promise<NonNullable<ReturnType<typeof storedSession>>>;
  onClose: () => void;
  onOpenProfile: (label: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["thread", id, session?.token ?? ""],
    queryFn: () => social.thread(id, session?.token),
  });
  const myLabel = session?.name?.replace(/\.robin$/, "") ?? null;

  async function act<T>(fn: (tok: string) => Promise<T>) {
    setError("");
    try {
      const s = session ?? (await signIn());
      await fn(s.token);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const like = (c: { id: string; liked: boolean }) =>
    void act((tok) => social.like(tok, c.id, !c.liked));

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet scroll" onClick={(e) => e.stopPropagation()}>
        {data?.chirp && (
          <ChirpRow
            chirp={data.chirp}
            mine={data.chirp.name === myLabel}
            onOpenProfile={onOpenProfile}
            onLike={like}
          />
        )}
        {(data?.replies ?? []).map((r) => (
          <ChirpRow
            key={r.id}
            chirp={r}
            mine={r.name === myLabel}
            onOpenProfile={onOpenProfile}
            onLike={like}
          />
        ))}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <input
            className="input"
            placeholder="reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <button
            className="btn small"
            disabled={busy || !reply.trim()}
            onClick={async () => {
              setBusy(true);
              await act((tok) => social.post(tok, { text: reply.trim(), replyTo: id }));
              setReply("");
              setBusy(false);
            }}
          >
            reply
          </button>
        </div>
        {error && (
          <p className="notice danger" style={{ marginTop: 10, marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
