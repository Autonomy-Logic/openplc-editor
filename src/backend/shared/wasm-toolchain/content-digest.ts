/**
 * SHA-256 digests of build inputs, as lowercase hex. Each part of a composite digest is length-delimited and tagged as
 * text or bytes, so no two different part lists digest alike.
 */
const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

const bytesOf = (value: string | Uint8Array): Uint8Array => (typeof value === 'string' ? encoder.encode(value) : value)

/** The SHA-256 of one value: a string as its UTF-8 bytes. */
export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = bytesOf(value)
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
}

/** The SHA-256 of a list of parts, each prefixed with its kind (text or bytes) and its length. */
export async function digestParts(parts: ReadonlyArray<string | Uint8Array>): Promise<string> {
  const encoded = parts.map((part) => ({ kind: typeof part === 'string' ? 1 : 2, bytes: bytesOf(part) }))
  const total = encoded.reduce((sum, { bytes }) => sum + 5 + bytes.length, 0)
  const buffer = new Uint8Array(total)
  const view = new DataView(buffer.buffer)
  let offset = 0
  for (const { kind, bytes } of encoded) {
    buffer[offset] = kind
    view.setUint32(offset + 1, bytes.length, true)
    buffer.set(bytes, offset + 5)
    offset += 5 + bytes.length
  }
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', buffer))
}
