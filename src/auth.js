// HMAC request signing (AWS-SigV4-style). Stateless, scriptable, no human flow.
// canonical = METHOD \n PATH \n TS \n NONCE \n sha256(body)
//
// Note: an HMAC API secret is a SHARED secret — the server must keep it
// recoverable to recompute the signature (unlike a login password). LOCAL build
// stores it as-is; PRODUCTION must encrypt-at-rest (KMS/SealedBox). See DESIGN §6.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, memGet, memSet } from './store.js';

const SKEW_MS = 60_000; // reject requests outside this window (also the replay window)

export function sha256hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

export function canonicalString(method, path, ts, nonce, bodyStr) {
  return [String(method).toUpperCase(), path, String(ts), nonce, sha256hex(bodyStr || '')].join('\n');
}

export function sign(secret, method, path, ts, nonce, bodyStr) {
  return createHmac('sha256', secret)
    .update(canonicalString(method, path, ts, nonce, bodyStr))
    .digest('hex');
}

export function newKeypair() {
  return {
    key_id: 'ak_' + randomBytes(9).toString('hex'),
    secret: 'sk_' + randomBytes(24).toString('hex'),
  };
}

function safeEq(a, b) {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Fastify preHandler: verifies signature, attaches req.agent. 401/403 on failure.
export function authPreHandler(req, reply) {
  const keyId = req.headers['x-agent-key'];
  const ts = req.headers['x-agent-ts'];
  const nonce = req.headers['x-agent-nonce'];
  const sig = req.headers['x-agent-sign'];
  if (!keyId || !ts || !nonce || !sig) {
    return reply.code(401).send({ error: 'missing_auth_headers' });
  }
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() - Number(ts)) > SKEW_MS) {
    return reply.code(401).send({ error: 'timestamp_skew' });
  }
  const nk = `nonce:${keyId}:${nonce}`;
  if (memGet(nk)) return reply.code(401).send({ error: 'replayed_nonce' });

  const key = db.prepare('SELECT * FROM api_keys WHERE key_id = ? AND revoked_at IS NULL').get(keyId);
  if (!key) return reply.code(401).send({ error: 'unknown_key' });

  const agent = db.prepare("SELECT * FROM agents WHERE id = ? AND status = 'active'").get(key.agent_id);
  if (!agent) return reply.code(403).send({ error: 'agent_disabled' });

  // req.url is the full request target (path + query) — client signs the same string.
  // LOCAL: secret_hash column holds the raw shared secret (see header note); HMAC needs it recoverable.
  const expect = sign(key.secret_hash, req.method, req.url, ts, nonce, req.rawBody || '');
  if (!safeEq(expect, sig)) return reply.code(401).send({ error: 'bad_signature' });

  memSet(nk, 1, SKEW_MS); // burn the nonce
  req.agent = agent;
  req.apiKey = key;
}
