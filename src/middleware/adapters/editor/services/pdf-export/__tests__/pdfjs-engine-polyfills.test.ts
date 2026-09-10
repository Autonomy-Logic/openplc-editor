import { applyPdfJsEnginePolyfills } from '../pdfjs-engine-polyfills'

/** Deletes `obj[key]` before the test and restores whatever was there afterward, native or not. */
function withDeleted<T extends object, K extends keyof T>(obj: T, key: K, run: () => void) {
  const original = obj[key]
  delete obj[key]
  try {
    run()
  } finally {
    if (original) obj[key] = original
    else delete obj[key]
  }
}

describe('applyPdfJsEnginePolyfills', () => {
  describe('Uint8Array.prototype.toHex', () => {
    it('polyfills when missing', () => {
      withDeleted(Uint8Array.prototype, 'toHex', () => {
        applyPdfJsEnginePolyfills()
        expect(new Uint8Array([0x25, 0x50, 0xff]).toHex?.()).toBe('2550ff')
      })
    })

    it('leaves a native implementation untouched', () => {
      const native = () => 'native'
      Uint8Array.prototype.toHex = native
      try {
        applyPdfJsEnginePolyfills()
        expect(Uint8Array.prototype.toHex).toBe(native)
      } finally {
        delete Uint8Array.prototype.toHex
      }
    })
  })

  describe('Uint8Array.prototype.toBase64 / Uint8Array.fromBase64', () => {
    it('polyfills toBase64 (default alphabet, with padding)', () => {
      withDeleted(Uint8Array.prototype, 'toBase64', () => {
        applyPdfJsEnginePolyfills()
        expect(new Uint8Array([0x25, 0x50, 0x44, 0x46]).toBase64?.()).toBe('JVBERg==')
      })
    })

    it('polyfills toBase64 with the base64url alphabet and omitted padding', () => {
      withDeleted(Uint8Array.prototype, 'toBase64', () => {
        applyPdfJsEnginePolyfills()
        const bytes = new Uint8Array([0xfb, 0xff, 0xbf])
        expect(bytes.toBase64?.({ alphabet: 'base64url', omitPadding: true })).toBe('-_-_')
      })
    })

    it('leaves a native toBase64 implementation untouched', () => {
      const native = () => 'native'
      Uint8Array.prototype.toBase64 = native
      try {
        applyPdfJsEnginePolyfills()
        expect(Uint8Array.prototype.toBase64).toBe(native)
      } finally {
        delete Uint8Array.prototype.toBase64
      }
    })

    it('polyfills fromBase64 (default alphabet)', () => {
      withDeleted(Uint8Array, 'fromBase64', () => {
        applyPdfJsEnginePolyfills()
        expect(Array.from(Uint8Array.fromBase64?.('JVBERg==') ?? [])).toEqual([0x25, 0x50, 0x44, 0x46])
      })
    })

    it('polyfills fromBase64 with the base64url alphabet', () => {
      withDeleted(Uint8Array, 'fromBase64', () => {
        applyPdfJsEnginePolyfills()
        expect(Array.from(Uint8Array.fromBase64?.('-_-_', { alphabet: 'base64url' }) ?? [])).toEqual([0xfb, 0xff, 0xbf])
      })
    })

    it('leaves a native fromBase64 implementation untouched', () => {
      const native = () => new Uint8Array()
      Uint8Array.fromBase64 = native
      try {
        applyPdfJsEnginePolyfills()
        expect(Uint8Array.fromBase64).toBe(native)
      } finally {
        delete Uint8Array.fromBase64
      }
    })
  })

  describe('Map.prototype.getOrInsert / getOrInsertComputed', () => {
    it('polyfills getOrInsert: sets and returns the value on a miss, returns the existing value on a hit', () => {
      withDeleted(Map.prototype, 'getOrInsert', () => {
        applyPdfJsEnginePolyfills()
        const map = new Map<string, number>()

        expect(map.getOrInsert?.('a', 1)).toBe(1)
        expect(map.getOrInsert?.('a', 2)).toBe(1)
        expect(map.get('a')).toBe(1)
      })
    })

    it('leaves a native getOrInsert implementation untouched', () => {
      const native = function () {
        return 'native'
      }
      Map.prototype.getOrInsert = native
      try {
        applyPdfJsEnginePolyfills()
        expect(Map.prototype.getOrInsert).toBe(native)
      } finally {
        delete Map.prototype.getOrInsert
      }
    })

    it('polyfills getOrInsertComputed: computes and caches on a miss, skips the callback on a hit', () => {
      withDeleted(Map.prototype, 'getOrInsertComputed', () => {
        applyPdfJsEnginePolyfills()
        const map = new Map<string, number>()
        const compute = jest.fn((key: string) => key.length)

        expect(map.getOrInsertComputed?.('abc', compute)).toBe(3)
        expect(map.getOrInsertComputed?.('abc', compute)).toBe(3)
        expect(compute).toHaveBeenCalledTimes(1)
      })
    })

    it('leaves a native getOrInsertComputed implementation untouched', () => {
      const native = function () {
        return 'native'
      }
      Map.prototype.getOrInsertComputed = native
      try {
        applyPdfJsEnginePolyfills()
        expect(Map.prototype.getOrInsertComputed).toBe(native)
      } finally {
        delete Map.prototype.getOrInsertComputed
      }
    })
  })

  describe('Promise.try', () => {
    it('polyfills: resolves with the callback return value', async () => {
      await withDeletedAsync(Promise, 'try', async () => {
        applyPdfJsEnginePolyfills()
        await expect(Promise.try?.((a: number, b: number) => a + b, 2, 3)).resolves.toBe(5)
      })
    })

    it('polyfills: rejects when the callback throws synchronously', async () => {
      await withDeletedAsync(Promise, 'try', async () => {
        applyPdfJsEnginePolyfills()
        await expect(
          Promise.try?.(() => {
            throw new Error('boom')
          }),
        ).rejects.toThrow('boom')
      })
    })

    it('leaves a native implementation untouched', () => {
      const native = () => Promise.resolve('native')
      // Assigning a concrete function to the generic `try` signature directly
      // doesn't type-check (TS can't unify a fixed return type against an
      // arbitrary `T`) — `defineProperty` is untyped, same as the real
      // polyfill's own mechanism above.
      Object.defineProperty(Promise, 'try', { value: native, writable: true, configurable: true })
      try {
        applyPdfJsEnginePolyfills()
        expect(Promise.try).toBe(native)
      } finally {
        delete Promise.try
      }
    })
  })
})

/** Same as `withDeleted`, but for a callback that itself needs to `await`. */
async function withDeletedAsync<T extends object, K extends keyof T>(obj: T, key: K, run: () => Promise<void>) {
  const original = obj[key]
  delete obj[key]
  try {
    await run()
  } finally {
    if (original) obj[key] = original
    else delete obj[key]
  }
}
