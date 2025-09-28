import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'assets', 'data', 'calendar.json');
const LOCATIONS_PATH = path.join(ROOT, '_data', 'locations.yml');

const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_OFFSET = '+05:30';
const PUBLIC_CALENDAR_URL = 'https://calendar.google.com/calendar/ical/da645a8c3679d92a4f5aa27a0415af79342a316216a0f83f9d299327c1f0b56e%40group.calendar.google.com/public/basic.ics';

function slugify(value) {
  if (!value) return '';
  return value
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseIcsEvents(text) {
  const events = [];
  const unfolded = unfoldIcs(text);
  const chunks = unfolded.split('BEGIN:VEVENT').slice(1);
  for (const chunk of chunks) {
    const body = chunk.split('END:VEVENT')[0];
    const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
    const props = new Map();
    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length < 2) continue;
      const value = parts.slice(1).join(':').trim();
      const [name, ...paramParts] = parts[0].split(';');
      const key = name.toUpperCase();
      const params = {};
      for (const part of paramParts) {
        const [pKey, pVal] = part.split('=');
        if (pKey && pVal) params[pKey.toUpperCase()] = pVal;
      }
      props.set(key, { value, params });
    }
    events.push(props);
  }
  return events;
}

function toIsoString(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function offsetForTz(tzid) {
  if (!tzid) return DEFAULT_OFFSET;
  const lower = tzid.toLowerCase();
  if (lower === 'asia/kolkata' || lower === 'asia/calcutta') return '+05:30';
  return DEFAULT_OFFSET;
}

function decodeText(value = '') {
  return value.replace(/\\([nN,;\\])/g, (_, ch) => {
    switch (ch) {
      case 'n':
      case 'N':
        return String.fromCharCode(10);
      case ',':
        return ',';
      case ';':
        return ';';
      case '\\':
        return '\\';
      default:
        return ch;
    }
  });
}

function parseDateTime(value, params) {
  if (!value) return null;
  const normalized = value.replace(/Z$/, '');
  const match = normalized.match(/^(\d{4})(\d{2})(\d{2})(?:T?(\d{2})(\d{2})(\d{2})?)?$/);
  if (!match) return null;
  const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  const second = Number(ss);

  if (!value.includes('T')) {
    return null; // all-day events not supported
  }

  const isUtc = /Z$/.test(value);
  const offset = isUtc ? '+00:00' : offsetForTz(params?.TZID);
  const iso = `${year.toString().padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}${offset}`;
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

function formatDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: DEFAULT_TIMEZONE,
  }).format(date);
}

function normalizeLocationKey(value) {
  return value ? value.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

async function loadLocations() {
  try {
    const raw = await fs.readFile(LOCATIONS_PATH, 'utf8');
    const lines = raw.split(/\r?\n/);
    const entries = [];
    let current = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (/^\s*-/.test(line)) {
        if (current) entries.push(current);
        current = {};
        const rest = line.replace(/^\s*-\s*/, '');
        if (rest.includes(':')) {
          const [key, ...valueParts] = rest.split(':');
          const keyName = key.trim();
          const value = valueParts.join(':').trim().replace(/^"|"$/g, '');
          if (keyName) current[keyName] = value;
        }
      } else if (/^\s+/.test(line) && current) {
        const trimmed = line.trim();
        if (!trimmed.includes(':')) continue;
        const [key, ...valueParts] = trimmed.split(':');
        const keyName = key.trim();
        const value = valueParts.join(':').trim().replace(/^"|"$/g, '');
        if (keyName) current[keyName] = value;
      }
    }
    if (current) entries.push(current);

    const map = new Map();
    for (const entry of entries) {
      if (!entry) continue;
      const name = (entry.name || '').trim();
      if (!name) continue;
      const key = normalizeLocationKey(name);
      if (!key) continue;
      map.set(key, {
        name,
        map_url: entry.map_url || '',
      });
    }
    return map;
  } catch (err) {
    console.warn('Could not read locations.yml:', err.message);
    return new Map();
  }
}

function resolveLocation(decodedLocation, locations) {
  const trimmed = (decodedLocation || '').trim();
  if (!trimmed) {
    return { match: null, warning: false };
  }

  const candidates = new Set();
  candidates.add(trimmed);

  const withoutCarriage = trimmed.replace(/\r/g, '');
  for (const part of withoutCarriage.split(/\n+/)) {
    const piece = part.trim();
    if (!piece) continue;
    candidates.add(piece);
    const commaPiece = piece.split(',')[0].trim();
    if (commaPiece && commaPiece.length >= 2) {
      candidates.add(commaPiece);
    }
  }

  const firstComma = withoutCarriage.split(',')[0]?.trim();
  if (firstComma) {
    candidates.add(firstComma);
  }

  for (const candidate of candidates) {
    const key = normalizeLocationKey(candidate);
    if (!key) continue;
    const match = locations.get(key);
    if (match) {
      return { match, warning: false };
    }
  }

  const haystack = normalizeLocationKey(trimmed);
  if (haystack) {
    for (const [key, match] of locations.entries()) {
      if (haystack.includes(key)) {
        return { match, warning: false };
      }
    }
  }

  return { match: null, warning: true };
}

async function fetchIcs(source) {
  if (!source) {
    throw new Error('CALENDAR_ICS_URL is not configured.');
  }
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to download ICS (${res.status})`);
    return await res.text();
  }
  const filePath = path.isAbsolute(source) ? source : path.join(ROOT, source);
  return await fs.readFile(filePath, 'utf8');
}

async function main() {
  const source = process.env.CALENDAR_ICS_URL || process.env.ICS_URL || PUBLIC_CALENDAR_URL;
  let icsText = '';
  try {
    icsText = await fetchIcs(source);
  } catch (error) {
    console.error('[calendar] Unable to fetch ICS:', error.message);
    throw error;
  }

  const locations = await loadLocations();
  const todayKey = formatDayKey(new Date());
  const deduped = new Map();

  for (const props of parseIcsEvents(icsText)) {
    const status = props.get('STATUS')?.value?.toUpperCase();
    if (status === 'CANCELLED') continue;

    const summary = (props.get('SUMMARY')?.value || '').trim();
    if (!summary) continue;

    const start = parseDateTime(props.get('DTSTART')?.value, props.get('DTSTART')?.params);
    if (!start) continue;

    const dayKey = formatDayKey(start);
    if (dayKey < todayKey) continue;

    const slug = slugify(summary);
    const rawLocationValue = props.get('LOCATION')?.value || '';
    const decodedLocation = decodeText(rawLocationValue);
    const rawLocation = decodedLocation.trim();
    const { match: locationMatch, warning: locationWarning } = resolveLocation(rawLocation, locations);

    const event = {
      title: summary,
      slug,
      start: toIsoString(start),
      day_key: dayKey,
      timezone: DEFAULT_TIMEZONE,
      location_name: locationMatch ? locationMatch.name : 'To be Announced',
      location_map_url: locationMatch ? locationMatch.map_url : '',
      location_warning: Boolean(rawLocation) && locationWarning,
      raw_location: rawLocation,
    };

    const existing = deduped.get(slug);
    if (!existing || Date.parse(event.start) < Date.parse(existing.start || '')) {
      deduped.set(slug, event);
    }
  }

  const events = Array.from(deduped.values());
  events.sort((a, b) => {
    const da = a?.start ? Date.parse(a.start) : NaN;
    const db = b?.start ? Date.parse(b.start) : NaN;
    if (Number.isNaN(da)) return 1;
    if (Number.isNaN(db)) return -1;
    return da - db;
  });

  const payload = {
    generated_at: new Date().toISOString(),
    timezone: DEFAULT_TIMEZONE,
    events,
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[calendar] Wrote ${events.length} upcoming event${events.length === 1 ? '' : 's'} to ${path.relative(ROOT, OUTPUT)}`);
}

main().catch(err => {
  console.error('[calendar] Unhandled error:', err);
  process.exitCode = 1;
});
