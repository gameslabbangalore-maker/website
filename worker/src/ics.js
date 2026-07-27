const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_OFFSET = '+05:30';

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function decodeText(value = '') {
  return value.replace(/\\([nN,;\\])/g, (_, ch) => {
    if (ch === 'n' || ch === 'N') return '\n';
    if (ch === '\\') return '\\';
    return ch;
  });
}

function offsetForTz(tzid) {
  if (!tzid) return DEFAULT_OFFSET;
  const lower = tzid.toLowerCase();
  if (lower === 'asia/kolkata' || lower === 'asia/calcutta') return '+05:30';
  return DEFAULT_OFFSET;
}

function parseDateTime(value, params) {
  if (!value) return null;
  if (!value.includes('T')) return null;

  const normalized = value.replace(/Z$/, '');
  const match = normalized.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
  if (!match) return null;

  const [, y, m, d, hh, mm, ss = '00'] = match;
  const offset = /Z$/.test(value) ? '+00:00' : offsetForTz(params && params.TZID);
  const date = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseIcs(text) {
  const out = [];
  const chunks = unfold(text).split('BEGIN:VEVENT').slice(1);

  for (const chunk of chunks) {
    const body = chunk.split('END:VEVENT')[0];
    const props = new Map();

    for (const line of body.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const sep = line.indexOf(':');
      if (sep < 1) continue;
      const rawName = line.slice(0, sep);
      const value = line.slice(sep + 1).trim();
      const [name, ...paramParts] = rawName.split(';');
      const params = {};
      for (const part of paramParts) {
        const eq = part.indexOf('=');
        if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
      }
      props.set(name.toUpperCase(), { value, params });
    }

    const status = (props.get('STATUS')?.value || '').toUpperCase();
    if (status === 'CANCELLED') continue;

    const summary = decodeText(props.get('SUMMARY')?.value || '').trim();
    if (!summary) continue;

    const dtstart = props.get('DTSTART');
    const start = parseDateTime(dtstart?.value, dtstart?.params);
    if (!start) continue;

    out.push({
      uid: props.get('UID')?.value || '',
      summary,
      start,
      location: decodeText(props.get('LOCATION')?.value || '').trim(),
      description: decodeText(props.get('DESCRIPTION')?.value || '').trim(),
    });
  }
  return out;
}

export function parseTicketDirectives(description) {
  const out = { pricePaise: null, capacity: null, closed: false };
  if (!description) return out;

  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const price = line.match(/^price\s*[:=]\s*(?:inr\s*|rs\.?\s*|₹\s*)?([\d,]+(?:\.\d{1,2})?)\s*(paise)?/i);
    if (price) {
      const amount = Number(price[1].replace(/,/g, ''));
      if (Number.isFinite(amount) && amount > 0) {
        out.pricePaise = price[2] ? Math.round(amount) : Math.round(amount * 100);
      }
      continue;
    }

    const capacity = line.match(/^(?:capacity|seats|cap)\s*[:=]\s*(\d{1,4})/i);
    if (capacity) {
      const n = Number(capacity[1]);
      if (Number.isInteger(n) && n > 0) out.capacity = n;
      continue;
    }

    if (/^tickets?\s*[:=]\s*(closed|off|none|sold\s*out)/i.test(line)) {
      out.closed = true;
    }
  }
  return out;
}

export function dayKeyInZone(date, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).format(date);
}

export function toIsoUtc(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
