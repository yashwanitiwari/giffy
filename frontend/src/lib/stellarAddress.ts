/**
 * StrKey validation helpers (README §11 `lib/stellarAddress.ts`).
 *
 * Client-side validation is UX only — the backend re-validates with the SDK's
 * checksum-aware StrKey decoder (§7.3 principle 3). This implements the same
 * base32 + CRC16-XModem check so a typo'd address is caught before Review,
 * without shipping the whole Stellar SDK to the browser.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of input) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(out);
}

function crc16xmodem(data: Uint8Array): number {
  let crc = 0x0000;

  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc;
}

/** True when `value` is a well-formed Stellar public key (`G...`, checksum valid). */
export function isValidPublicKey(value: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(value)) return false;

  const decoded = base32Decode(value);
  if (!decoded || decoded.length !== 35) return false;

  // versionByte(1) + payload(32) + checksum(2, little-endian)
  const payload = decoded.subarray(0, 33);
  const checksum = decoded[33] | (decoded[34] << 8);

  return crc16xmodem(payload) === checksum;
}

/** `GABC…WXYZ` — the display form used everywhere an address appears in the UI. */
export function truncateKey(publicKey: string, chars = 4): string {
  if (publicKey.length <= chars * 2 + 1) return publicKey;
  return `${publicKey.slice(0, chars)}…${publicKey.slice(-chars)}`;
}
