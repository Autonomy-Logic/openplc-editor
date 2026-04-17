/**
 * Shared hex <-> Uint8Array conversion utilities.
 *
 * Used by debug transports and session hooks to convert between
 * hex string representations and binary buffers.
 */

/**
 * Convert a hex string (e.g. "0a1bff") to a Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Convert a Uint8Array to a compact hex string (e.g. "0a1bff").
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert a Uint8Array to a space-separated uppercase hex string (e.g. "0A 1B FF").
 * Matches the format used by the OpenPLC runtime debug protocol.
 */
export function bytesToHexSpaced(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}
