const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function formatWhen(startsAtUtc, timeZone) {
  const date = new Date(startsAtUtc);
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone,
  }).format(date).replace(/\u202f/g, ' ');
  return `${day}, ${time}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildHtml({ booking, tickets, ticketUrl, timeZone }) {
  const when = formatWhen(booking.starts_at_utc, timeZone);
  const codes = tickets
    .map((t) => `<li style="font:700 18px/1.6 monospace;letter-spacing:1px">${escapeHtml(t.code)}</li>`)
    .join('');

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0f1115;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e9e9ea">
  <div style="max-width:520px;margin:0 auto;background:#171a21;border-radius:16px;padding:28px">
    <h1 style="margin:0 0 4px;font-size:22px">You're in 🎉</h1>
    <p style="margin:0 0 20px;color:#a9adb8">${escapeHtml(booking.event_title)}</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:6px 0;color:#a9adb8">When</td><td style="padding:6px 0;text-align:right">${escapeHtml(when)}</td></tr>
      <tr><td style="padding:6px 0;color:#a9adb8">Where</td><td style="padding:6px 0;text-align:right">${escapeHtml(booking.venue_name)}</td></tr>
      <tr><td style="padding:6px 0;color:#a9adb8">Tickets</td><td style="padding:6px 0;text-align:right">${booking.qty}</td></tr>
      <tr><td style="padding:6px 0;color:#a9adb8">Paid</td><td style="padding:6px 0;text-align:right">₹${(booking.amount_paise / 100).toFixed(2)}</td></tr>
    </table>

    <p style="margin:0 0 8px;color:#a9adb8;font-size:14px">Show this code at the door:</p>
    <ul style="margin:0 0 20px;padding-left:20px">${codes}</ul>

    <a href="${escapeHtml(ticketUrl)}"
       style="display:inline-block;background:#ffe974;color:#000;font-weight:700;padding:12px 20px;border-radius:999px;text-decoration:none">
      View your ticket
    </a>

    <p style="margin:24px 0 0;color:#6f747f;font-size:12px">
      Games Lab · Bengaluru · support@gameslab.co.in
    </p>
  </div>
</body></html>`;
}

export async function sendTicketEmail(env, { booking, tickets, ticketUrl }) {
  if (!env.RESEND_API_KEY) return 'skipped:no-key';
  if (!booking || !booking.email) return 'skipped:no-recipient';

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.TICKET_EMAIL_FROM || 'Games Lab <tickets@gameslab.co.in>',
        to: [booking.email],
        subject: `Your ${booking.event_title} ticket${booking.qty > 1 ? 's' : ''}`,
        html: buildHtml({
          booking,
          tickets,
          ticketUrl,
          timeZone: booking.timezone || env.TIMEZONE || 'Asia/Kolkata',
        }),
      }),
    });
    if (!res.ok) return `error:${res.status}`;
    return 'sent';
  } catch (err) {
    return `error:${err.message}`;
  }
}
