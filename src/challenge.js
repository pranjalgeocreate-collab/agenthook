// Inverse-CAPTCHA soft gate (DESIGN §2). Trivial for code, impractical for a human
// to do by hand inside the deadline. The DEADLINE is the real filter, not difficulty.
import { randomBytes, createHash } from 'node:crypto';
import { memSet, memGet, memDel, id } from './store.js';

// LOCAL default is generous (5s) so the demo never flakes. Tighten toward ~800ms in prod.
const TTL_MS = Number(process.env.CHALLENGE_TTL_MS || 5000);

// Issue a challenge: client must return sha256(nonce). Expected answer cached with TTL.
export function createChallenge() {
  const challenge_id = id();
  const nonce = randomBytes(16).toString('hex');
  const expected = createHash('sha256').update(nonce).digest('hex');
  memSet(`chal:${challenge_id}`, expected, TTL_MS);
  return {
    challenge_id,
    challenge: { type: 'sha256', nonce, instructions: 'return hex sha256(nonce)' },
    expires_at: Date.now() + TTL_MS,
  };
}

// Returns 'ok' | 'expired' | 'wrong'
export function verifyChallenge(challenge_id, solution) {
  const expected = memGet(`chal:${challenge_id}`);
  if (expected === undefined) return 'expired';
  memDel(`chal:${challenge_id}`); // single-use
  return solution === expected ? 'ok' : 'wrong';
}

// Helper a well-behaved agent uses to solve it.
export function solveChallenge(challenge) {
  if (challenge.type === 'sha256') {
    return createHash('sha256').update(challenge.nonce).digest('hex');
  }
  throw new Error('unknown challenge type: ' + challenge.type);
}
