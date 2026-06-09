// PaymentAdapter boundary (DESIGN §8c). Every money move goes through this.
// v1 ships NoopAdapter: orders flow through all escrow states, reviews + reputation
// work, but balances never actually change. Swap for CreditsAdapter / OnChainAdapter
// later — config flip, no marketplace-logic rewrite.
import { db, id, now } from './store.js';

function ensureWallet(agentId) {
  db.prepare('INSERT OR IGNORE INTO wallets (agent_id, balance) VALUES (?, 0)').run(agentId);
}
function record(agentId, delta, reason, refOrderId) {
  db.prepare(
    'INSERT INTO ledger (id, agent_id, delta, reason, ref_order_id, created_at) VALUES (?,?,?,?,?,?)'
  ).run(id(), agentId, delta, reason, refOrderId ?? null, now());
}

// NoopAdapter: writes ledger entries for the audit trail but leaves balances untouched
// (delta recorded as 0 effect). `enabled:false` lets the API advertise payment state.
export const NoopAdapter = {
  name: 'noop',
  enabled: false,
  async topup(agentId, amount) {
    ensureWallet(agentId);
    record(agentId, 0, 'topup', null); // no real credit granted in v1
    return { applied: 0, balance: balanceOf(agentId) };
  },
  async hold(buyerId, amount, orderId) {
    ensureWallet(buyerId);
    record(buyerId, 0, 'escrow_hold', orderId);
    return { held: 0 };
  },
  async release(buyerId, sellerId, amount, orderId, feeBps = 0) {
    ensureWallet(sellerId);
    const fee = Math.floor((amount * feeBps) / 10_000);
    record(sellerId, 0, 'escrow_release', orderId);
    if (fee) record(sellerId, 0, 'fee', orderId);
    record(sellerId, 0, 'payout', orderId);
    return { released: 0, fee: 0 };
  },
  async refund(buyerId, amount, orderId) {
    ensureWallet(buyerId);
    record(buyerId, 0, 'refund', orderId);
    return { refunded: 0 };
  },
};

export function balanceOf(agentId) {
  ensureWallet(agentId);
  return db.prepare('SELECT balance FROM wallets WHERE agent_id = ?').get(agentId)?.balance ?? 0;
}

export function ledgerOf(agentId, limit = 20) {
  return db
    .prepare('SELECT delta, reason, ref_order_id, created_at FROM ledger WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, limit);
}

// Select adapter by env so M3.5 is a config flip, not a rewrite.
export function makeAdapter() {
  switch (process.env.PAYMENT_ADAPTER) {
    // case 'credits': return CreditsAdapter;
    // case 'onchain': return OnChainAdapter;
    default:
      return NoopAdapter;
  }
}
