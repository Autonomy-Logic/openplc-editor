import { mockInstallFromRemote, mockListRemoteCatalog } from '../remote-catalog-mock'

describe('mockListRemoteCatalog', () => {
  it('returns a valid RemoteCatalog with at least one entry and a fresh ISO timestamp', async () => {
    const result = await mockListRemoteCatalog()
    expect(result.entries.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false)
  })

  it('honours the RemoteCatalogEntry shape: every entry has versions[] (≥1) and required per-version fields', async () => {
    const result = await mockListRemoteCatalog()
    for (const entry of result.entries) {
      expect(entry.packageId).toMatch(/^[a-z][a-z0-9.-]+$/)
      expect(entry.vendor.name.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.versions.length).toBeGreaterThan(0)
      for (const v of entry.versions) {
        expect(v.version).toMatch(/^\d+\.\d+\.\d+/)
        expect(v.downloadUrl).toMatch(/^https?:\/\//)
        expect(v.deviceCount).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('orders each entry versions newest-first (catalog contract: versions[0] === latest)', async () => {
    const result = await mockListRemoteCatalog()
    const parse = (v: string): [number, number, number] => {
      const [a, b, c] = v.split('.').map((n) => parseInt(n, 10))
      return [a || 0, b || 0, c || 0]
    }
    const cmp = (a: [number, number, number], b: [number, number, number]) => {
      if (a[0] !== b[0]) return a[0] - b[0]
      if (a[1] !== b[1]) return a[1] - b[1]
      return a[2] - b[2]
    }
    for (const entry of result.entries) {
      for (let i = 0; i < entry.versions.length - 1; i += 1) {
        expect(cmp(parse(entry.versions[i].version), parse(entry.versions[i + 1].version))).toBeGreaterThan(0)
      }
    }
  })

  it('includes at least one entry whose latest requires a newer editor — exercises the incompatibility UI path', async () => {
    // The mock deliberately ships com.openplc.stm32-community 0.3.0 with
    // minEditorVersion 5.0.0 so the CatalogBrowser's "Editor outdated"
    // disabled state is visible without faking APP_VERSION at runtime.
    const result = await mockListRemoteCatalog()
    const hasIncompatibleLatest = result.entries.some((e) => {
      const min = e.versions[0]?.minEditorVersion
      return min !== undefined && min.startsWith('5.')
    })
    expect(hasIncompatibleLatest).toBe(true)
  })
})

describe('mockInstallFromRemote', () => {
  it('resolves with success:false and an error that names the requested package + version + downloadUrl', async () => {
    const result = await mockInstallFromRemote(
      'com.openplc.arduino',
      '0.2.0',
      'http://localhost:3333/vpp-catalog/v1/packages/com.openplc.arduino-0.2.0.vpp',
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('com.openplc.arduino')
    expect(result.error).toContain('0.2.0')
    expect(result.error).toContain('localhost:3333')
  })

  it('echoes the packageId across different requests so the modal renders the right context', async () => {
    const result = await mockInstallFromRemote('com.openplc.espressif', '0.1.0', 'http://example/foo.vpp')
    expect(result.success).toBe(false)
    expect(result.error).toContain('com.openplc.espressif')
    expect(result.error).toContain('0.1.0')
  })
})
