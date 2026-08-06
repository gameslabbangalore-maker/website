/**
 * Self-contained QR encoder for ticket codes.
 *
 * Scope is deliberately narrow: error-correction level Q, versions 1-6,
 * alphanumeric or byte mode. That covers a `GL-XXXXXX` ticket code (version 1)
 * with plenty of headroom for a short URL, and keeps the tables small enough to
 * live in a Worker with no dependency.
 */

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// Per version, at EC level Q: ec codewords per block, then [blockCount, dataCodewords] groups.
const EC_Q = {
  1: { ec: 13, groups: [[1, 13]] },
  2: { ec: 22, groups: [[1, 22]] },
  3: { ec: 18, groups: [[2, 17]] },
  4: { ec: 26, groups: [[2, 24]] },
  5: { ec: 18, groups: [[2, 15], [2, 16]] },
  6: { ec: 24, groups: [[4, 19]] },
};

// Alignment-pattern centre coordinates. Versions 2-6 carry exactly one extra
// pattern (the other three combinations sit under the finder patterns).
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
};

const FORMAT_BITS_Q = 3;

/* ---------------------------------------------------------------- GF(256) */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gmul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const coef = buf[i];
    if (!coef) continue;
    for (let j = 1; j < gen.length; j += 1) {
      buf[i + j] ^= gmul(gen[j], coef);
    }
  }
  return buf.slice(data.length);
}

/* ------------------------------------------------------------- encoding */

function isAlnum(text) {
  for (const ch of text) {
    if (ALNUM.indexOf(ch) < 0) return false;
  }
  return true;
}

function bitLength(text, alnum) {
  if (alnum) {
    const pairs = Math.floor(text.length / 2);
    return 4 + 9 + pairs * 11 + (text.length % 2 ? 6 : 0);
  }
  return 4 + 8 + new TextEncoder().encode(text).length * 8;
}

function dataCapacity(version) {
  return EC_Q[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

function pickVersion(needBits) {
  for (let v = 1; v <= 6; v += 1) {
    if (dataCapacity(v) * 8 >= needBits) return v;
  }
  return 0;
}

function makeBitWriter() {
  const bits = [];
  return {
    bits,
    push(value, length) {
      for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
    },
  };
}

function encodeData(text, version, alnum) {
  const w = makeBitWriter();

  if (alnum) {
    w.push(0b0010, 4);
    w.push(text.length, 9);
    for (let i = 0; i + 1 < text.length; i += 2) {
      w.push(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    }
    if (text.length % 2) w.push(ALNUM.indexOf(text[text.length - 1]), 6);
  } else {
    const bytes = new TextEncoder().encode(text);
    w.push(0b0100, 4);
    w.push(bytes.length, 8);
    for (const b of bytes) w.push(b, 8);
  }

  const capacityBits = dataCapacity(version) * 8;
  for (let i = 0; i < 4 && w.bits.length < capacityBits; i += 1) w.bits.push(0);
  while (w.bits.length % 8 !== 0) w.bits.push(0);

  const codewords = [];
  for (let i = 0; i < w.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | w.bits[i + j];
    codewords.push(byte);
  }
  const pad = [0xec, 0x11];
  while (codewords.length < dataCapacity(version)) {
    codewords.push(pad[(codewords.length - w.bits.length / 8) % 2]);
  }

  return Uint8Array.from(codewords);
}

function interleave(dataCodewords, version) {
  const { ec, groups } = EC_Q[version];

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let b = 0; b < count; b += 1) {
      const block = dataCodewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(block, ec));
    }
  }

  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) out.push(block[i]);
    }
  }
  for (let i = 0; i < ec; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return Uint8Array.from(out);
}

/* --------------------------------------------------------------- matrix */

function maskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function drawFunctionPatterns(mods, fixed, size, version) {
  const set = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    mods[r][c] = dark ? 1 : 0;
    fixed[r][c] = true;
  };

  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r0 + dr, c0 + dc, inside && ring !== 2);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  const coords = ALIGN[version];
  const last = coords[coords.length - 1];
  for (const r of coords) {
    for (const c of coords) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  set(size - 8, 8, true);

  for (let i = 0; i <= 8; i += 1) {
    if (!fixed[8][i]) set(8, i, false);
    if (!fixed[i][8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!fixed[8][size - 1 - i]) set(8, size - 1 - i, false);
    if (!fixed[size - 1 - i][8]) set(size - 1 - i, 8, false);
  }
}

function drawFormatInfo(mods, size, mask) {
  const data = (FORMAT_BITS_Q << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;

  // First copy: down column 8, then left along row 8 (skipping the timing line).
  for (let i = 0; i <= 5; i += 1) mods[i][8] = (bits >>> i) & 1;
  mods[7][8] = (bits >>> 6) & 1;
  mods[8][8] = (bits >>> 7) & 1;
  mods[8][7] = (bits >>> 8) & 1;
  for (let i = 9; i < 15; i += 1) mods[8][14 - i] = (bits >>> i) & 1;

  // Second copy: right along row 8, then up column 8.
  for (let i = 0; i < 8; i += 1) mods[8][size - 1 - i] = (bits >>> i) & 1;
  for (let i = 8; i < 15; i += 1) mods[size - 15 + i][8] = (bits >>> i) & 1;
  mods[size - 8][8] = 1;
}

function penalty(mods, size) {
  let score = 0;

  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  for (let r = 0; r < size; r += 1) score += runScore(mods[r]);
  for (let c = 0; c < size; c += 1) {
    const col = [];
    for (let r = 0; r < size; r += 1) col.push(mods[r][c]);
    score += runScore(col);
  }

  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = mods[r][c];
      if (v === mods[r][c + 1] && v === mods[r + 1][c] && v === mods[r + 1][c + 1]) score += 3;
    }
  }

  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const hasFinderLike = (line, at) => {
    for (let i = 0; i < 7; i += 1) {
      if (line[at + i] !== pattern[i]) return false;
    }
    const before = line.slice(Math.max(0, at - 4), at);
    const after = line.slice(at + 7, at + 11);
    const clear = (arr, need) => arr.length >= need && arr.every((v) => v === 0);
    return clear(before, 4) || clear(after, 4);
  };
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c + 7 <= size; c += 1) {
      if (hasFinderLike(mods[r], c)) score += 40;
    }
  }
  for (let c = 0; c < size; c += 1) {
    const col = [];
    for (let r = 0; r < size; r += 1) col.push(mods[r][c]);
    for (let r = 0; r + 7 <= size; r += 1) {
      if (hasFinderLike(col, r)) score += 40;
    }
  }

  let dark = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) dark += mods[r][c];
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encode `text` into a QR matrix.
 * @returns {{ size: number, modules: number[][] }} 1 = dark.
 */
export function qrEncode(text) {
  const value = String(text == null ? '' : text);
  if (!value) throw new Error('qr: empty payload');

  const alnum = isAlnum(value);
  const version = pickVersion(bitLength(value, alnum));
  if (!version) throw new Error(`qr: payload too long (${value.length} chars)`);

  const size = version * 4 + 17;
  const codewords = interleave(encodeData(value, version, alnum), version);

  const base = [];
  const fixed = [];
  for (let i = 0; i < size; i += 1) {
    base.push(new Array(size).fill(0));
    fixed.push(new Array(size).fill(false));
  }
  drawFunctionPatterns(base, fixed, size, version);

  const totalBits = codewords.length * 8;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fixed[r][c] || bitIndex >= totalBits) continue;
        base[r][c] = (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
        bitIndex += 1;
      }
    }
  }

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const trial = base.map((row) => row.slice());
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!fixed[r][c] && maskBit(mask, r, c)) trial[r][c] ^= 1;
      }
    }
    drawFormatInfo(trial, size, mask);
    const score = penalty(trial, size);
    if (!best || score < best.score) best = { score, modules: trial };
  }

  return { size, modules: best.modules };
}

/* ---------------------------------------------------------------- output */

export function qrSvg(text, { scale = 8, quiet = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const { size, modules } = qrEncode(text);
  const span = size + quiet * 2;

  let path = '';
  for (let r = 0; r < size; r += 1) {
    let c = 0;
    while (c < size) {
      if (!modules[r][c]) { c += 1; continue; }
      let run = 1;
      while (c + run < size && modules[r][c + run]) run += 1;
      path += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
      c += run;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${span * scale}" height="${span * scale}" `
    + `viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img">`
    + `<rect width="${span}" height="${span}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/></svg>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value) {
  return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function concat(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

function pngChunk(type, data) {
  const name = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)));
  const body = concat([name, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** Stored (uncompressed) deflate stream wrapped in a zlib container. */
function zlibStore(raw) {
  const blocks = [];
  const MAX = 65535;
  for (let at = 0; at < raw.length; at += MAX) {
    const chunk = raw.subarray(at, Math.min(at + MAX, raw.length));
    const last = at + MAX >= raw.length ? 1 : 0;
    const len = chunk.length;
    blocks.push(Uint8Array.of(last, len & 255, (len >>> 8) & 255, ~len & 255, (~len >>> 8) & 255));
    blocks.push(chunk);
  }
  return concat([Uint8Array.of(0x78, 0x01), ...blocks, u32(adler32(raw))]);
}

export function qrPng(text, { scale = 8, quiet = 4 } = {}) {
  const { size, modules } = qrEncode(text);
  const span = (size + quiet * 2) * scale;

  // Greyscale, 8 bits per pixel, no filtering.
  const raw = new Uint8Array((span + 1) * span);
  raw.fill(255);
  for (let y = 0; y < span; y += 1) {
    const rowStart = y * (span + 1);
    raw[rowStart] = 0;
    const mr = Math.floor(y / scale) - quiet;
    if (mr < 0 || mr >= size) continue;
    for (let x = 0; x < span; x += 1) {
      const mc = Math.floor(x / scale) - quiet;
      if (mc < 0 || mc >= size) continue;
      if (modules[mr][mc]) raw[rowStart + 1 + x] = 0;
    }
  }

  const ihdr = concat([u32(span), u32(span), Uint8Array.of(8, 0, 0, 0, 0)]);
  return concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStore(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}
