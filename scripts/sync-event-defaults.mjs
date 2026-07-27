import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EVENTS_DIR = path.join(ROOT, '_events');

function readFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) continue;
    const sep = line.indexOf(':');
    if (sep < 1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (!value) continue;
    value = value.replace(/\s+#.*$/, '').trim();
    value = value.replace(/^["'](.*)["']$/, '$1');
    out[key] = value;
  }
  return out;
}

function toRupeesInt(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

async function collect() {
  const files = (await fs.readdir(EVENTS_DIR)).filter((f) => f.endsWith('.md'));
  const events = [];
  const skipped = [];

  for (const file of files.sort()) {
    const text = await fs.readFile(path.join(EVENTS_DIR, file), 'utf8');
    const fm = readFrontMatter(text);
    if (!fm) { skipped.push(`${file}: no front matter`); continue; }

    if (fm.draft === 'true' || fm.published === 'false') {
      skipped.push(`${file}: draft/unpublished`);
      continue;
    }

    const slug = (fm.slug || path.basename(file, '.md')).toLowerCase();
    const title = fm.title;
    if (!title) { skipped.push(`${file}: missing title`); continue; }

    const pricePaise = toRupeesInt(fm.price ?? '0');
    if (pricePaise === null) { skipped.push(`${file}: unparseable price "${fm.price}"`); continue; }

    const capacity = Number(fm.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      skipped.push(`${file}: missing or invalid capacity "${fm.capacity}"`);
      continue;
    }

    events.push({ slug, title, price_paise: pricePaise, capacity });
  }
  return { events, skipped };
}

async function main() {
  const apiBase = (process.env.TICKETING_API_BASE || '').replace(/\/+$/, '');
  const token = process.env.TICKETING_ADMIN_TOKEN || '';
  const dryRun = process.argv.includes('--dry-run');

  const { events, skipped } = await collect();

  for (const s of skipped) console.warn(`[events] skipped ${s}`);
  for (const e of events) {
    const label = e.price_paise > 0 ? `Rs${e.price_paise / 100}` : 'Rs0 (not sellable)';
    console.log(`[events] ${e.slug.padEnd(20)} ${label.padEnd(20)} cap ${e.capacity}`);
  }

  if (!events.length) {
    console.error('[events] nothing to sync');
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`\n[events] --dry-run: would POST ${events.length} event(s)`);
    return;
  }

  if (!apiBase || !token) {
    console.error('[events] TICKETING_API_BASE and TICKETING_ADMIN_TOKEN are required');
    process.exitCode = 1;
    return;
  }

  const res = await fetch(`${apiBase}/api/admin/event-defaults`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ events }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[events] sync failed (${res.status}): ${text}`);
    process.exitCode = 1;
    return;
  }

  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const report = body && body.report;

  if (report) {
    console.log(`\n[events] synced ${report.updated.length} event(s), opened ${report.opened} occurrence(s)`);
    for (const r of report.rejected || []) {
      console.error(`[events] REJECTED ${r.slug}: ${r.reason}`);
    }
    if ((report.rejected || []).length) process.exitCode = 1;
  } else {
    console.log(`[events] synced: ${text}`);
  }
}

main().catch((err) => {
  console.error('[events] unhandled error:', err);
  process.exitCode = 1;
});
