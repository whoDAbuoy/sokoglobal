// Run: npx tsx --conditions=react-server --test lib/chat-admin.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminThreadParties, attachmentScope, orderChatOpen, parseChatKind } from './chat-admin.ts';

test('order chat opens for paid orders and accepted quotes, not other unpaid ones', () => {
  assert.equal(orderChatOpen({ escrow_status: 'pending_payment' }), false);
  assert.equal(orderChatOpen({ escrow_status: 'pending_payment', rfq_quote_id: 'q1' }), true);
  assert.equal(orderChatOpen({ escrow_status: 'deposit_paid', deposit_paid_at: '2026-10-01' }), true);
  for (const s of ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'released', 'disputed', 'refunded'] as const) {
    assert.equal(orderChatOpen({ escrow_status: s }), true, s);
  }
  assert.equal(orderChatOpen({ escrow_status: 'cancelled' }), false);                                // expired before payment
  assert.equal(orderChatOpen({ escrow_status: 'cancelled', funded_at: '2026-10-01' }), true);       // money moved
});

test('attachment scope and admin labels', () => {
  assert.equal(attachmentScope({ id: 't1', order_id: 'o1' }), 'o1');
  assert.equal(attachmentScope({ id: 't1', order_id: null }), 't1');
  assert.equal(adminThreadParties({ kind: 'order', buyer_name: 'Imp Co', supplier_name: 'Sup Co', user_name: null }), 'Imp Co ↔ Sup Co');
  assert.equal(adminThreadParties({ kind: 'direct', buyer_name: null, supplier_name: null, user_name: 'Imp Co' }), 'Imp Co');
  assert.equal(parseChatKind('direct'), 'direct');
  assert.equal(parseChatKind('all'), null);
});
