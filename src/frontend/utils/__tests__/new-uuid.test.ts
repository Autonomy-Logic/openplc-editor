import { newUuid } from '../new-uuid'

describe('newUuid', () => {
  it('returns a v4 UUID', () => {
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('does not repeat itself across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newUuid()))
    expect(ids.size).toBe(100)
  })

  // The regression this whole helper exists for: `crypto.randomUUID` is
  // secure-context-only and autonomy-node serves the web bundle over plain
  // HTTP. `uuid` decides which generator to use at module-evaluation time, so
  // the module graph has to be re-imported with the global already gone —
  // deleting it after the fact would leave the bound reference in place and
  // the test would pass without ever touching the fallback.
  //
  // The editor's renderer is always a secure context, so this guards the
  // shared helper rather than a defect reachable from this app.
  it('still works when crypto.randomUUID is absent (plain-HTTP node access)', async () => {
    const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    jest.resetModules()
    try {
      const { newUuid: freshNewUuid } = await import('../new-uuid')
      expect(freshNewUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      // `randomUUID` lives on `Crypto.prototype`, not on the `crypto` instance,
      // so there is no own descriptor to put back — restoring only when one
      // existed would leave our `undefined` own property shadowing the real
      // method for every later test in this file.
      if (original) {
        Object.defineProperty(crypto, 'randomUUID', original)
      } else {
        Reflect.deleteProperty(crypto, 'randomUUID')
      }
      jest.resetModules()
    }
  })

  // Guards the teardown above: if the property is ever left shadowed, this
  // fails right here instead of surfacing as an unrelated test breaking later.
  it('leaves crypto.randomUUID intact after that test', () => {
    expect(typeof crypto.randomUUID).toBe('function')
  })
})
