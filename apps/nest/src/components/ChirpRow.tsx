import type { Chirp } from "../lib/social";
import { PixelBird } from "./PixelBird";

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Chirp body with tappable @name.robin mentions and $TICKER cashtags. */
export function ChirpText({
  text,
  onOpenProfile,
}: {
  text: string;
  onOpenProfile: (label: string) => void;
}) {
  const parts = text.split(/(@[a-z0-9][a-z0-9.-]*\.robin|\$[A-Za-z][A-Za-z0-9]{0,10})/g);
  return (
    <span className="chirp-body">
      {parts.map((p, i) => {
        if (p.startsWith("@") && p.endsWith(".robin")) {
          const label = p.slice(1).replace(/\.robin$/, "");
          return (
            <button key={i} className="chirp-link" onClick={() => onOpenProfile(label)}>
              {p}
            </button>
          );
        }
        if (p.startsWith("$") && p.length > 1) {
          return (
            <a
              key={i}
              className="chirp-link"
              href="https://dotrobin.xyz/tickers"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {p}
            </a>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

export function ChirpRow({
  chirp,
  mine,
  onOpenProfile,
  onOpenThread,
  onLike,
  onDelete,
  onReport,
}: {
  chirp: Chirp;
  mine: boolean;
  onOpenProfile: (label: string) => void;
  onOpenThread?: (id: string) => void;
  onLike: (chirp: Chirp) => void;
  onDelete?: (id: string) => void;
  onReport?: (id: string) => void;
}) {
  return (
    <div className="chirp">
      <button
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        onClick={() => onOpenProfile(chirp.name)}
      >
        <PixelBird name={chirp.name} gold={chirp.gold} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="chirp-author" onClick={() => onOpenProfile(chirp.name)}>
            {chirp.name}
            <span className="tld">.robin</span>
          </button>
          {chirp.gold && <span style={{ color: "#e8c24a", fontSize: 12 }}>✦</span>}
          <span className="feed-time" style={{ marginLeft: "auto" }}>
            {timeAgo(chirp.createdAt)}
          </span>
        </div>
        {chirp.text && <ChirpText text={chirp.text} onOpenProfile={onOpenProfile} />}
        {chirp.imageUrl && (
          <img className="chirp-img" src={chirp.imageUrl} alt="" loading="lazy" />
        )}
        <div className="chirp-actions">
          <button
            className={`chirp-act${chirp.liked ? " on" : ""}`}
            onClick={() => onLike(chirp)}
          >
            {chirp.liked ? "♥" : "♡"} {chirp.likes > 0 ? chirp.likes : ""}
          </button>
          {onOpenThread && (
            <button className="chirp-act" onClick={() => onOpenThread(chirp.id)}>
              ↩ {chirp.replies > 0 ? chirp.replies : ""}
            </button>
          )}
          {mine && onDelete ? (
            <button className="chirp-act" onClick={() => onDelete(chirp.id)}>
              delete
            </button>
          ) : (
            onReport && (
              <button className="chirp-act" onClick={() => onReport(chirp.id)}>
                report
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
