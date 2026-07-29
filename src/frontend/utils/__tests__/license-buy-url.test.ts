import { buildLicenseBuyUrl } from '../license-buy-url'

const DEVICE_ID = '7146518f9842adacfadc731ee7f546e5'
const VPP_ID = 'com.openplc.raspberry-pi-licensed'

describe('buildLicenseBuyUrl', () => {
  it('builds the purchase link the /buy page accepts', () => {
    const url = buildLicenseBuyUrl({ baseUrl: 'https://edge.autonomylogic.com', vppId: VPP_ID, deviceId: DEVICE_ID })
    expect(url).toBe(`https://edge.autonomylogic.com/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`)
  })

  it('points at a local Edge app when the base URL does', () => {
    expect(buildLicenseBuyUrl({ baseUrl: 'http://localhost:5173', vppId: VPP_ID, deviceId: DEVICE_ID })).toBe(
      `http://localhost:5173/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`,
    )
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(buildLicenseBuyUrl({ baseUrl: 'https://edge.autonomylogic.com//', vppId: VPP_ID, deviceId: DEVICE_ID })).toBe(
      `https://edge.autonomylogic.com/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`,
    )
  })

  // An Edge app hosted under a sub-path must keep it: `new URL('/buy', base)`
  // would silently drop the prefix and 404.
  it('keeps a base path instead of resolving to the origin root', () => {
    expect(buildLicenseBuyUrl({ baseUrl: 'https://example.com/edge', vppId: VPP_ID, deviceId: DEVICE_ID })).toBe(
      `https://example.com/edge/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`,
    )
  })

  // The web build can be configured with a same-origin prefix
  // (`VITE_EDGE_FRONTEND_URL=/`), which is not a parseable absolute URL.
  it.each([
    ['/', `/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`],
    ['', `/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`],
    ['/edge', `/edge/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`],
  ])('falls back to a root-relative link for the same-origin prefix %p', (baseUrl, expected) => {
    expect(buildLicenseBuyUrl({ baseUrl, vppId: VPP_ID, deviceId: DEVICE_ID })).toBe(expected)
  })

  it('percent-encodes a vppId carrying URL-significant characters', () => {
    const url = buildLicenseBuyUrl({ baseUrl: 'https://e.test', vppId: 'com.a b&c', deviceId: DEVICE_ID })
    expect(url).toBe(`https://e.test/buy?vppId=com.a+b%26c&deviceId=${DEVICE_ID}`)
  })

  // Returning null (instead of a partial link) is the point: the /buy page can
  // only answer "Invalid purchase link", so the caller must explain instead.
  it.each([
    ['no vppId', { vppId: undefined, deviceId: DEVICE_ID }],
    ['blank vppId', { vppId: '   ', deviceId: DEVICE_ID }],
    ['no deviceId', { vppId: VPP_ID, deviceId: undefined }],
    ['blank deviceId', { vppId: VPP_ID, deviceId: '' }],
    ['deviceId too short', { vppId: VPP_ID, deviceId: DEVICE_ID.slice(0, 31) }],
    ['deviceId too long', { vppId: VPP_ID, deviceId: `${DEVICE_ID}00` }],
    ['deviceId not hex', { vppId: VPP_ID, deviceId: 'z146518f9842adacfadc731ee7f546e5' }],
    // The hardware anchor is a different value AND a different length — the
    // guard is what keeps a mislabelled field from reaching a purchase.
    ['the hardware anchor instead of the deviceId', { vppId: VPP_ID, deviceId: '38363235383037623061383361653764aa' }],
  ])('refuses to build a link with %s', (_label, ids) => {
    expect(buildLicenseBuyUrl({ baseUrl: 'https://edge.autonomylogic.com', ...ids })).toBeNull()
  })

  it('accepts an uppercase deviceId, matching the page guard', () => {
    const url = buildLicenseBuyUrl({ baseUrl: 'https://e.test', vppId: VPP_ID, deviceId: DEVICE_ID.toUpperCase() })
    expect(url).toBe(`https://e.test/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID.toUpperCase()}`)
  })

  it('trims surrounding whitespace off both ids', () => {
    const url = buildLicenseBuyUrl({ baseUrl: 'https://e.test', vppId: ` ${VPP_ID} `, deviceId: ` ${DEVICE_ID} ` })
    expect(url).toBe(`https://e.test/buy?vppId=${encodeURIComponent(VPP_ID)}&deviceId=${DEVICE_ID}`)
  })
})
