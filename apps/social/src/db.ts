import pg from "pg";

/**
 * One Postgres pool against the same database the indexer writes. Social
 * lives in its own `social` schema; identity/gold reads go straight to the
 * indexer's `robin_mainnet` tables (same box, same db) — the chain remains
 * the source of truth for who may speak.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function migrate(): Promise<void> {
  await pool.query(`
    create schema if not exists social;

    create table if not exists social.chirp (
      id uuid primary key,
      name text not null,
      address text not null,
      body text not null,
      image_url text,
      reply_to uuid references social.chirp(id),
      created_at bigint not null,
      hidden boolean not null default false
    );
    create index if not exists chirp_time_idx on social.chirp (created_at desc);
    create index if not exists chirp_name_idx on social.chirp (name);
    create index if not exists chirp_reply_idx on social.chirp (reply_to);

    create table if not exists social.likes (
      chirp_id uuid not null references social.chirp(id),
      name text not null,
      created_at bigint not null,
      primary key (chirp_id, name)
    );

    create table if not exists social.follow (
      follower text not null,
      followed text not null,
      created_at bigint not null,
      primary key (follower, followed)
    );
    create index if not exists follow_followed_idx on social.follow (followed);

    create table if not exists social.notification (
      id uuid primary key,
      name text not null,
      kind text not null,
      actor text not null,
      chirp_id uuid,
      created_at bigint not null,
      read boolean not null default false
    );
    create index if not exists notif_name_idx on social.notification (name, created_at desc);

    create table if not exists social.report (
      chirp_id uuid not null references social.chirp(id),
      name text not null,
      created_at bigint not null,
      primary key (chirp_id, name)
    );

    create table if not exists social.muted (
      name text primary key,
      created_at bigint not null
    );
  `);
}

/** The primary .robin label bound to an address, or null. */
export async function primaryLabel(address: string): Promise<string | null> {
  const rows = await q<{ name: string }>(
    `select name from robin_mainnet.primary_name where address = $1 limit 1`,
    [address.toLowerCase()],
  );
  const full = rows[0]?.name;
  return full ? full.replace(/\.robin$/, "") : null;
}

/** Whether a label currently wears the gold band. */
export async function isGold(label: string): Promise<boolean> {
  const rows = await q<{ until: string }>(
    `select until from robin_mainnet.gold_band where label = $1 limit 1`,
    [label],
  );
  return rows[0] !== undefined && Number(rows[0].until) > Date.now() / 1000;
}

/** Set of currently-gold labels among the given ones. */
export async function goldSet(labels: string[]): Promise<Set<string>> {
  if (labels.length === 0) return new Set();
  const rows = await q<{ label: string; until: string }>(
    `select label, until from robin_mainnet.gold_band where label = any($1)`,
    [labels],
  );
  const now = Date.now() / 1000;
  return new Set(rows.filter((r) => Number(r.until) > now).map((r) => r.label));
}
