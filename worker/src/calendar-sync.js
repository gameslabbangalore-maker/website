import { parseIcs, parseTicketDirectives, dayKeyInZone, toIsoUtc } from './ics.js';
import { occurrenceId, slugify } from './ids.js';
import { upsertOccurrence, applyCalendarOverrides, knownEventSlugs } from './db.js';

function resolveEventSlug(summary, slugs) {
  const candidate = slugify(summary);
  if (!candidate) return null;

  const exact = slugs.find((s) => s.slug === candidate);
  if (exact) return exact;

  const ranked = [...slugs].sort((a, b) => b.slug.length - a.slug.length);
  return (
    ranked.find((s) => candidate.startsWith(s.slug) || candidate.endsWith(s.slug)) ||
    ranked.find((s) => candidate.includes(s.slug)) ||
    null
  );
}

function resolveVenue(rawLocation, venues) {
  const trimmed = (rawLocation || '').trim();
  if (!trimmed) return { name: 'To be Announced', mapUrl: '' };

  const norm = (v) => v.replace(/\s+/g, ' ').trim().toLowerCase();
  const candidates = new Set([trimmed]);
  for (const part of trimmed.split(/\n+/)) {
    const piece = part.trim();
    if (!piece) continue;
    candidates.add(piece);
    const firstComma = piece.split(',')[0].trim();
    if (firstComma.length >= 2) candidates.add(firstComma);
  }

  for (const candidate of candidates) {
    const hit = venues.find((v) => norm(v.name) === norm(candidate));
    if (hit) return { name: hit.name, mapUrl: hit.map_url || '' };
  }

  const haystack = norm(trimmed);
  const ranked = [...venues].sort((a, b) => b.name.length - a.name.length);
  const loose = ranked.find((v) => haystack.includes(norm(v.name)));
  if (loose) return { name: loose.name, mapUrl: loose.map_url || '' };

  return { name: 'To be Announced', mapUrl: '' };
}

export const VENUES = [
  { name: 'Dialogues Cafe',      map_url: 'https://maps.app.goo.gl/iL4GWxFT7PQ13xtCA' },
  { name: 'Big Bean Cafe, HSR',  map_url: 'https://maps.app.goo.gl/T7xLc4NvQr9XgqiJ7' },
  { name: 'Big Bean Cafe',       map_url: 'https://maps.app.goo.gl/SN7w4itJnqGMP2Qw9' },
  { name: "Cafe Du L'Amour",     map_url: 'https://maps.app.goo.gl/vh3Pv3Y9UgYhEFuK7' },
  { name: 'SLAY Coffee',         map_url: 'https://maps.app.goo.gl/m44qdH19FcHfErqk7' },
  { name: 'The Coffee Brewery',  map_url: 'https://maps.app.goo.gl/8gpKvEDMUzYUwyKv7' },
  { name: 'Now Boarding Cafe',   map_url: 'https://maps.app.goo.gl/11Y7eLoUekZf8M4KA' },
  { name: 'Buddiezz Cafe',       map_url: 'https://maps.app.goo.gl/uio6gTTufNMuribs5' },
  { name: 'Bagelstein',          map_url: 'https://maps.app.goo.gl/5sPfiUZsgoZFxo73A' },
];

/**
 * Cancellation is a dashboard archive operation, never the source of truth for
 * scheduling. Prove the exact occurrence is absent from the complete current
 * Calendar feed before allowing it. No date filtering is applied here.
 */
export async function occurrenceIsInCalendar(env, occurrence) {
  const res = await fetch(env.CALENDAR_ICS_URL);
  if (!res.ok) throw new Error(`ICS fetch failed (${res.status})`);

  const icsText = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(icsText) || !/END:VCALENDAR/i.test(icsText)) {
    throw new Error('ICS response was not a calendar');
  }
  const entries = parseIcs(icsText);
  const timezone = occurrence.timezone || env.TIMEZONE || 'Asia/Kolkata';
  const occurrenceDay = dayKeyInZone(new Date(occurrence.starts_at_utc), timezone);
  const uid = String(occurrence.gcal_uid || '').trim();

  return entries.some((entry) => {
    const sameDay = dayKeyInZone(entry.start, timezone) === occurrenceDay;
    // Recurring Calendar instances can share a UID, so the local date is part
    // of the identity even for the preferred UID match.
    if (uid && entry.uid && entry.uid === uid) return sameDay;
    if (uid) return false;
    const candidate = slugify(entry.summary);
    const slugMatches = candidate === occurrence.event_slug
      || candidate.startsWith(occurrence.event_slug)
      || candidate.endsWith(occurrence.event_slug)
      || candidate.includes(occurrence.event_slug);
    return slugMatches && sameDay;
  });
}

export async function syncCalendar(env) {
  const timezone = env.TIMEZONE || 'Asia/Kolkata';
  const res = await fetch(env.CALENDAR_ICS_URL);
  if (!res.ok) throw new Error(`ICS fetch failed (${res.status})`);
  const icsText = await res.text();

  const slugs = await knownEventSlugs(env.DB);
  const entries = parseIcs(icsText);

  const now = new Date();
  const todayKey = dayKeyInZone(now, timezone);
  const nowIso = toIsoUtc(now);

  const report = { seen: 0, upserted: 0, unmatched: [], skippedPast: 0, collisions: [] };
  const claimed = new Set();

  for (const entry of entries) {
    report.seen += 1;

    const dayKey = dayKeyInZone(entry.start, timezone);
    if (dayKey < todayKey) { report.skippedPast += 1; continue; }

    const event = resolveEventSlug(entry.summary, slugs);
    if (!event) { report.unmatched.push(entry.summary); continue; }

    const id = occurrenceId(event.slug, dayKey);

    if (claimed.has(id)) { report.collisions.push({ id, summary: entry.summary }); continue; }
    claimed.add(id);

    const directives = parseTicketDirectives(entry.description);
    const venue = resolveVenue(entry.location, VENUES);

    const pricePaise = directives.pricePaise ?? event.default_price_paise ?? 0;
    const capacity = directives.capacity ?? event.default_capacity ?? 20;

    await upsertOccurrence(env.DB, {
      id,
      event_slug: event.slug,
      starts_at_utc: toIsoUtc(entry.start),
      timezone,
      venue_name: venue.name,
      venue_map_url: venue.mapUrl,
      capacity,
      price_paise: pricePaise,
      status: pricePaise > 0 && !directives.closed ? 'open' : 'draft',
      gcal_uid: entry.uid,
      synced_at: nowIso,
    });

    await applyCalendarOverrides(env.DB, id, {
      capacity: directives.capacity,
      pricePaise: directives.pricePaise,
    });

    if (directives.closed) {
      await env.DB.prepare(
        `UPDATE occurrences SET status = 'closed' WHERE id = ?1 AND status != 'cancelled'`,
      ).bind(id).run();
    }

    report.upserted += 1;
  }

  return report;
}
