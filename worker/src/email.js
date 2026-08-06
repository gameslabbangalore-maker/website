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

function rupees(paise) {
  const value = (Number(paise) || 0) / 100;
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function fact(label, value) {
  return `<tr>
      <td style="padding:8px 0;color:#a9adb8;font-size:13px;border-bottom:1px solid #262a33">${escapeHtml(label)}</td>
      <td style="padding:8px 0;text-align:right;font-weight:700;font-size:14px;border-bottom:1px solid #262a33">${escapeHtml(value)}</td>
    </tr>`;
}

function ticketBlock(ticket, index, total, qrOrigin) {
  const label = total > 1 ? `TICKET ${index + 1} OF ${total}` : 'TICKET ID';
  const qr = qrOrigin
    ? `<img src="${escapeHtml(`${qrOrigin}/api/qr?f=png&s=6&d=${encodeURIComponent(ticket.code)}`)}"
           width="150" height="150" alt="QR code for ticket ${escapeHtml(ticket.code)}"
           style="display:block;margin:0 auto 10px;border-radius:8px;background:#ffffff" />`
    : '';

  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 12px">
      <tr><td style="background:#0f1115;border:1px dashed #3a3f4b;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:11px;letter-spacing:.08em;color:#a9adb8;margin-bottom:10px">${escapeHtml(label)}</div>
        ${qr}
        <div style="font:700 20px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px;color:#ffe974">${escapeHtml(ticket.code)}</div>
      </td></tr>
    </table>`;
}

function buildHtml({ booking, tickets, ticketUrl, timeZone, qrOrigin }) {
  const when = formatWhen(booking.starts_at_utc, timeZone);
  const blocks = tickets
    .map((ticket, index) => ticketBlock(ticket, index, tickets.length, qrOrigin))
    .join('');

  const directions = booking.venue_map_url
    ? `<a href="${escapeHtml(booking.venue_map_url)}"
          style="display:inline-block;border:1.5px solid #3a3f4b;color:#e9e9ea;font-weight:700;padding:11px 18px;border-radius:999px;text-decoration:none;font-size:14px">
         Get directions
       </a>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0f1115;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e9e9ea">
  <div style="max-width:520px;margin:0 auto;background:#171a21;border-radius:16px;padding:28px">
    <div style="display:inline-block;background:#1f7a3d;color:#fff;font-size:11px;font-weight:700;letter-spacing:.1em;padding:5px 11px;border-radius:999px;margin-bottom:14px">CONFIRMED</div>
    <h1 style="margin:0 0 4px;font-size:22px">You're in 🎉</h1>
    <p style="margin:0 0 20px;color:#a9adb8">${escapeHtml(booking.event_title)}</p>

    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:22px">
      ${fact('When', when)}
      ${fact('Where', booking.venue_name || 'To be announced')}
      ${fact('Name', booking.name || '—')}
      ${fact('Tickets', String(booking.qty))}
      ${fact('Paid', rupees(booking.amount_paise))}
    </table>

    <p style="margin:0 0 12px;color:#a9adb8;font-size:14px">Show this QR at the event:</p>
    ${blocks}

    <p style="margin:0 0 20px">
      <a href="${escapeHtml(ticketUrl)}"
         style="display:inline-block;background:#ffe974;color:#000;font-weight:700;padding:12px 20px;border-radius:999px;text-decoration:none;font-size:14px">
        View your ticket
      </a>
      ${directions}
    </p>

    <p style="margin:0;color:#6f747f;font-size:12.5px;line-height:1.6">
      Need help or want to change your booking? Reply to this email or WhatsApp us on +91 76760 99857.
    </p>

    <p style="margin:20px 0 0;color:#6f747f;font-size:12px">
      Games Lab · Bengaluru · support@gameslab.co.in
    </p>
  </div>
</body></html>`;
}

function buildText({ booking, tickets, ticketUrl, timeZone }) {
  const lines = [
    `You're in — ${booking.event_title}`,
    '',
    `When:    ${formatWhen(booking.starts_at_utc, timeZone)}`,
    `Where:   ${booking.venue_name || 'To be announced'}`,
    `Name:    ${booking.name || '-'}`,
    `Tickets: ${booking.qty}`,
    `Paid:    ${rupees(booking.amount_paise)}`,
    '',
    tickets.length > 1 ? 'Ticket IDs:' : 'Ticket ID:',
    ...tickets.map((t, i) => (tickets.length > 1 ? `  ${i + 1}. ${t.code}` : `  ${t.code}`)),
    '',
    `Show the QR on your ticket page at the event: ${ticketUrl}`,
  ];
  return lines.join('\n');
}

export async function sendTicketEmail(env, { booking, tickets, ticketUrl, qrOrigin }) {
  if (!env.RESEND_API_KEY) return 'skipped:no-key';
  if (!booking || !booking.email) return 'skipped:no-recipient';

  const timeZone = booking.timezone || env.TIMEZONE || 'Asia/Kolkata';

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
        html: buildHtml({ booking, tickets, ticketUrl, timeZone, qrOrigin }),
        text: buildText({ booking, tickets, ticketUrl, timeZone }),
      }),
    });
    if (!res.ok) return `error:${res.status}`;
    return 'sent';
  } catch (err) {
    return `error:${err.message}`;
  }
}
