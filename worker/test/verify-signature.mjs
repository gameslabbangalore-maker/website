import { createHmac, webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { verifyWebhookSignature, verifyPaymentSignature } = await import('../src/razorpay.js');

const SECRET = 'whsec_test_9f3a1c';
const env = { RAZORPAY_WEBHOOK_SECRET: SECRET, RAZORPAY_KEY_SECRET: SECRET };

const body = JSON.stringify({
  entity: 'event',
  event: 'payment.captured',
  contains: ['payment'],
  payload: {
    payment: {
      entity: {
        id: 'pay_TESTabc123',
        order_id: 'order_TESTxyz789',
        amount: 35000,
        currency: 'INR',
        status: 'captured',
      },
    },
  },
  created_at: 1785000000,
});

const razorpaySign = (secret, payload) =>
  createHmac('sha256', secret).update(payload).digest('hex');

const results = [];
function check(label, got, want) {
  const ok = got === want;
  results.push({ label, ok, got, want });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${got}, want ${want}`);
}

const valid = razorpaySign(SECRET, body);

console.log('webhook signature verification\n');

check('accepts a correctly signed body',
  await verifyWebhookSignature(env, body, valid), true);

check('accepts uppercase hex (header case must not matter)',
  await verifyWebhookSignature(env, body, valid.toUpperCase()), true);

check('accepts surrounding whitespace',
  await verifyWebhookSignature(env, body, `  ${valid}  `), true);

check('REJECTS a tampered body (amount changed)',
  await verifyWebhookSignature(env, body.replace('35000', '100'), valid), false);

check('REJECTS a signature made with the wrong secret',
  await verifyWebhookSignature(env, body, razorpaySign('wrong_secret', body)), false);

check('REJECTS an unsigned request',
  await verifyWebhookSignature(env, body, ''), false);

check('REJECTS a null signature',
  await verifyWebhookSignature(env, body, null), false);

check('REJECTS a truncated signature',
  await verifyWebhookSignature(env, body, valid.slice(0, -2)), false);

check('REJECTS a one-character-off signature',
  await verifyWebhookSignature(env, body,
    valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a')), false);

check('REJECTS a re-serialised body (proves raw bytes are required)',
  await verifyWebhookSignature(env, JSON.stringify(JSON.parse(body), null, 2), valid), false);

console.log('\ncheckout callback signature (order_id|payment_id)\n');

const orderId = 'order_TESTxyz789';
const paymentId = 'pay_TESTabc123';
const paySig = razorpaySign(SECRET, `${orderId}|${paymentId}`);

check('accepts a valid checkout signature',
  await verifyPaymentSignature(env, { orderId, paymentId, signature: paySig }), true);

check('REJECTS a swapped order/payment id',
  await verifyPaymentSignature(env, { orderId: paymentId, paymentId: orderId, signature: paySig }), false);

check('REJECTS a missing signature',
  await verifyPaymentSignature(env, { orderId, paymentId, signature: '' }), false);

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length) {
  console.error(`${failed.length} FAILED: ${failed.map((f) => f.label).join(', ')}`);
  process.exit(1);
}
console.log(`all ${results.length} checks passed`);
