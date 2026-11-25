/**
 * Raw DEFLATE (RFC 1951) and base64, in plain JavaScript, synchronous, for
 * the browser and the server alike: what the save history compresses its
 * copy of the drawing with (save-history.js). `deflateRaw` writes one block
 * with its own Huffman codes; `inflateRaw` reads any stream (stored, fixed,
 * or dynamic blocks), so zlib's output reads too.
 */

const WINDOW = 1 << 15;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_BITS = 15;
const MAX_CHAIN = 96;

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/** The order the code length code's lengths are stored in. */
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** The length code (0-based past 257) of a match length. */
const LENGTH_CODE = new Uint8Array(MAX_MATCH + 1);
for (let code = 0; code < LENGTH_BASE.length; code++) {
  const end = code + 1 < LENGTH_BASE.length ? LENGTH_BASE[code + 1] : MAX_MATCH + 1;
  for (let length = LENGTH_BASE[code]; length < end; length++) LENGTH_CODE[length] = code;
}
LENGTH_CODE[MAX_MATCH] = 28;

function distCode(distance) {
  let code = 0;
  while (code + 1 < DIST_BASE.length && DIST_BASE[code + 1] <= distance) code++;
  return code;
}

// ----- Huffman codes ---------------------------------------------------------------

/** Code lengths for `freqs`, none longer than `limit`. */
function codeLengths(freqs, limit) {
  const lengths = new Uint8Array(freqs.length);
  let weights = Array.from(freqs);
  for (;;) {
    const used = [];
    for (let i = 0; i < weights.length; i++) if (weights[i] > 0) used.push(i);
    if (!used.length) return lengths;
    if (used.length === 1) {
      lengths[used[0]] = 1;
      return lengths;
    }
    // Nodes: leaves first, then the merged ones; each knows its parent.
    const weight = used.map((i) => weights[i]);
    const parent = new Int32Array(2 * used.length).fill(-1);
    const queue = used.map((_, n) => n).sort((a, b) => weight[a] - weight[b] || a - b);
    const merged = [];
    const take = () => (merged.length && (!queue.length || weight[merged[0]] < weight[queue[0]]) ? merged.shift() : queue.shift());
    while (queue.length + merged.length > 1) {
      const a = take();
      const b = take();
      const node = weight.length;
      weight.push(weight[a] + weight[b]);
      parent[a] = node;
      parent[b] = node;
      merged.push(node);
    }
    let longest = 0;
    used.forEach((symbol, n) => {
      let depth = 0;
      for (let node = n; parent[node] >= 0; node = parent[node]) depth++;
      lengths[symbol] = depth;
      longest = Math.max(longest, depth);
    });
    if (longest <= limit) return lengths;
    // Too deep: flatten the weights and build again.
    weights = weights.map((w) => (w > 0 ? Math.max(1, w >> 1) : 0));
    lengths.fill(0);
  }
}

/** Canonical codes for `lengths`, bit-reversed for writing LSB first. */
function canonicalCodes(lengths) {
  const max = Math.max(0, ...lengths);
  const count = new Uint16Array(max + 1);
  for (const length of lengths) if (length) count[length]++;
  const next = new Uint16Array(max + 2);
  let code = 0;
  for (let bits = 1; bits <= max; bits++) {
    code = (code + count[bits - 1]) << 1;
    next[bits] = code;
  }
  const codes = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol];
    if (!length) continue;
    let value = next[length]++;
    let reversed = 0;
    for (let i = 0; i < length; i++) { reversed = (reversed << 1) | (value & 1); value >>= 1; }
    codes[symbol] = reversed;
  }
  return codes;
}

// ----- compress --------------------------------------------------------------------

class BitWriter {
  constructor() { this.bytes = []; this.bits = 0; this.count = 0; }
  write(value, count) {
    this.bits |= value << this.count;
    this.count += count;
    while (this.count >= 8) {
      this.bytes.push(this.bits & 0xff);
      this.bits >>>= 8;
      this.count -= 8;
    }
  }
  finish() {
    if (this.count) this.bytes.push(this.bits & 0xff);
    return Uint8Array.from(this.bytes);
  }
}

/** The LZ77 tokens of `data`: literals (< 256) and matches, as
 *  [symbol or length + 256, distance] pairs in two arrays. */
function tokenize(data) {
  const symbols = [];
  const distances = [];
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(WINDOW).fill(-1);
  const hashAt = (i) => (((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & ((1 << HASH_BITS) - 1));
  const insert = (i) => {
    if (i + MIN_MATCH > data.length) return;
    const h = hashAt(i);
    prev[i & (WINDOW - 1)] = head[h];
    head[h] = i;
  };
  let i = 0;
  while (i < data.length) {
    let bestLength = 0;
    let bestDistance = 0;
    if (i + MIN_MATCH <= data.length) {
      let candidate = head[hashAt(i)];
      const limit = Math.min(MAX_MATCH, data.length - i);
      for (let chain = 0; candidate >= 0 && i - candidate <= WINDOW - 1 && chain < MAX_CHAIN; chain++) {
        if (data[candidate + bestLength] === data[i + bestLength]) {
          let length = 0;
          while (length < limit && data[candidate + length] === data[i + length]) length++;
          if (length > bestLength) {
            bestLength = length;
            bestDistance = i - candidate;
            if (length === limit) break;
          }
        }
        const before = prev[candidate & (WINDOW - 1)];
        if (before >= candidate) break;
        candidate = before;
      }
    }
    if (bestLength >= MIN_MATCH) {
      symbols.push(256 + bestLength);
      distances.push(bestDistance);
      for (let k = 0; k < bestLength; k++) insert(i + k);
      i += bestLength;
    } else {
      symbols.push(data[i]);
      distances.push(0);
      insert(i);
      i += 1;
    }
  }
  return { symbols, distances };
}

/** `data` (bytes) compressed as raw DEFLATE: one block, its own codes. */
export function deflateRaw(data) {
  const { symbols, distances } = tokenize(data);
  const litFreq = new Uint32Array(286);
  const distFreq = new Uint32Array(30);
  for (let t = 0; t < symbols.length; t++) {
    const symbol = symbols[t];
    if (symbol < 256) litFreq[symbol]++;
    else {
      litFreq[257 + LENGTH_CODE[symbol - 256]]++;
      distFreq[distCode(distances[t])]++;
    }
  }
  litFreq[256] = 1;
  // At least two distance codes keep every decoder happy.
  if (distFreq.filter(Boolean).length < 2) { distFreq[0] ||= 1; distFreq[1] ||= 1; }
  const litLengths = codeLengths(litFreq, 15);
  const distLengths = codeLengths(distFreq, 15);
  let hlit = 286;
  while (hlit > 257 && !litLengths[hlit - 1]) hlit--;
  let hdist = 30;
  while (hdist > 1 && !distLengths[hdist - 1]) hdist--;

  // The two code length lists, run-length coded (16, 17, 18).
  const all = [...litLengths.slice(0, hlit), ...distLengths.slice(0, hdist)];
  const runs = [];
  for (let k = 0; k < all.length;) {
    const length = all[k];
    let run = 1;
    while (k + run < all.length && all[k + run] === length) run++;
    let left = run;
    if (length === 0) {
      while (left >= 11) { const n = Math.min(138, left); runs.push([18, n - 11, 7]); left -= n; }
      if (left >= 3) { runs.push([17, left - 3, 3]); left = 0; }
    } else {
      runs.push([length]);
      left -= 1;
      while (left >= 3) { const n = Math.min(6, left); runs.push([16, n - 3, 2]); left -= n; }
    }
    for (; left > 0; left--) runs.push([length]);
    k += run;
  }
  const clFreq = new Uint32Array(19);
  for (const [code] of runs) clFreq[code]++;
  const clLengths = codeLengths(clFreq, 7);
  const clCodes = canonicalCodes(clLengths);
  let hclen = 19;
  while (hclen > 4 && !clLengths[CL_ORDER[hclen - 1]]) hclen--;

  const out = new BitWriter();
  out.write(1, 1); // the last block
  out.write(2, 2); // dynamic codes
  out.write(hlit - 257, 5);
  out.write(hdist - 1, 5);
  out.write(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) out.write(clLengths[CL_ORDER[k]], 3);
  for (const [code, extra, bits] of runs) {
    out.write(clCodes[code], clLengths[code]);
    if (bits) out.write(extra, bits);
  }
  const litCodes = canonicalCodes(litLengths);
  const distCodes = canonicalCodes(distLengths);
  for (let t = 0; t < symbols.length; t++) {
    const symbol = symbols[t];
    if (symbol < 256) {
      out.write(litCodes[symbol], litLengths[symbol]);
      continue;
    }
    const length = symbol - 256;
    const lc = LENGTH_CODE[length];
    out.write(litCodes[257 + lc], litLengths[257 + lc]);
    if (LENGTH_EXTRA[lc]) out.write(length - LENGTH_BASE[lc], LENGTH_EXTRA[lc]);
    const dc = distCode(distances[t]);
    out.write(distCodes[dc], distLengths[dc]);
    if (DIST_EXTRA[dc]) out.write(distances[t] - DIST_BASE[dc], DIST_EXTRA[dc]);
  }
  out.write(litCodes[256], litLengths[256]);
  return out.finish();
}

// ----- decompress ------------------------------------------------------------------

/** A decoding table for `lengths`: symbols by (length, code). */
function decoder(lengths) {
  const count = new Uint16Array(16);
  for (const length of lengths) count[length]++;
  count[0] = 0;
  const offsets = new Uint16Array(16);
  for (let bits = 1; bits < 16; bits++) offsets[bits] = offsets[bits - 1] + count[bits - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) if (lengths[symbol]) symbols[offsets[lengths[symbol]]++] = symbol;
  return { count, symbols };
}

/** Raw DEFLATE `data` (bytes) decompressed. Throws on a broken stream. */
export function inflateRaw(data) {
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;
  let out = new Uint8Array(Math.max(1024, data.length * 4));
  let size = 0;
  const need = (n) => {
    if (size + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, size + n));
    bigger.set(out.subarray(0, size));
    out = bigger;
  };
  const bits = (n) => {
    while (bitCount < n) {
      if (pos >= data.length) throw new Error('the compressed data ends early');
      bitBuf |= data[pos++] << bitCount;
      bitCount += 8;
    }
    const value = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return value;
  };
  const decode = ({ count, symbols }) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length < 16; length++) {
      code |= bits(1);
      const n = count[length];
      if (code - first < n) return symbols[index + code - first];
      index += n;
      first = (first + n) << 1;
      code <<= 1;
    }
    throw new Error('a broken code in the compressed data');
  };
  let fixed = null;
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (pos + 4 > data.length) throw new Error('the compressed data ends early');
      const length = data[pos] | (data[pos + 1] << 8);
      pos += 4;
      if (pos + length > data.length) throw new Error('the compressed data ends early');
      need(length);
      out.set(data.subarray(pos, pos + length), size);
      size += length;
      pos += length;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) {
      if (!fixed) {
        const lengths = new Uint8Array(288);
        lengths.fill(8, 0, 144); lengths.fill(9, 144, 256); lengths.fill(7, 256, 280); lengths.fill(8, 280, 288);
        fixed = { lit: decoder(lengths), dist: decoder(new Uint8Array(30).fill(5)) };
      }
      ({ lit, dist } = fixed);
    } else if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const clLengths = new Uint8Array(19);
      for (let k = 0; k < hclen; k++) clLengths[CL_ORDER[k]] = bits(3);
      const cl = decoder(clLengths);
      const lengths = new Uint8Array(hlit + hdist);
      for (let k = 0; k < hlit + hdist;) {
        const symbol = decode(cl);
        if (symbol < 16) { lengths[k++] = symbol; continue; }
        let repeat;
        let value = 0;
        if (symbol === 16) {
          if (!k) throw new Error('a broken code in the compressed data');
          value = lengths[k - 1];
          repeat = 3 + bits(2);
        } else repeat = symbol === 17 ? 3 + bits(3) : 11 + bits(7);
        if (k + repeat > lengths.length) throw new Error('a broken code in the compressed data');
        lengths.fill(value, k, k + repeat);
        k += repeat;
      }
      lit = decoder(lengths.subarray(0, hlit));
      dist = decoder(lengths.subarray(hlit));
    } else throw new Error('a broken block in the compressed data');
    for (;;) {
      const symbol = decode(lit);
      if (symbol < 256) { need(1); out[size++] = symbol; continue; }
      if (symbol === 256) break;
      const lc = symbol - 257;
      if (lc >= 29) throw new Error('a broken length in the compressed data');
      const length = LENGTH_BASE[lc] + bits(LENGTH_EXTRA[lc]);
      const dc = decode(dist);
      if (dc >= 30) throw new Error('a broken distance in the compressed data');
      const distance = DIST_BASE[dc] + bits(DIST_EXTRA[dc]);
      if (distance > size) throw new Error('a distance past the start of the data');
      need(length);
      for (let k = 0; k < length; k++, size++) out[size] = out[size - distance];
    }
  }
  return out.slice(0, size);
}

// ----- base64 ---------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUE = new Map([...ALPHABET].map((ch, i) => [ch, i]));

export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
      + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
  }
  return out;
}

export function fromBase64(text) {
  const clean = String(text).replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0;
  let bitsHeld = 0;
  let at = 0;
  for (const ch of clean) {
    const value = VALUE.get(ch);
    if (value === undefined) throw new Error('not base64');
    n = (n << 6) | value;
    bitsHeld += 6;
    if (bitsHeld >= 8) {
      bitsHeld -= 8;
      bytes[at++] = (n >> bitsHeld) & 0xff;
    }
  }
  return bytes.subarray(0, at);
}

/** A text compressed, as base64. */
export function packText(text) {
  return toBase64(deflateRaw(new TextEncoder().encode(String(text))));
}

/** The text `packText` packed. Throws on anything else. */
export function unpackText(packed) {
  return new TextDecoder('utf-8', { fatal: true }).decode(inflateRaw(fromBase64(packed)));
}
