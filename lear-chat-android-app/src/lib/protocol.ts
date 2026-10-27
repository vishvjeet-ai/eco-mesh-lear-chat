export const UUIDS = {
  service: '4c454152-4d45-5348-0001-000000000000',
  tx: '4c454152-4d45-5348-0002-000000000000',
  rx: '4c454152-4d45-5348-0003-000000000000',
  status: '4c454152-4d45-5348-0004-000000000000',
} as const;
export type BleUuids = Record<keyof typeof UUIDS, string>;

export const DEFAULT_DEVICE_PREFIX = 'LEAR';
export const MAX_TEXT_BYTES = 144;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type RxPacket =
  | { type: 'message'; src: number; text: string }
  | { type: 'delivery'; msgId: number; state: 'QUEUED' | 'DELIVERED' | 'FAILED' };
export type NodeStatus = { nodeId: number; battery: number; queueLength: number; linkState: 0 | 1 | 2 };

export function utf8Bytes(text: string): Uint8Array {
  const output: number[] = [];
  for (const character of text) {
    let code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code <= 0x7f) output.push(code);
    else if (code <= 0x7ff) output.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) output.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else output.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(output);
}

export function utf8Text(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]; let code: number; let remaining: number;
    if (first <= 0x7f) { code = first; remaining = 0; }
    else if (first >= 0xc2 && first <= 0xdf) { code = first & 0x1f; remaining = 1; }
    else if (first >= 0xe0 && first <= 0xef) { code = first & 0x0f; remaining = 2; }
    else if (first >= 0xf0 && first <= 0xf4) { code = first & 0x07; remaining = 3; }
    else throw new Error('Invalid UTF-8 text');
    if (i + remaining > bytes.length) throw new Error('Invalid UTF-8 text');
    for (let j = 0; j < remaining; j++) {
      const next = bytes[i++]; if ((next & 0xc0) !== 0x80) throw new Error('Invalid UTF-8 text');
      if (j === 0 && ((first === 0xe0 && next < 0xa0) || (first === 0xed && next >= 0xa0) || (first === 0xf0 && next < 0x90) || (first === 0xf4 && next >= 0x90))) throw new Error('Invalid UTF-8 text');
      code = (code << 6) | (next & 0x3f);
    }
    result += String.fromCodePoint(code);
  }
  return result;
}

export function utf8ByteLength(text: string): number {
  return utf8Bytes(text).length;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const hasB = i + 1 < bytes.length; const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0; const c = hasC ? bytes[i + 2] : 0;
    out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)];
    out += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
    out += hasC ? alphabet[c & 63] : '=';
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, '');
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean) || /=/.test(clean.slice(0, -2))) {
    throw new Error('Invalid base64 value');
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chars = clean.slice(i, i + 4);
    const a = alphabet.indexOf(chars[0]); const b = alphabet.indexOf(chars[1]);
    const c = chars[2] === '=' ? 0 : alphabet.indexOf(chars[2]);
    const d = chars[3] === '=' ? 0 : alphabet.indexOf(chars[3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid base64 value');
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < out.length) out[offset++] = packed >> 16;
    if (offset < out.length) out[offset++] = (packed >> 8) & 255;
    if (offset < out.length) out[offset++] = packed & 255;
  }
  return out;
}

export function encodeTx(destination: number, text: string): Uint8Array {
  const body = utf8Bytes(text);
  if (!Number.isInteger(destination) || destination < 0 || destination > 0xffff) throw new Error('Node ID must be between 0000 and FFFF');
  if (body.length > MAX_TEXT_BYTES) throw new Error('Message exceeds the 144-byte limit');
  return new Uint8Array([(destination >> 8) & 255, destination & 255, ...body]);
}

export function decodeRx(bytes: Uint8Array): RxPacket {
  if (bytes.length < 3) throw new Error('RX packet is too short');
  if (bytes[0] === 0x01) return { type: 'message', src: (bytes[1] << 8) | bytes[2], text: utf8Text(bytes.slice(3)) };
  if (bytes[0] === 0x02) {
    if (bytes.length < 4) throw new Error('Delivery packet is too short');
    const state = bytes[3];
    if (bytes.length < 4 || state < 1 || state > 3) throw new Error('Delivery packet has an unknown state');
    return { type: 'delivery', msgId: (bytes[1] << 8) | bytes[2], state: state === 1 ? 'QUEUED' : state === 2 ? 'DELIVERED' : 'FAILED' };
  }
  throw new Error('RX packet has an unknown type');
}

export function decodeStatus(bytes: Uint8Array): NodeStatus {
  if (bytes.length < 5) throw new Error('STATUS packet is too short');
  const linkState = bytes[4];
  if (linkState > 2) throw new Error('STATUS packet has an unknown link state');
  return { nodeId: (bytes[0] << 8) | bytes[1], battery: Math.min(bytes[2], 100), queueLength: bytes[3], linkState: linkState as 0 | 1 | 2 };
}

export function formatNodeId(id: number): string { return id.toString(16).toUpperCase().padStart(4, '0'); }
