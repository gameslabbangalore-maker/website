#!/usr/bin/env node

import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const DEFAULT_ICS_URL = process.env.GOOGLE_CALENDAR_ICS_URL || 'https://calendar.google.com/calendar/ical/da645a8c3679d92a4f5aa27a0415af79342a316216a0f83f9d299327c1f0b56e%40group.calendar.google.com/public/basic.ics';
const DEFAULT_TIMEZONE = process.env.EVENT_TIMEZONE || 'Asia/Kolkata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVENTS_DIR = path.join(ROOT, '_events');
const DATA_DIR = path.join(ROOT, '_data');
const OUTPUT_FILE = path.join(DATA_DIR, 'event_schedule.json');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.yml');

const WARNINGS = [];

function log(message){
  console.log(`[sync-events] ${message}`);
}

function warn(message){
  WARNINGS.push(message);
  console.warn(`[sync-events] WARN: ${message}`);
}

function fatal(message, err){
  console.error(`[sync-events] ERROR: ${message}`);
  if (err) console.error(err);
  process.exitCode = 1;
}

function parseArgs(){
  const args = process.argv.slice(2);
  const opts = { icsFile: null, icsUrl: DEFAULT_ICS_URL, output: OUTPUT_FILE };
  for (let i = 0; i < args.length; i++){
    const arg = args[i];
    if (arg === '--ics' || arg === '--ics-file'){
      opts.icsFile = args[++i];
    } else if (arg === '--ics-url'){
      opts.icsUrl = args[++i];
    } else if (arg === '--output'){
      opts.output = path.resolve(args[++i]);
    } else if (arg === '--help' || arg === '-h'){
      console.log('Usage: node scripts/sync-events.mjs [--ics <file>] [--ics-url <url>] [--output <file>]');
      process.exit(0);
    }
  }
  return opts;
}

function rubyYamlToJson(yamlString){
  const res = spawnSync('ruby', [
    '-ryaml',
    '-rjson',
    '-e',
    `begin
       input = STDIN.read
       data = YAML.safe_load(input, permitted_classes: [], aliases: true)
       puts JSON.dump(data.nil? ? {} : data)
     rescue Psych::SyntaxError => e
       STDERR.puts(e.message)
       exit 1
     end`
  ], { input: yamlString, encoding: 'utf8' });
  if (res.status !== 0){
    const errMsg = res.stderr || res.stdout || 'unknown YAML parsing error';
    throw new Error(`Failed to parse YAML: ${errMsg}`);
  }
  return JSON.parse(res.stdout || '{}');
}

async function loadLocations(){
  try{
    const content = await fsp.readFile(LOCATIONS_FILE, 'utf8');
    const data = rubyYamlToJson(content);
    if (!Array.isArray(data)){
      // Support legacy object map
      return Object.entries(data || {}).map(([key, value]) => ({
        key,
        name: value?.name || '',
        map_url: value?.map_url || '',
        aliases: value?.aliases || []
      }));
    }
    return data.map(item => ({
      key: item.key || null,
      name: item.name || '',
      map_url: item.map_url || '',
      aliases: item.aliases || [],
    }));
  }catch(err){
    warn(`Unable to read locations.yml: ${err.message}`);
    return [];
  }
}

function normalizeString(value){
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLocationIndex(locations){
  const index = new Map();
  for (const loc of locations){
    const candidates = new Set();
    if (loc.name) candidates.add(normalizeString(loc.name));
    if (loc.key) candidates.add(normalizeString(loc.key));
    for (const alias of loc.aliases || []){
      candidates.add(normalizeString(alias));
    }
    for (const cand of candidates){
      if (cand) index.set(cand, loc);
    }
  }
  return index;
}

function resolveLocation(rawLocation, index){
  const cleaned = (rawLocation || '').toString().replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned){
    return {
      name: 'To Be Announced',
      map_url: '',
      raw: '',
      matched: false
    };
  }
  const normalized = normalizeString(cleaned);
  if (index.has(normalized)){
    const loc = index.get(normalized);
    return {
      name: loc.name || cleaned,
      map_url: loc.map_url || '',
      raw: cleaned,
      matched: true
    };
  }
  for (const [key, loc] of index.entries()){
    if (normalized.includes(key) || key.includes(normalized)){
      return {
        name: loc.name || cleaned,
        map_url: loc.map_url || '',
        raw: cleaned,
        matched: true
      };
    }
  }
  warn(`No location match for "${cleaned}"`);
  return {
    name: cleaned,
    map_url: '',
    raw: cleaned,
    matched: false
  };
}

async function loadEventFrontMatter(){
  const files = await fsp.readdir(EVENTS_DIR);
  const entries = [];
  for (const file of files){
    if (!file.endsWith('.md')) continue;
    const fullPath = path.join(EVENTS_DIR, file);
    const content = await fsp.readFile(fullPath, 'utf8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match){
      warn(`File ${file} missing front matter`);
      continue;
    }
    let data;
    try{
      data = rubyYamlToJson(match[1]);
    }catch(err){
      warn(`Could not parse front matter for ${file}: ${err.message}`);
      continue;
    }
    const slug = (data.slug || path.basename(file, path.extname(file))).toString();
    const title = data.title || slug;
    const entry = {
      slug,
      title,
      intro: data.intro || data.tagline || '',
      tagline: data.tagline || '',
      banner: data.banner || data.hero_image || '',
      ticket_link: data.ticket_link || '',
      highlights: data.highlights || {},
      about_video: data.about_video || '',
      recap_videos: Array.isArray(data.recap_videos) ? data.recap_videos : [],
      path: fullPath,
      page_url: `/events/${slug}/`
    };
    entries.push(entry);
  }
  const bySlug = new Map();
  const byTitle = new Map();
  for (const entry of entries){
    bySlug.set(normalizeString(entry.slug), entry);
    byTitle.set(normalizeString(entry.title), entry);
  }
  return { entries, bySlug, byTitle };
}

function parseICSText(text){
  if (!text) return [];
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const line of rawLines){
    if (/^[ \t]/.test(line) && lines.length){
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  const events = [];
  let current = null;
  for (const line of lines){
    if (line === 'BEGIN:VEVENT'){
      current = { props: {} };
      continue;
    }
    if (line === 'END:VEVENT'){
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const parts = left.split(';');
    const name = parts.shift().toUpperCase();
    const params = {};
    for (const part of parts){
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const pName = part.slice(0, eq).toUpperCase();
      const pValue = part.slice(eq + 1);
      params[pName] = pValue;
    }
    if (!current.props[name]) current.props[name] = [];
    current.props[name].push({ value, params });
  }
  return events.map(ev => {
    const getFirst = (key) => (ev.props[key] && ev.props[key][0]) || null;
    const summary = getFirst('SUMMARY')?.value || '';
    const description = getFirst('DESCRIPTION')?.value || '';
    const location = getFirst('LOCATION')?.value || '';
    const startToken = getFirst('DTSTART');
    const endToken = getFirst('DTEND');
    const start = startToken ? parseICSTimestamp(startToken.value, startToken.params) : null;
    const end = endToken ? parseICSTimestamp(endToken.value, endToken.params) : null;
    const timezone = startToken?.params?.TZID || endToken?.params?.TZID || DEFAULT_TIMEZONE;
    return {
      summary,
      description,
      location,
      start,
      end,
      timezone,
      raw: ev.props
    };
  }).filter(ev => ev.start instanceof Date && !isNaN(ev.start));
}

function parseICSTimestamp(rawValue, params = {}){
  if (!rawValue) return null;
  let value = rawValue.trim();
  const isUtc = value.endsWith('Z');
  if (isUtc) value = value.slice(0, -1);
  const hasTime = value.includes('T');
  let datePart = value;
  let timePart = '';
  if (hasTime){
    [datePart, timePart] = value.split('T');
  }
  if (!/^\d{8}$/.test(datePart)) return null;
  const year = parseInt(datePart.slice(0, 4), 10);
  const month = parseInt(datePart.slice(4, 6), 10);
  const day = parseInt(datePart.slice(6, 8), 10);
  let hour = 0, minute = 0, second = 0;
  if (timePart){
    if (!/^\d{6}$/.test(timePart)) return null;
    hour = parseInt(timePart.slice(0, 2), 10);
    minute = parseInt(timePart.slice(2, 4), 10);
    second = parseInt(timePart.slice(4, 6), 10);
  }
  const dateUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (isUtc) return new Date(dateUtc);
  const tzid = params.TZID || DEFAULT_TIMEZONE;
  const offsetMinutes = computeOffsetMinutes(new Date(dateUtc), tzid);
  return new Date(dateUtc - offsetMinutes * 60_000);
}

function computeOffsetMinutes(date, timeZone){
  try{
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const parts = dtf.formatToParts(date);
    const map = {};
    for (const part of parts){
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    const localUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second)
    );
    return Math.round((localUtc - date.getTime()) / 60000);
  }catch(err){
    warn(`Unknown timezone "${timeZone}": ${err.message}`);
    return 0;
  }
}

function formatIsoWithOffset(date, timeZone){
  const offset = computeOffsetMinutes(date, timeZone);
  const localMillis = date.getTime() + offset * 60_000;
  const local = new Date(localMillis);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  const second = String(local.getUTCSeconds()).padStart(2, '0');
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const offHour = String(Math.floor(abs / 60)).padStart(2, '0');
  const offMin = String(abs % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offHour}:${offMin}`;
}

function formatDateLabel(date, timeZone){
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const day = new Intl.DateTimeFormat('en-US', { timeZone, day: '2-digit' }).format(date);
  const month = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short' }).format(date);
  const year = new Intl.DateTimeFormat('en-US', { timeZone, year: '2-digit' }).format(date);
  return `${weekday}, ${day} ${month} '${year}`;
}

function formatTimeLabel(date, timeZone){
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function formatDayNumber(date, timeZone){
  return new Intl.DateTimeFormat('en-US', { timeZone, day: '2-digit' }).format(date);
}

function formatMonthShort(date, timeZone){
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short' }).format(date);
}

function slugify(value){
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function matchEvent(summary, metaIndex){
  const normalized = normalizeString(summary);
  if (!normalized) return null;
  if (metaIndex.byTitle.has(normalized)) return metaIndex.byTitle.get(normalized);
  if (metaIndex.bySlug.has(normalized)) return metaIndex.bySlug.get(normalized);
  const slugCandidate = slugify(summary);
  const slugNormalized = normalizeString(slugCandidate);
  if (metaIndex.bySlug.has(slugNormalized)) return metaIndex.bySlug.get(slugNormalized);
  return null;
}

function buildSchedule(icsEvents, metaIndex, locationIndex, sourceUrl = DEFAULT_ICS_URL){
  const upcoming = [];
  const bySlug = {};
  const now = Date.now();

  for (const entry of metaIndex.entries){
    bySlug[entry.slug] = {
      slug: entry.slug,
      title: entry.title,
      intro: entry.intro,
      tagline: entry.tagline,
      banner: entry.banner,
      ticket_url: entry.ticket_link,
      page_url: entry.page_url,
      highlights: entry.highlights,
      about_video: entry.about_video,
      recap_videos: entry.recap_videos,
      upcoming: []
    };
  }

  for (const icsEvent of icsEvents){
    const matched = matchEvent(icsEvent.summary, metaIndex);
    if (!matched){
      warn(`Skipping calendar entry without matching event: ${icsEvent.summary || '(untitled)'}`);
      continue;
    }
    const start = icsEvent.start;
    if (!(start instanceof Date) || isNaN(start)){ continue; }
    if (start.getTime() < now){
      // Skip past events, but keep history in by_slug for debugging if needed
      continue;
    }
    const timeZone = icsEvent.timezone || DEFAULT_TIMEZONE;
    const end = icsEvent.end instanceof Date && !isNaN(icsEvent.end) ? icsEvent.end : null;
    const durationMs = end ? Math.max(0, end.getTime() - start.getTime()) : null;
    const durationHours = durationMs ? Number((durationMs / (60 * 60 * 1000)).toFixed(2)) : null;
    const loc = resolveLocation(icsEvent.location, locationIndex);
    const startIso = formatIsoWithOffset(start, timeZone);
    const startUtc = start.toISOString();
    const entry = {
      slug: matched.slug,
      title: matched.title,
      summary: icsEvent.summary,
      description: icsEvent.description,
      start_iso: startIso,
      start_utc: startUtc,
      timezone: timeZone,
      date_label: formatDateLabel(start, timeZone),
      time_label: formatTimeLabel(start, timeZone),
      day: formatDayNumber(start, timeZone),
      month: formatMonthShort(start, timeZone),
      location_name: loc.name,
      location_url: loc.map_url,
      location_raw: loc.raw,
      ticket_url: matched.ticket_link,
      page_url: matched.page_url,
      banner: matched.banner,
      intro: matched.intro,
      duration_hours: durationHours
    };
    upcoming.push(entry);
    bySlug[matched.slug].upcoming.push(entry);
  }

  upcoming.sort((a, b) => new Date(a.start_utc) - new Date(b.start_utc));

  const scheduledSlugs = Array.from(new Set(upcoming.map(item => item.slug)));
  for (const slug of Object.keys(bySlug)){
    const bucket = bySlug[slug];
    bucket.upcoming.sort((a, b) => new Date(a.start_utc) - new Date(b.start_utc));
    bucket.next = bucket.upcoming[0] || null;
  }

  const other = metaIndex.entries
    .filter(entry => !scheduledSlugs.includes(entry.slug))
    .map(entry => ({
      slug: entry.slug,
      title: entry.title,
      intro: entry.intro,
      banner: entry.banner,
      page_url: entry.page_url,
      ticket_url: entry.ticket_link
    }));

  return {
    generated_at: new Date().toISOString(),
    source: {
      kind: 'google-calendar-ics',
      url: sourceUrl
    },
    timezone: DEFAULT_TIMEZONE,
    warnings: WARNINGS,
    upcoming,
    other,
    scheduled_slugs: scheduledSlugs,
    by_slug: bySlug
  };
}

async function fetchIcs(url){
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'GamesLabSync/1.0 (+https://gameslabbangalore-maker.github.io)',
      'Accept': 'text/calendar, text/plain;q=0.9'
    }
  });
  if (!res.ok){
    throw new Error(`ICS request failed with status ${res.status}`);
  }
  return await res.text();
}

async function main(){
  const opts = parseArgs();
  const locations = await loadLocations();
  const locationIndex = buildLocationIndex(locations);
  const metaIndex = await loadEventFrontMatter();

  let icsText = '';
  if (opts.icsFile){
    try{
      icsText = await fsp.readFile(path.resolve(opts.icsFile), 'utf8');
      log(`Loaded ICS data from ${opts.icsFile}`);
    }catch(err){
      warn(`Failed to read ICS file ${opts.icsFile}: ${err.message}`);
    }
  } else {
    try{
      log(`Fetching ICS feed from ${opts.icsUrl}`);
      icsText = await fetchIcs(opts.icsUrl || DEFAULT_ICS_URL);
    }catch(err){
      warn(`Unable to fetch ICS feed: ${err.message}`);
    }
  }

  const icsEvents = parseICSText(icsText);
  if (!icsEvents.length){
    warn('No events were parsed from the ICS feed.');
  }

  const schedule = buildSchedule(icsEvents, metaIndex, locationIndex, opts.icsUrl || DEFAULT_ICS_URL);
  schedule.warnings = WARNINGS;
  await fsp.writeFile(opts.output, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
  log(`Wrote ${schedule.upcoming.length} upcoming entries to ${opts.output}`);
}

main().catch(err => fatal('Unhandled error', err));
