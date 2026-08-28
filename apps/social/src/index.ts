import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import sharp from "sharp";
import { bearerAddress, issueToken } from "./auth.js";
import { goldSet, isGold, migrate, pool, primaryLabel, q } from "./db.js";

/**
 * nest-social — the gasless social layer for .robin names.
 *
 * Every write is tied to a wallet session; the wallet must hold a primary
 * .robin name (that name IS the account). Gold names get longer chirps and
 * image posts. All data here is off-chain and deletable by its author;
 * the feed interleaves it with on-chain protocol events client-side.
 */
const PORT = Number(process.env.PORT ?? 42071);
const MEDIA_DIR = process.env.MEDIA_DIR ?? "/var/www/nest-media";
const MEDIA_BASE = process.env.MEDIA_BASE ?? "https://dotrobin.xyz/media";
const MAX_TEXT = 280;
const MAX_TEXT_GOLD = 1000;
const MAX_UPLOAD = 2_500_000;
const HIDE_AFTER_REPORTS = 3;

const app = new Hono();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));

const now = () => Math.floor(Date.now() / 1000);

type Identity = { address: string; label: string; gold: boolean };

/** Session address → posting identity (primary name required, not muted). */
async function identify(c: { req: { header: (n: string) => string | undefined } }): Promise<
  | { ok: true; id: Identity }
  | { ok: false; status: 401 | 403; error: string }
> {
  const address = bearerAddress(c as never);
  if (!address) return { ok: false, status: 401, error: "sign in first" };
  const label = await primaryLabel(address);
  if (!label)
    return {
      ok: false,
      status: 403,
      error: "set a primary .robin name to post — your name is your account",
    };
  const muted = await q(`select 1 from social.muted where name = $1`, [label]);
  if (muted.length > 0) return { ok: false, status: 403, error: "this name is muted" };
  return { ok: true, id: { address, label, gold: await isGold(label) } };
}

app.get("/health", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

app.post("/session", async (c) => {
  const body = await c.req.json<{ address?: string; issuedAt?: number; signature?: `0x${string}` }>().catch(() => null);
  if (!body?.address || !body.issuedAt || !body.signature) {
    return c.json({ error: "address, issuedAt, signature required" }, 400);
  }
  const token = await issueToken(body.address, body.issuedAt, body.signature);
  if (!token) return c.json({ error: "bad signature" }, 401);
  const label = await primaryLabel(body.address);
  return c.json({ token, name: label, gold: label ? await isGold(label) : false });
});

// ---------------------------------------------------------------------------
// chirps
// ---------------------------------------------------------------------------

const MENTION_RE = /@([a-z0-9][a-z0-9.-]*)\.robin/g;

app.post("/chirp", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  const { label, address, gold } = who.id;

  const body = await c.req.json<{ text?: string; imageUrl?: string; replyTo?: string }>().catch(() => null);
  const text = body?.text?.trim() ?? "";
  const limit = gold ? MAX_TEXT_GOLD : MAX_TEXT;
  if (!text && !body?.imageUrl) return c.json({ error: "say something" }, 400);
  if (text.length > limit) {
    return c.json({ error: gold ? `max ${limit} characters` : `max ${limit} characters — gold gets ${MAX_TEXT_GOLD}` }, 400);
  }
  if (body?.imageUrl) {
    if (!gold) return c.json({ error: "images are a gold feature — go gold to post pics" }, 403);
    if (!body.imageUrl.startsWith(`${MEDIA_BASE}/`)) return c.json({ error: "bad image url" }, 400);
  }
  if (body?.replyTo) {
    const parent = await q(`select 1 from social.chirp where id = $1 and not hidden`, [body.replyTo]);
    if (parent.length === 0) return c.json({ error: "reply target gone" }, 400);
  }

  // Rate limits: one per 10s, 30 per hour.
  const t = now();
  const recent = await q<{ n: string; last: string }>(
    `select count(*) as n, coalesce(max(created_at), 0) as last
       from social.chirp where name = $1 and created_at > $2`,
    [label, t - 3600],
  );
  if (Number(recent[0]!.last) > t - 10) return c.json({ error: "slow down" }, 429);
  if (Number(recent[0]!.n) >= 30) return c.json({ error: "that's a lot of chirping — try later" }, 429);

  const id = randomUUID();
  await q(
    `insert into social.chirp (id, name, address, body, image_url, reply_to, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, label, address, text, body?.imageUrl ?? null, body?.replyTo ?? null, t],
  );

  // Notifications: reply-to author + up to 5 distinct mentions (never self).
  const notified = new Set<string>([label]);
  if (body?.replyTo) {
    const parent = await q<{ name: string }>(`select name from social.chirp where id = $1`, [body.replyTo]);
    const target = parent[0]?.name;
    if (target && !notified.has(target)) {
      notified.add(target);
      await q(
        `insert into social.notification (id, name, kind, actor, chirp_id, created_at) values ($1,$2,'reply',$3,$4,$5)`,
        [randomUUID(), target, label, id, t],
      );
    }
  }
  for (const m of text.matchAll(MENTION_RE)) {
    const target = m[1]!;
    if (notified.has(target) || notified.size > 6) continue;
    notified.add(target);
    await q(
      `insert into social.notification (id, name, kind, actor, chirp_id, created_at) values ($1,$2,'mention',$3,$4,$5)`,
      [randomUUID(), target, label, id, t],
    );
  }

  return c.json({ id, name: label, gold, text, imageUrl: body?.imageUrl ?? null, replyTo: body?.replyTo ?? null, createdAt: t });
});

app.delete("/chirp/:id", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  const res = await pool.query(
    `update social.chirp set hidden = true where id = $1 and name = $2`,
    [c.req.param("id"), who.id.label],
  );
  if (res.rowCount === 0) return c.json({ error: "not yours or not found" }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

type ChirpRow = {
  id: string;
  name: string;
  body: string;
  image_url: string | null;
  reply_to: string | null;
  created_at: string;
  likes: string;
  replies: string;
};

async function decorate(rows: ChirpRow[], viewer: string | null) {
  const golds = await goldSet([...new Set(rows.map((r) => r.name))]);
  let likedSet = new Set<string>();
  if (viewer && rows.length > 0) {
    const liked = await q<{ chirp_id: string }>(
      `select chirp_id from social.likes where name = $1 and chirp_id = any($2)`,
      [viewer, rows.map((r) => r.id)],
    );
    likedSet = new Set(liked.map((l) => l.chirp_id));
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    gold: golds.has(r.name),
    text: r.body,
    imageUrl: r.image_url,
    replyTo: r.reply_to,
    createdAt: Number(r.created_at),
    likes: Number(r.likes),
    replies: Number(r.replies),
    liked: likedSet.has(r.id),
  }));
}

const CHIRP_SELECT = `
  select c.id, c.name, c.body, c.image_url, c.reply_to, c.created_at,
    (select count(*) from social.likes l where l.chirp_id = c.id) as likes,
    (select count(*) from social.chirp r where r.reply_to = c.id and not r.hidden) as replies
  from social.chirp c
  where not c.hidden and c.name not in (select name from social.muted)`;

async function viewerLabel(c: { req: { header: (n: string) => string | undefined } }): Promise<string | null> {
  const address = bearerAddress(c as never);
  return address ? primaryLabel(address) : null;
}

app.get("/feed", async (c) => {
  const before = Number(c.req.query("before") ?? now() + 1);
  const scope = c.req.query("scope"); // "following" | undefined
  const viewer = await viewerLabel(c);
  let rows: ChirpRow[];
  if (scope === "following" && viewer) {
    rows = await q<ChirpRow>(
      `${CHIRP_SELECT} and c.reply_to is null and c.created_at < $2
         and c.name in (select followed from social.follow where follower = $1)
       order by c.created_at desc limit 50`,
      [viewer, before],
    );
  } else {
    rows = await q<ChirpRow>(
      `${CHIRP_SELECT} and c.reply_to is null and c.created_at < $1
       order by c.created_at desc limit 50`,
      [before],
    );
  }
  return c.json({ chirps: await decorate(rows, viewer) });
});

app.get("/chirps/:name", async (c) => {
  const viewer = await viewerLabel(c);
  const rows = await q<ChirpRow>(
    `${CHIRP_SELECT} and c.name = $1 order by c.created_at desc limit 50`,
    [c.req.param("name")],
  );
  return c.json({ chirps: await decorate(rows, viewer) });
});

app.get("/mentions/:name", async (c) => {
  const viewer = await viewerLabel(c);
  const rows = await q<ChirpRow>(
    `${CHIRP_SELECT} and c.body ilike $1 order by c.created_at desc limit 50`,
    [`%@${c.req.param("name")}.robin%`],
  );
  return c.json({ chirps: await decorate(rows, viewer) });
});

app.get("/thread/:id", async (c) => {
  const viewer = await viewerLabel(c);
  const root = await q<ChirpRow>(`${CHIRP_SELECT} and c.id = $1`, [c.req.param("id")]);
  const replies = await q<ChirpRow>(
    `${CHIRP_SELECT} and c.reply_to = $1 order by c.created_at asc limit 100`,
    [c.req.param("id")],
  );
  return c.json({
    chirp: (await decorate(root, viewer))[0] ?? null,
    replies: await decorate(replies, viewer),
  });
});

// ---------------------------------------------------------------------------
// likes + follows
// ---------------------------------------------------------------------------

app.post("/chirp/:id/like", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  const id = c.req.param("id");
  const target = await q<{ name: string }>(
    `select name from social.chirp where id = $1 and not hidden`,
    [id],
  );
  if (target.length === 0) return c.json({ error: "not found" }, 404);
  const inserted = await pool.query(
    `insert into social.likes (chirp_id, name, created_at) values ($1,$2,$3)
     on conflict do nothing`,
    [id, who.id.label, now()],
  );
  if ((inserted.rowCount ?? 0) > 0 && target[0]!.name !== who.id.label) {
    await q(
      `insert into social.notification (id, name, kind, actor, chirp_id, created_at) values ($1,$2,'like',$3,$4,$5)`,
      [randomUUID(), target[0]!.name, who.id.label, id, now()],
    );
  }
  return c.json({ ok: true });
});

app.delete("/chirp/:id/like", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  await q(`delete from social.likes where chirp_id = $1 and name = $2`, [
    c.req.param("id"),
    who.id.label,
  ]);
  return c.json({ ok: true });
});

app.post("/follow/:name", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  const target = c.req.param("name").toLowerCase();
  if (target === who.id.label) return c.json({ error: "that's you" }, 400);
  const inserted = await pool.query(
    `insert into social.follow (follower, followed, created_at) values ($1,$2,$3)
     on conflict do nothing`,
    [who.id.label, target, now()],
  );
  if ((inserted.rowCount ?? 0) > 0) {
    await q(
      `insert into social.notification (id, name, kind, actor, chirp_id, created_at) values ($1,$2,'follow',$3,null,$4)`,
      [randomUUID(), target, who.id.label, now()],
    );
  }
  return c.json({ ok: true });
});

app.delete("/follow/:name", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  await q(`delete from social.follow where follower = $1 and followed = $2`, [
    who.id.label,
    c.req.param("name").toLowerCase(),
  ]);
  return c.json({ ok: true });
});

app.get("/follows/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const viewer = await viewerLabel(c);
  const [followers, following, mine] = await Promise.all([
    q<{ n: string }>(`select count(*) as n from social.follow where followed = $1`, [name]),
    q<{ n: string }>(`select count(*) as n from social.follow where follower = $1`, [name]),
    viewer
      ? q(`select 1 from social.follow where follower = $1 and followed = $2`, [viewer, name])
      : Promise.resolve([]),
  ]);
  return c.json({
    followers: Number(followers[0]!.n),
    following: Number(following[0]!.n),
    followedByMe: mine.length > 0,
  });
});

// ---------------------------------------------------------------------------
// inbox
// ---------------------------------------------------------------------------

app.get("/inbox", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  const rows = await q(
    `select id, kind, actor, chirp_id, created_at, read
       from social.notification where name = $1
     order by created_at desc limit 50`,
    [who.id.label],
  );
  return c.json({ notifications: rows });
});

app.post("/inbox/read", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  await q(`update social.notification set read = true where name = $1`, [who.id.label]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// reports + upload
// ---------------------------------------------------------------------------

app.post("/report/:id", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  const id = c.req.param("id");
  await pool.query(
    `insert into social.report (chirp_id, name, created_at) values ($1,$2,$3)
     on conflict do nothing`,
    [id, who.id.label, now()],
  );
  const n = await q<{ n: string }>(
    `select count(distinct name) as n from social.report where chirp_id = $1`,
    [id],
  );
  if (Number(n[0]!.n) >= HIDE_AFTER_REPORTS) {
    await q(`update social.chirp set hidden = true where id = $1`, [id]);
  }
  return c.json({ ok: true });
});

app.post("/upload", async (c) => {
  const who = await identify(c);
  if (!who.ok) return c.json({ error: who.error }, who.status);
  if (!who.id.gold) return c.json({ error: "images are a gold feature — go gold to post pics" }, 403);
  const body = await c.req.parseBody();
  const file = body["image"];
  if (!(file instanceof File)) return c.json({ error: "image field required" }, 400);
  if (file.size > MAX_UPLOAD) return c.json({ error: "max 2.5MB" }, 400);
  const input = Buffer.from(await file.arrayBuffer());
  let out: Buffer;
  try {
    // Re-encode everything: normalizes format, strips EXIF/location, caps size.
    out = await sharp(input, { limitInputPixels: 30_000_000 })
      .rotate()
      .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return c.json({ error: "not a readable image" }, 400);
  }
  const id = randomUUID();
  await writeFile(join(MEDIA_DIR, `${id}.webp`), out);
  return c.json({ url: `${MEDIA_BASE}/${id}.webp` });
});

// ---------------------------------------------------------------------------

await mkdir(MEDIA_DIR, { recursive: true }).catch(() => {});
await migrate();
serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
console.log(`nest-social listening on ${PORT}`);
