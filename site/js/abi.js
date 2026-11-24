// Minimal ABI helpers: keccak256, selectors, topic hashes, word decoding. No dependencies.

const MASK = (1n << 64n) - 1n;
const rol = (x, n) => (n ? ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK : x);

function permute(s) {
  let lfsr = 1;
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rol(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    let x = 1;
    let y = 0;
    let current = s[1];
    for (let t = 0; t < 24; t++) {
      [x, y] = [y, (2 * x + 3 * y) % 5];
      const i = x + 5 * y;
      [current, s[i]] = [s[i], rol(current, (((t + 1) * (t + 2)) / 2) % 64)];
    }
    for (let row = 0; row < 25; row += 5) {
      const r = s.slice(row, row + 5);
      for (let i = 0; i < 5; i++) s[row + i] = r[i] ^ (~r[(i + 1) % 5] & MASK & r[(i + 2) % 5]);
    }
    for (let j = 0; j < 7; j++) {
      lfsr = ((lfsr << 1) ^ ((lfsr >> 7) * 0x71)) & 0xff;
      if (lfsr & 2) s[0] ^= 1n << BigInt((1 << j) - 1);
    }
  }
}

/** keccak256 of a string (UTF-8) or Uint8Array, as 0x-prefixed hex. */
export function keccak256(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const state = new Array(25).fill(0n);
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) state[i] ^= view.getBigUint64(offset + 8 * i, true);
    permute(state);
  }
  const out = new DataView(new ArrayBuffer(32));
  for (let i = 0; i < 4; i++) out.setBigUint64(8 * i, state[i], true);
  return "0x" + [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const topic = (signature) => keccak256(signature);
export const selector = (signature) => keccak256(signature).slice(0, 10);

/** EIP-55 checksum form of an address. */
export function checksum(address) {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = keccak256(lower).slice(2);
  return "0x" + [...lower].map((ch, i) => (parseInt(hash[i], 16) >= 8 ? ch.toUpperCase() : ch)).join("");
}

export const sameAddress = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const strip = (hex) => (hex && hex.startsWith("0x") ? hex.slice(2) : hex || "");

/** i-th 32-byte word of ABI data as hex without prefix; throws when the data is too short. */
export function word(data, i) {
  const w = strip(data).slice(64 * i, 64 * i + 64);
  if (w.length !== 64) throw new Error(`ABI data too short for word ${i}`);
  return w;
}
export const wordCount = (data) => Math.floor(strip(data).length / 64);
export const uint = (data, i) => BigInt("0x" + word(data, i));
export const bool = (data, i) => uint(data, i) !== 0n;
export const address = (data, i) => checksum("0x" + word(data, i).slice(24));
export const topicAddress = (t) => checksum("0x" + strip(t).slice(24));

/** Dynamic `string` whose offset is stored in head word `i`. */
export function string(data, i) {
  const hex = strip(data);
  const start = Number(uint(data, i)) * 2;
  const length = Number(BigInt("0x" + hex.slice(start, start + 64)));
  const body = hex.slice(start + 64, start + 64 + length * 2);
  if (body.length !== length * 2) throw new Error("ABI string out of bounds");
  const bytes = new Uint8Array(length);
  for (let k = 0; k < length; k++) bytes[k] = parseInt(body.slice(2 * k, 2 * k + 2), 16);
  return new TextDecoder().decode(bytes);
}

/** Dynamic `address[]` whose offset is stored in head word `i`. */
export function addressArray(data, i) {
  const base = Number(uint(data, i)) / 32;
  const length = Number(uint(data, base));
  return Array.from({ length }, (_, k) => address(data, base + 1 + k));
}

/** Calldata for a function whose arguments are all static (uint, address, bool). */
export function encodeCall(signature, args = []) {
  const words = args.map((arg) => {
    const value = typeof arg === "string" ? BigInt(arg) : BigInt(arg);
    return value.toString(16).padStart(64, "0");
  });
  return selector(signature) + words.join("");
}
