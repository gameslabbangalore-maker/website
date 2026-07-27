#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto';

const args = {};
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args[match[1]] = match[2] === undefined ? true : match[2];
}

if (!args.order || !args.secret) {
  console.error('Missing required options.\n');
  console.error('  node test/sign-webhook.mjs --order=order_ABC123 --secret=whsec_local [--send]\n');
  console.error('Find the order id with:');
  console.error('  npx wrangler d1 execute gameslab-ticketing --local \\');
  console.error("    --command \"SELECT id, razorpay_order_id, status FROM bookings ORDER BY created_at DESC LIMIT 5\"");
  process.exit(1);
}

const eventType = args.event || 'payment.captured';
const paymentId = args.payment || 'pay_LOCALTEST0001';
const amount = Number(args.amount || 35000);
const baseUrl = String(args.url || 'http://localhost:8787').replace(/\/+$/, '');
const endpoint = `${baseUrl}/api/razorpay/webhook`;

const paymentEntity = {
  id: paymentId,
  entity: 'payment',
  amount,
  currency: 'INR',
  status: eventType === 'payment.failed' ? 'failed' : 'captured',
  order_id: args.order,
  method: 'upi',
  captured: eventType !== 'payment.failed',
  email: 'test@example.com',
  contact: '+919000000000',
};

if (eventType === 'payment.failed') {
  paymentEntity.error_code = 'BAD_REQUEST_ERROR';
  paymentEntity.error_description = 'Simulated failure from sign-webhook.mjs';
}

const payload = {
  entity: 'event',
  account_id: 'acc_LOCALTEST',
  event: eventType,
  contains: ['payment'],
  payload: { payment: { entity: paymentEntity } },
  created_at: Math.floor(new Date('2026-08-01T10:00:00Z').getTime() / 1000),
};

const body = JSON.stringify(payload);
const signature = createHmac('sha256', args.secret).update(body).digest('hex');
const eventId = `evt_local_${randomUUID().slice(0, 12)}`;

if (args.send) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': signature,
      'X-Razorpay-Event-Id': eventId,
    },
    body,
  });
  const text = await res.text();
  console.log(`POST ${endpoint}`);
  console.log(`  -> ${res.status} ${text}`);
  if (res.status === 401) {
    console.error('\n401 means --secret does not match RAZORPAY_WEBHOOK_SECRET on the Worker.');
    process.exit(1);
  }
  if (res.ok) {
    console.log('\nNow reload /ticket/ — it should flip to CONFIRMED with ticket codes.');
  }
} else {
  const escaped = body.replace(/'/g, `'\\''`);
  console.log(`curl -sS -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Razorpay-Signature: ${signature}' \\
  -H 'X-Razorpay-Event-Id: ${eventId}' \\
  -d '${escaped}'`);
  console.log('\n(add --send to POST it directly)');
}
