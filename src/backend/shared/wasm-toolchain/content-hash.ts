/**
 * Incremental 64-bit content hash (two independent 32-bit FNV-1a lanes) for cache keys. Not cryptographic.
 */
export class ContentHash {
  private a = 0x811c9dc5
  private b = 0x050c5d1f

  private byte(x: number): void {
    this.a = Math.imul(this.a ^ x, 0x01000193) >>> 0
    this.b = Math.imul(this.b ^ x, 0x01000193) >>> 0
    this.b = (this.b ^ (this.b >>> 15)) >>> 0
  }

  /** Adds a value; strings and bytes with the same content hash differently, and each value is length-delimited. */
  update(value: string | Uint8Array): this {
    const kind = typeof value === 'string' ? 1 : 2
    const length = value.length
    this.byte(kind)
    for (let shift = 0; shift < 32; shift += 8) this.byte((length >>> shift) & 0xff)
    if (typeof value === 'string') {
      for (let i = 0; i < length; i++) {
        const code = value.charCodeAt(i)
        this.byte(code & 0xff)
        this.byte(code >>> 8)
      }
    } else {
      for (let i = 0; i < length; i++) this.byte(value[i])
    }
    return this
  }

  digest(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0')
  }
}
