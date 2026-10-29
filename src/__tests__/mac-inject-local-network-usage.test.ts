import { randomBytes } from 'crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Build script, lives outside src/; require it so ts-jest treats it as a plain CommonJS module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const macInject = require('../../scripts/mac-inject-local-network-usage') as {
  uuidFromBundleId: (bundleId: string) => Buffer
  stampMainExecutableUuid: (filePath: string, bundleId: string) => string
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('mac-inject-local-network-usage', () => {
  describe('uuidFromBundleId', () => {
    it("returns the known UUID v5 for the editor's own bundle id", () => {
      const uuid = macInject.uuidFromBundleId('com.autonomylogic.openplceditor')
      expect(uuid.toString('hex')).toBe('fda90d27fe6a55c690e81b7a49e9516d')
    })

    it('is deterministic for the same input', () => {
      const a = macInject.uuidFromBundleId('com.example.app').toString('hex')
      const b = macInject.uuidFromBundleId('com.example.app').toString('hex')
      expect(a).toBe(b)
    })

    it('differs for different bundle ids', () => {
      const a = macInject.uuidFromBundleId('com.example.app').toString('hex')
      const b = macInject.uuidFromBundleId('com.example.other').toString('hex')
      expect(a).not.toBe(b)
    })

    it('sets the version 5 nibble and the RFC 4122 variant bits', () => {
      const uuid = macInject.uuidFromBundleId('com.example.app')
      expect(uuid[6] & 0xf0).toBe(0x50)
      expect(uuid[8] & 0xc0).toBe(0x80)
    })
  })

  describe('stampMainExecutableUuid', () => {
    const MH_MAGIC_64 = 0xfeedfacf
    const LC_UUID = 0x1b

    function buildThinMachO(originalUuid: Uint8Array): Uint8Array {
      // 32-byte mach_header_64 + one LC_UUID load command (24 bytes) + a trailer
      // we can assert is untouched by the stamp.
      const trailer = new TextEncoder().encode('TRAILERBYTES-UNTOUCHED-BY-STAMP--')
      const buf = new Uint8Array(32 + 24 + trailer.length)
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      view.setUint32(0, MH_MAGIC_64, true) // magic
      view.setInt32(4, 0x0100000c, true) // cputype CPU_TYPE_ARM64
      view.setInt32(8, 0, true) // cpusubtype
      view.setUint32(12, 2, true) // filetype MH_EXECUTE
      view.setUint32(16, 1, true) // ncmds
      view.setUint32(20, 24, true) // sizeofcmds
      view.setUint32(24, 0, true) // flags
      view.setUint32(28, 0, true) // reserved
      view.setUint32(32, LC_UUID, true) // load command: cmd
      view.setUint32(36, 24, true) // load command: cmdsize
      buf.set(originalUuid.subarray(0, 16), 40) // UUID payload
      buf.set(trailer, 56)
      return buf
    }

    function uniqueTmpPath(tag: string): string {
      return join(tmpdir(), `mac-inject-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
    }

    it('rewrites 16 bytes at offset 40 and leaves the rest untouched', () => {
      const inputUuid = new Uint8Array(randomBytes(16))
      const input = buildThinMachO(inputUuid)
      const tmp = uniqueTmpPath('stamp')
      writeFileSync(tmp, input)
      try {
        const bundleId = 'com.example.test'
        const expectedUuid = macInject.uuidFromBundleId(bundleId)
        const expectedHex = expectedUuid.toString('hex')
        const stamped = macInject.stampMainExecutableUuid(tmp, bundleId)
        const result = readFileSync(tmp)
        const resultBytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength)

        expect(stamped).toBe(expectedHex)
        expect(resultBytes.length).toBe(input.length)
        expect(hex(resultBytes.subarray(40, 56))).toBe(expectedHex)
        expect(hex(resultBytes.subarray(0, 40))).toBe(hex(input.subarray(0, 40)))
        expect(hex(resultBytes.subarray(56))).toBe(hex(input.subarray(56)))
      } finally {
        unlinkSync(tmp)
      }
    })

    it('throws when the file is not a thin 64-bit Mach-O', () => {
      const tmp = uniqueTmpPath('notmacho')
      writeFileSync(tmp, new TextEncoder().encode('NOTAMACHOFILE________'))
      try {
        expect(() => macInject.stampMainExecutableUuid(tmp, 'com.example.test')).toThrow(/thin 64-bit Mach-O/)
      } finally {
        unlinkSync(tmp)
      }
    })

    it('throws when the Mach-O has no LC_UUID load command', () => {
      const tmp = uniqueTmpPath('nouuid')
      const buf = new Uint8Array(32)
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      view.setUint32(0, MH_MAGIC_64, true) // magic
      view.setUint32(16, 0, true) // ncmds = 0
      writeFileSync(tmp, buf)
      try {
        expect(() => macInject.stampMainExecutableUuid(tmp, 'com.example.test')).toThrow(/no LC_UUID/)
      } finally {
        unlinkSync(tmp)
      }
    })
  })
})
