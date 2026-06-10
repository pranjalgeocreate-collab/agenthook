// Storage layer. LOCAL = node:sqlite (built-in) + in-memory TTL maps.
// Production target per docs/DESIGN.md is Postgres + Redis; this module is the
// only thing that changes to swap backends. Keep query helpers here.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/agent-social.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  handle        TEXT NOT NULL,
  handle_lc     TEXT NOT NULL UNIQUE,         -- lower(handle) for case-insensitive unique
  display_name  TEXT,
  bio           TEXT,
  manifest      TEXT NOT NULL,                -- json
  callback_url  TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  reputation    REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_id        TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  secret_hash   TEXT NOT NULL,                -- scrypt(secret):salt
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  parent_id     TEXT REFERENCES posts(id),
  repost_of     TEXT REFERENCES posts(id),
  metadata      TEXT,                         -- json
  like_count    INTEGER NOT NULL DEFAULT 0,
  repost_count  INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  deleted       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  followee_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS likes (
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (agent_id, post_id)
);

-- Chat (§8b)
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'dm',
  created_by    TEXT NOT NULL REFERENCES agents(id),
  metadata      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  joined_at       INTEGER NOT NULL,
  last_read_id    TEXT,
  PRIMARY KEY (conversation_id, agent_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES agents(id),
  body            TEXT,
  payload         TEXT,                       -- json (structured agent content)
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

-- Marketplace (§8c) — payment stubbed via NoopAdapter
CREATE TABLE IF NOT EXISTS listings (
  id            TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  spec          TEXT NOT NULL,                -- json
  price         INTEGER NOT NULL DEFAULT 0,
  pricing_kind  TEXT NOT NULL DEFAULT 'fixed',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  listing_id      TEXT NOT NULL REFERENCES listings(id),
  buyer_id        TEXT NOT NULL REFERENCES agents(id),
  seller_id       TEXT NOT NULL REFERENCES agents(id),
  amount          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'created',
  input           TEXT,
  result          TEXT,
  conversation_id TEXT REFERENCES conversations(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  order_id      TEXT PRIMARY KEY REFERENCES orders(id),
  reviewer_id   TEXT NOT NULL REFERENCES agents(id),
  rating        INTEGER NOT NULL,
  body          TEXT,
  created_at    INTEGER NOT NULL
);

-- Value transfer (§8c). Real money OFF in v1 (NoopAdapter); tables + state machine live.
CREATE TABLE IF NOT EXISTS wallets (
  agent_id      TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  balance       INTEGER NOT NULL DEFAULT 0   -- platform credits, smallest unit
);
CREATE TABLE IF NOT EXISTS ledger (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  delta         INTEGER NOT NULL,            -- signed
  reason        TEXT NOT NULL,               -- topup|escrow_hold|escrow_release|refund|fee|payout
  ref_order_id  TEXT REFERENCES orders(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_agent ON ledger(agent_id, created_at DESC);

-- Communities ("submolts"): topic spaces agents create, join, and post into.
CREATE TABLE IF NOT EXISTS communities (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  slug_lc       TEXT NOT NULL UNIQUE,            -- lower(slug), case-insensitive unique
  name          TEXT NOT NULL,
  description   TEXT,
  created_by    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_members (
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (community_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_cmembers_agent ON community_members(agent_id);

-- Human observers: people must register (email + country) to view the read-only site.
CREATE TABLE IF NOT EXISTS observers (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  email_lc    TEXT NOT NULL UNIQUE,
  country     TEXT NOT NULL,
  token       TEXT NOT NULL,                  -- cookie value granting view access
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observers_token ON observers(token);

-- Bot verification: owner details + $1/month subscription → verified badge.
CREATE TABLE IF NOT EXISTS verifications (
  agent_id    TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL,                   -- private (owner contact), not shown publicly
  country     TEXT NOT NULL,
  repository  TEXT,                            -- e.g. github.com/owner/bot
  about       TEXT,                            -- what the bot does
  plan        TEXT NOT NULL DEFAULT 'verified_monthly',
  price_cents INTEGER NOT NULL DEFAULT 100,    -- $1.00 / month
  status      TEXT NOT NULL DEFAULT 'active',  -- active | canceled
  verified_at INTEGER NOT NULL,
  renews_at   INTEGER NOT NULL
);
`);

// Idempotent migrations.
{
  const pcols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (!pcols.includes('community_id')) {
    db.exec('ALTER TABLE posts ADD COLUMN community_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id, created_at DESC)');
  }
  const acols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
  if (!acols.includes('verified')) {
    db.exec('ALTER TABLE agents ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
  }
  // Moltbook-style claim/ownership: agent self-registers, human owner claims via the link.
  if (!acols.includes('claim_code')) {
    db.exec('ALTER TABLE agents ADD COLUMN claim_code TEXT');     // token in the claim link
    db.exec('ALTER TABLE agents ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE agents ADD COLUMN owner_handle TEXT');   // owner's X/social handle
    db.exec('CREATE INDEX IF NOT EXISTS idx_agents_claim ON agents(claim_code)');
  }
}

export const now = () => Date.now();
export const id = () => randomUUID();

// ---- In-memory TTL store (LOCAL stand-in for Redis: challenges, nonces, rate limits) ----
const mem = new Map(); // key -> { value, expires }
export function memSet(key, value, ttlMs) {
  mem.set(key, { value, expires: Date.now() + ttlMs });
}
export function memGet(key) {
  const e = mem.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) { mem.delete(key); return undefined; }
  return e.value;
}
export function memDel(key) { mem.delete(key); }
setInterval(() => {
  const t = Date.now();
  for (const [k, e] of mem) if (t > e.expires) mem.delete(k);
}, 30_000).unref();

// Simple fixed-window rate limiter (LOCAL stand-in for Redis token bucket).
export function rateLimit(key, max, windowMs) {
  const k = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const cur = (memGet(k) || 0) + 1;
  memSet(k, cur, windowMs);
  return cur <= max;
}
