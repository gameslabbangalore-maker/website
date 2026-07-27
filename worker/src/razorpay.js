const API_BASE = 'https://api.razorpay.com/v1';

const encoder = new TextEncoder();

function basicAuth(keyId, keySecret) {
  return 'Basic ' + btoa(`${keyId}:${keySecret}`);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

export async function createOrder(env, { amountPaise, receipt, notes = {} }) {
  if (!Number.isInteger(amountPaise) || amountPaise < 100) {
    throw new Error(`Refusing to create order for invalid amount: ${amountPaise}`);
  }

  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Razorpay order create failed (${res.status}): ${text}`);
  }

  let order;
  try {
    order = JSON.parse(text);
  } catch (err) {
    throw new Error(`Razorpay returned non-JSON order response: ${text}`);
  }

  if (!order.id) {
    throw new Error(`Razorpay order response missing id: ${text}`);
  }
  return order;
}

export async function verifyWebhookSignature(env, rawBody, signatureHeader) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
  }
  if (!signatureHeader) return false;
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  return timingSafeEqual(expected, signatureHeader.trim().toLowerCase());
}

export async function verifyPaymentSignature(env, { orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = await hmacSha256Hex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}
