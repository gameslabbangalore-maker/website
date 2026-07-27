const TICKET_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const TICKET_BODY_LENGTH = 6;

function randomFromAlphabet(alphabet, length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function ticketCode() {
  return `GL-${randomFromAlphabet(TICKET_ALPHABET, TICKET_BODY_LENGTH)}`;
}

export function bookingId() {
  return crypto.randomUUID();
}

export function accessToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function occurrenceId(slug, dayKey) {
  return `${slug}-${String(dayKey || '').replace(/-/g, '')}`;
}

export function slugify(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
