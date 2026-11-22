/**
 * @file png.mjs
 * Writes the .rgba dumps of a directory (i32 width, i32 height, then RGBA rows) as PNG files.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

export function writePngs(dumpDir, pngDir) {
  mkdirSync(pngDir, { recursive: true })
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  for (const f of readdirSync(dumpDir).filter((n) => n.endsWith('.rgba'))) {
    const raw = readFileSync(join(dumpDir, f))
    const w = raw.readInt32LE(0),
      h = raw.readInt32LE(4)
    const rows = []
    for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), raw.subarray(8 + y * w * 4, 8 + (y + 1) * w * 4))
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0)
    ihdr.writeUInt32BE(h, 4)
    ihdr.set([8, 6, 0, 0, 0], 8)
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
    writeFileSync(join(pngDir, f.replace(/\.rgba$/, '.png')), png)
  }
}
