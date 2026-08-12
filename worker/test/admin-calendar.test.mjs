import { occurrenceIsInCalendar } from '../src/calendar-sync.js';

const originalFetch = globalThis.fetch;
const failures = [];

function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  if (!ok) failures.push(label);
}

function calendar(events) {
  return `BEGIN:VCALENDAR\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

function vevent({ uid, summary, start, status = '' }) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    `DTSTART;TZID=Asia/Kolkata:${start}`,
    status ? `STATUS:${status}` : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n');
}

async function withFeed(body, status, fn) {
  globalThis.fetch = async () => new Response(body, { status });
  return await fn();
}

const env = { CALENDAR_ICS_URL: 'https://calendar.invalid/feed.ics', TIMEZONE: 'Asia/Kolkata' };
const occurrence = {
  event_slug: 'board-game-night',
  starts_at_utc: '2026-08-14T14:00:00Z',
  timezone: 'Asia/Kolkata',
  gcal_uid: 'calendar-uid-1',
};

console.log('admin cancellation calendar evidence\n');

await withFeed(calendar([
  vevent({ uid: 'old-event', summary: 'Old Event', start: '20250101T190000' }),
  vevent({ uid: 'calendar-uid-1', summary: 'Renamed Event', start: '20260814T193000' }),
]), 200, async () => {
  check('searches the complete feed and matches by UID', await occurrenceIsInCalendar(env, occurrence), true);
});

await withFeed(calendar([
  vevent({ uid: 'calendar-uid-1', summary: 'Board Game Night', start: '20260821T193000' }),
]), 200, async () => {
  check('does not confuse another recurrence sharing the UID', await occurrenceIsInCalendar(env, occurrence), false);
});

await withFeed(calendar([
  vevent({ uid: 'different-uid', summary: 'Board Game Night', start: '20260814T193000' }),
]), 200, async () => {
  check('does not fall back to title when a stored UID exists', await occurrenceIsInCalendar(env, occurrence), false);
});

await withFeed(calendar([
  vevent({ uid: 'fallback-uid', summary: 'Board Game Night', start: '20260814T193000' }),
]), 200, async () => {
  check('falls back to slug and local date for legacy rows', await occurrenceIsInCalendar(env, { ...occurrence, gcal_uid: null }), true);
});

await withFeed(calendar([
  vevent({ uid: 'calendar-uid-1', summary: 'Board Game Night', start: '20260814T193000', status: 'CANCELLED' }),
]), 200, async () => {
  check('treats an explicitly cancelled calendar entry as absent', await occurrenceIsInCalendar(env, occurrence), false);
});

let fetchFailed = false;
try {
  await withFeed('unavailable', 503, () => occurrenceIsInCalendar(env, occurrence));
} catch (err) {
  fetchFailed = /ICS fetch failed/.test(err.message);
}
check('fails closed when the calendar cannot be fetched', fetchFailed, true);

let malformedFailed = false;
try {
  await withFeed('<html>not a calendar</html>', 200, () => occurrenceIsInCalendar(env, occurrence));
} catch (err) {
  malformedFailed = /not a calendar/.test(err.message);
}
check('fails closed for a malformed calendar response', malformedFailed, true);

globalThis.fetch = originalFetch;

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nall checks passed');
}
