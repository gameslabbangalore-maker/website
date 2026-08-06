import * as db from './db.js';
import { createOrder, verifyWebhookSignature, verifyPaymentSignature } from './razorpay.js';
import { bookingId, accessToken } from './ids.js';
import { syncCalendar } from './calendar-sync.js';
import { sendTicketEmail } from './email.js';
import { qrSvg, qrPng } from './qr.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function corsHeaders(env, request) {
  const allowed = (env.SITE_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const allow = allowed.includes(origin) ? origin : (allowed[0] || '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(env, request, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(env, request), ...extraHeaders },
  });
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isStaff(env, request) {
  const header = request.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateBookingInput(payload, maxQty) {
  const errors = {};

  const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) errors.name = 'Enter your full name.';

  const email = String(payload.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 160) errors.email = 'Enter a valid email address.';

  const rawPhone = String(payload.phone || '').replace(/[\s()-]/g, '');
  const phoneMatch = rawPhone.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  if (!phoneMatch) errors.phone = 'Enter a valid 10-digit mobile number.';
  const phone = phoneMatch ? `+91${phoneMatch[1]}` : '';

  const qty = Number(payload.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) {
    errors.qty = `Choose between 1 and ${maxQty} tickets.`;
  }

  const occurrenceId = String(payload.occurrence_id || '').trim();
  if (!/^[a-z0-9-]{3,80}$/.test(occurrenceId)) errors.occurrence_id = 'Unknown event date.';

  return { errors, value: { name, email, phone, qty, occurrenceId } };
}

function publicOccurrence(row) {
  if (!row) return null;
  const available = Math.max(0, Number(row.available) || 0);
  return {
    id: row.id,
    event_slug: row.event_slug,
    title: row.event_title,
    starts_at: row.starts_at_utc,
    timezone: row.timezone,
    venue_name: row.venue_name,
    venue_map_url: row.venue_map_url,
    price_paise: row.price_paise,
    capacity: row.capacity,
    available,
    on_sale: row.status === 'open' && row.price_paise > 0 && available > 0,
    status: row.status,
  };
}

async function handleAvailability(env, request) {
  const rows = await db.listAvailability(env.DB, nowIso());
  const byOccurrence = {};
  const byEvent = {};

  for (const row of rows) {
    const available = Math.max(0, Number(row.available) || 0);
    const entry = {
      id: row.id,
      event_slug: row.event_slug,
      starts_at: row.starts_at_utc,
      price_paise: row.price_paise,
      capacity: row.capacity,
      available,
      on_sale: row.status === 'open' && row.price_paise > 0 && available > 0,
      status: row.status,
    };
    byOccurrence[row.id] = entry;
    if (!byEvent[row.event_slug]) byEvent[row.event_slug] = entry;
  }

  return json(env, request, { generated_at: nowIso(), occurrences: byOccurrence, next_by_event: byEvent }, 200, {
    'Cache-Control': 'public, max-age=15',
  });
}

async function handleOccurrence(env, request, id) {
  const row = await db.getOccurrence(env.DB, id, nowIso());
  if (!row) return json(env, request, { error: 'not_found' }, 404);
  return json(env, request, { occurrence: publicOccurrence(row) });
}

/**
 * Render a QR for a ticket code. Deliberately dumb: it draws whatever short
 * payload it is handed, so the same URL works from the ticket page (SVG) and
 * from the ticket email (PNG, because mail clients will not render SVG).
 */
function handleQr(env, request, url) {
  const data = (url.searchParams.get('d') || '').trim();
  if (!data || data.length > 96) {
    return json(env, request, { error: 'bad_payload' }, 400);
  }

  const format = (url.searchParams.get('f') || 'svg').toLowerCase() === 'png' ? 'png' : 'svg';
  const scale = Math.min(16, Math.max(2, Number(url.searchParams.get('s')) || 8));
  const headers = {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    if (format === 'png') {
      return new Response(qrPng(data, { scale }), {
        headers: { ...headers, 'Content-Type': 'image/png' },
      });
    }
    return new Response(qrSvg(data, { scale }), {
      headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' },
    });
  } catch (err) {
    return json(env, request, { error: 'qr_failed', detail: err.message }, 400);
  }
}

async function handleBook(env, request) {
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json(env, request, { error: 'bad_json' }, 400);
  }

  const maxQty = Number(env.MAX_QTY_PER_BOOKING || 10);
  const { errors, value } = validateBookingInput(payload, maxQty);
  if (Object.keys(errors).length) {
    return json(env, request, { error: 'validation_failed', fields: errors }, 422);
  }

  const now = nowIso();
  const occurrence = await db.getOccurrence(env.DB, value.occurrenceId, now);
  if (!occurrence) return json(env, request, { error: 'not_found' }, 404);

  if (occurrence.status !== 'open' || occurrence.price_paise <= 0) {
    return json(env, request, { error: 'not_on_sale', occurrence: publicOccurrence(occurrence) }, 409);
  }
  if (Number(occurrence.available) < value.qty) {
    return json(env, request, {
      error: 'insufficient_seats',
      available: Math.max(0, Number(occurrence.available) || 0),
      occurrence: publicOccurrence(occurrence),
    }, 409);
  }

  const parked = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) AS held FROM bookings
        WHERE occurrence_id = ?1 AND email = ?2
          AND status = 'pending' AND hold_expires_at > ?3`,
    )
    .bind(value.occurrenceId, value.email, now)
    .first();
  if (Number(parked?.held || 0) + value.qty > maxQty) {
    return json(env, request, { error: 'too_many_pending' }, 429);
  }

  const holdMinutes = Number(env.HOLD_MINUTES || 10);
  const holdExpiresAt = new Date(Date.now() + holdMinutes * 60_000)
    .toISOString().replace(/\.\d{3}Z$/, 'Z');

  const id = bookingId();
  const token = accessToken();

  const booking = await db.createHold(env.DB, {
    id, token, occurrenceId: value.occurrenceId, qty: value.qty,
    name: value.name, email: value.email, phone: value.phone,
    now, holdExpiresAt,
  });

  if (!booking) {
    const fresh = await db.getOccurrence(env.DB, value.occurrenceId, now);
    return json(env, request, {
      error: 'insufficient_seats',
      available: Math.max(0, Number(fresh?.available) || 0),
      occurrence: publicOccurrence(fresh),
    }, 409);
  }

  let order;
  try {
    order = await createOrder(env, {
      amountPaise: booking.amount_paise,
      receipt: booking.id,
      notes: {
        booking_id: booking.id,
        occurrence_id: booking.occurrence_id,
        event: occurrence.event_title,
        qty: String(booking.qty),
        // Razorpay Checkout does not always collect a name, so carry the one we
        // already validated into the order. It shows on the payment in the
        // dashboard and in Razorpay's exports.
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
      },
    });
  } catch (err) {
    await db.abandonBooking(env.DB, booking.id, `order_create_failed: ${err.message}`);
    console.error('order create failed', err.message);
    return json(env, request, { error: 'payment_init_failed' }, 502);
  }

  await db.attachOrderId(env.DB, booking.id, order.id);

  return json(env, request, {
    booking_id: booking.id,
    access_token: token,
    order_id: order.id,
    key_id: env.RAZORPAY_KEY_ID,
    amount_paise: booking.amount_paise,
    currency: 'INR',
    hold_expires_at: holdExpiresAt,
    event: {
      title: occurrence.event_title,
      starts_at: occurrence.starts_at_utc,
      venue_name: occurrence.venue_name,
      qty: booking.qty,
    },
    prefill: { name: booking.name, email: booking.email, contact: booking.phone },
  });
}

async function handleBookingStatus(env, request, id, url) {
  const token = url.searchParams.get('token') || '';
  if (!token) return json(env, request, { error: 'token_required' }, 401);

  const booking = await db.getBookingByToken(env.DB, id, token);
  if (!booking) return json(env, request, { error: 'not_found' }, 404);

  const tickets = booking.status === 'paid' ? await db.listTickets(env.DB, booking.id) : [];

  return json(env, request, {
    booking: {
      id: booking.id,
      status: booking.status,
      qty: booking.qty,
      amount_paise: booking.amount_paise,
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      created_at: booking.created_at,
      paid_at: booking.paid_at,
      hold_expires_at: booking.hold_expires_at,
    },
    event: {
      slug: booking.event_slug,
      title: booking.event_title,
      starts_at: booking.starts_at_utc,
      timezone: booking.timezone,
      venue_name: booking.venue_name,
      venue_map_url: booking.venue_map_url,
    },
    tickets: tickets.map((t) => ({ code: t.code, seat_no: t.seat_no })),
  }, 200, { 'Cache-Control': 'no-store' });
}

async function handleWebhook(env, request) {
  const rawBody = await request.text();
  const signature = request.headers.get('X-Razorpay-Signature');

  let valid = false;
  try {
    valid = await verifyWebhookSignature(env, rawBody, signature);
  } catch (err) {
    console.error('webhook verify error', err.message);
    return json(env, request, { error: 'misconfigured' }, 500);
  }
  if (!valid) {
    console.warn('webhook rejected: bad signature');
    return json(env, request, { error: 'invalid_signature' }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return json(env, request, { error: 'bad_json' }, 400);
  }

  const now = nowIso();
  const eventType = event.event || '';
  const eventId = request.headers.get('X-Razorpay-Event-Id')
    || `${eventType}:${event?.payload?.payment?.entity?.id || event?.payload?.refund?.entity?.id || rawBody.length}`;

  if (await db.wasWebhookSeen(env.DB, eventId, eventType, now)) {
    return json(env, request, { ok: true, deduped: true });
  }

  try {
    const payment = event?.payload?.payment?.entity;
    const refund = event?.payload?.refund?.entity;

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const orderId = payment?.order_id || event?.payload?.order?.entity?.id;
      const paymentId = payment?.id || null;
      if (orderId) {
        const result = await db.markPaidAndMintTickets(env.DB, { orderId, paymentId, now });
        if (result.minted) {
          const booking = await db.getBookingByToken(env.DB, result.booking.id, result.booking.access_token);
          const tickets = await db.listTickets(env.DB, result.booking.id);
          const ticketUrl = `${(env.SITE_ORIGIN || '').split(',')[0]}/ticket/?b=${result.booking.id}&t=${result.booking.access_token}`;
          const emailStatus = await sendTicketEmail(env, {
            booking, tickets, ticketUrl, qrOrigin: new URL(request.url).origin,
          });
          console.log(`booking ${result.booking.id} paid, ${tickets.length} tickets, email=${emailStatus}`);
        }
      }
    } else if (eventType === 'payment.failed') {
      const orderId = payment?.order_id;
      if (orderId) {
        await db.markFailed(env.DB, orderId, payment?.error_description || 'payment failed', now);
      }
    } else if (eventType === 'refund.processed' || eventType === 'refund.created') {
      const paymentId = refund?.payment_id;
      if (paymentId) await db.markRefunded(env.DB, paymentId, now);
    }
  } catch (err) {
    console.error('webhook handling error', eventType, err.message);
    await env.DB.prepare(`UPDATE webhook_log SET outcome = ?1 WHERE event_id = ?2`)
      .bind(`error: ${err.message}`.slice(0, 400), eventId)
      .run()
      .catch(() => {});
  }

  return json(env, request, { ok: true });
}

async function handleConfirmHint(env, request) {
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json(env, request, { error: 'bad_json' }, 400);
  }

  const ok = await verifyPaymentSignature(env, {
    orderId: payload.razorpay_order_id,
    paymentId: payload.razorpay_payment_id,
    signature: payload.razorpay_signature,
  });

  return json(env, request, { acknowledged: ok }, ok ? 200 : 400);
}

/**
 * Receive per-event price/capacity defaults from _events/*.md, pushed by the
 * sync-event-defaults GitHub Action.
 *
 * Two effects per event: update the row in `events`, then open any future
 * occurrence that was never priced. Dates already carrying a price keep it.
 */
async function handleEventDefaults(env, request) {
  if (!isStaff(env, request)) return json(env, request, { error: 'unauthorized' }, 401);

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json(env, request, { error: 'bad_json' }, 400);
  }

  const incoming = Array.isArray(payload && payload.events) ? payload.events : null;
  if (!incoming || !incoming.length) {
    return json(env, request, { error: 'events_array_required' }, 422);
  }

  const now = nowIso();
  const report = { updated: [], opened: 0, rejected: [] };

  for (const raw of incoming) {
    const slug = String((raw && raw.slug) || '').trim().toLowerCase();
    const title = String((raw && raw.title) || '').trim();
    const pricePaise = Number(raw && raw.price_paise);
    const capacity = Number(raw && raw.capacity);

    if (!/^[a-z0-9-]{3,60}$/.test(slug) || !title) {
      report.rejected.push({ slug: slug || '(missing)', reason: 'bad slug or title' });
      continue;
    }
    if (!Number.isInteger(pricePaise) || pricePaise < 0 || pricePaise > 10_000_000) {
      report.rejected.push({ slug, reason: `bad price_paise: ${raw && raw.price_paise}` });
      continue;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
      report.rejected.push({ slug, reason: `bad capacity: ${raw && raw.capacity}` });
      continue;
    }

    await db.upsertEventDefaults(env.DB, { slug, title, pricePaise, capacity });

    const opened = await db.applyDefaultsToUnpricedOccurrences(env.DB, slug, {
      pricePaise, capacity, now,
    });
    report.opened += opened;
    report.updated.push({
      slug,
      price_paise: pricePaise,
      capacity,
      occurrences_opened: opened,
      sellable: pricePaise > 0,
    });
  }

  return json(env, request, { ok: true, report }, 200, { 'Cache-Control': 'no-store' });
}

async function handleStaffOccurrences(env, request) {
  if (!isStaff(env, request)) return json(env, request, { error: 'unauthorized' }, 401);

  const rows = await db.listOccurrencesForStaff(env.DB, nowIso());

  return json(env, request, {
    generated_at: nowIso(),
    occurrences: rows.map((row) => ({
      id: row.id,
      event_slug: row.event_slug,
      title: row.event_title,
      starts_at: row.starts_at_utc,
      timezone: row.timezone,
      venue_name: row.venue_name,
      capacity: Number(row.capacity) || 0,
      price_paise: Number(row.price_paise) || 0,
      sold: Number(row.sold) || 0,
      held: Number(row.held) || 0,
      left: Math.max(0, Number(row.available) || 0),
      revenue_paise: Number(row.revenue_paise) || 0,
      status: row.status,
      on_sale: row.status === 'open' && row.price_paise > 0 && Number(row.available) > 0,
    })),
  }, 200, { 'Cache-Control': 'no-store' });
}

async function handleAttendees(env, request, url) {
  if (!isStaff(env, request)) return json(env, request, { error: 'unauthorized' }, 401);

  const occurrenceId = url.searchParams.get('occurrence');
  if (!occurrenceId) return json(env, request, { error: 'occurrence_required' }, 400);

  const { results } = await env.DB
    .prepare(
      `SELECT b.id, b.name, b.email, b.phone, b.qty, b.amount_paise, b.status,
              b.paid_at, b.razorpay_payment_id, b.notes,
              (SELECT GROUP_CONCAT(t.code) FROM tickets t WHERE t.booking_id = b.id) AS codes
         FROM bookings b
        WHERE b.occurrence_id = ?1
        ORDER BY b.created_at ASC`,
    )
    .bind(occurrenceId)
    .all();

  const occurrence = await db.getOccurrence(env.DB, occurrenceId, nowIso());

  return json(env, request, {
    occurrence: publicOccurrence(occurrence),
    bookings: results || [],
  }, 200, { 'Cache-Control': 'no-store' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
      if (pathname === '/api/health') {
        return json(env, request, {
          ok: true,
          now: nowIso(),
          razorpay_configured: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
          razorpay_mode: String(env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_')
            ? 'live'
            : (String(env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_') ? 'test' : 'unset'),
          webhook_configured: Boolean(env.RAZORPAY_WEBHOOK_SECRET),
          admin_configured: Boolean(env.ADMIN_TOKEN),
          email_configured: Boolean(env.RESEND_API_KEY),
        });
      }

      if (pathname === '/api/availability' && request.method === 'GET') {
        return await handleAvailability(env, request);
      }

      const occurrenceMatch = pathname.match(/^\/api\/occurrences\/([A-Za-z0-9-]{3,80})$/);
      if (occurrenceMatch && request.method === 'GET') {
        return await handleOccurrence(env, request, occurrenceMatch[1]);
      }

      if (pathname === '/api/book' && request.method === 'POST') {
        return await handleBook(env, request);
      }

      const bookingMatch = pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})$/i);
      if (bookingMatch && request.method === 'GET') {
        return await handleBookingStatus(env, request, bookingMatch[1], url);
      }

      if (pathname === '/api/razorpay/webhook' && request.method === 'POST') {
        return await handleWebhook(env, request);
      }

      if (pathname === '/api/confirm-hint' && request.method === 'POST') {
        return await handleConfirmHint(env, request);
      }

      if (pathname === '/api/qr' && request.method === 'GET') {
        return handleQr(env, request, url);
      }

      if (pathname === '/api/admin/occurrences' && request.method === 'GET') {
        return await handleStaffOccurrences(env, request);
      }

      if (pathname === '/api/admin/attendees' && request.method === 'GET') {
        return await handleAttendees(env, request, url);
      }

      if (pathname === '/api/admin/sync' && request.method === 'POST') {
        if (!isStaff(env, request)) return json(env, request, { error: 'unauthorized' }, 401);
        const report = await syncCalendar(env);
        return json(env, request, { ok: true, report });
      }

      if (pathname === '/api/admin/event-defaults' && request.method === 'POST') {
        return await handleEventDefaults(env, request);
      }

      return json(env, request, { error: 'not_found' }, 404);
    } catch (err) {
      console.error('unhandled', pathname, err && err.stack ? err.stack : err);
      return json(env, request, { error: 'internal_error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const released = await db.expireStaleHolds(env.DB, nowIso());
      if (released) console.log(`expired ${released} stale hold(s)`);

      if (event.cron === '17 */6 * * *') {
        try {
          const report = await syncCalendar(env);
          console.log('calendar sync', JSON.stringify(report));
        } catch (err) {
          console.error('calendar sync failed', err.message);
        }
      }
    })());
  },
};
