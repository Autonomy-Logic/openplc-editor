import { hmiHostManifestSource } from '../host-manifest'

const TAGS = [
  { path: 'CONFIG0.RES0.INSTANCE0.MAIN.RUN', type: 1, maxLength: 0, address: { arr: 0, elem: 4 } },
  { path: 'CONFIG0.RES0.INSTANCE0.MAIN.NAME', type: 16, maxLength: 12, address: { arr: 1, elem: 0 } },
]
const PAGES = [
  {
    name: 'Main',
    reads: [0, 1],
    writes: [
      { tag: 0, whole: true, bits: [], limit: { min: -2.5, max: 100 } },
      { tag: 1, whole: false, bits: [0, 5, 63], limit: null },
    ],
    roles: 7,
  },
  { name: 'Status', reads: [1], writes: [], roles: 15 },
]

describe('the host-side manifest of a Runtime v4 HMI', () => {
  it('lists the tags, each screen with its reads, writes and roles, the MD5 and the period, as data', () => {
    const result = hmiHostManifestSource({ tags: TAGS, pages: PAGES, md5: 'abc', periodMs: 100 })
    if (!result.ok) throw new Error(result.error)
    const { source } = result
    expect(source).toContain('#include "hmi_access.h"')
    expect(source).toContain('static const uint16_t reads_0[2] = {0, 1};')
    expect(source).toContain(
      'static const hmi_access_write_t writes_0[2] = {{0, 1, 0x0ULL, 1, -2.5, 100.0}, {1, 0, 0x8000000000000021ULL, 0, 0.0, 0.0}};',
    )
    expect(source).toContain('static const hmi_access_write_t writes_1[1] = {{0, 0, 0x0ULL, 0, 0.0, 0.0}};')
    expect(source).toContain('    {0u, 4u, 1, 0, "CONFIG0.RES0.INSTANCE0.MAIN.RUN"},')
    expect(source).toContain('    {1u, 0u, 16, 12, "CONFIG0.RES0.INSTANCE0.MAIN.NAME"},')
    expect(source).toContain('    {reads_0, 2, writes_0, 2, 7}, /* Main */')
    expect(source).toContain('    {reads_1, 1, writes_1, 0, 15}, /* Status */')
    expect(source).toContain('const int hmi_access_tag_count = 2;')
    expect(source).toContain('const int hmi_access_page_count = 2;')
    expect(source).toContain('const char hmi_access_plc_md5[] = "abc";')
    expect(source).toContain('const uint32_t hmi_access_period_ms = 100u;')
    expect(source).not.toMatch(/\bhmi_unit|\(\s*void\s*\)\s*\{/)
  })

  it('refuses tags without a debug address, more tags than a message can name, and no screens', () => {
    expect(
      hmiHostManifestSource({ tags: [{ ...TAGS[0], address: null }], pages: PAGES, md5: 'a', periodMs: 1 }),
    ).toEqual({ ok: false, error: 'CONFIG0.RES0.INSTANCE0.MAIN.RUN has no debug address in the compiled PLC program' })
    const many = Array.from({ length: 0x10000 }, () => TAGS[0])
    expect(hmiHostManifestSource({ tags: many, pages: PAGES, md5: 'a', periodMs: 1 }).ok).toBe(false)
    expect(hmiHostManifestSource({ tags: TAGS, pages: [], md5: 'a', periodMs: 1 })).toEqual({
      ok: false,
      error: 'the HMI has no screens',
    })
  })

  it('writes limits C reads back exactly, and refuses an empty one', () => {
    const page = (limit: { min: number; max: number }) => [
      { name: 'Main', reads: [], writes: [{ tag: 0, whole: true, bits: [], limit }], roles: 1 },
    ]
    const tiny = hmiHostManifestSource({ tags: TAGS, pages: page({ min: 1e-7, max: 1e21 }), md5: 'a', periodMs: 1 })
    expect(tiny.ok && tiny.source).toContain('{0, 1, 0x0ULL, 1, 1e-7, 1e+21}')
    const empty = hmiHostManifestSource({ tags: TAGS, pages: page({ min: 2, max: 1 }), md5: 'a', periodMs: 1 })
    expect(empty).toEqual({ ok: false, error: 'CONFIG0.RES0.INSTANCE0.MAIN.RUN: an empty write limit' })
  })

  it('keeps a screen name from closing its comment', () => {
    const result = hmiHostManifestSource({
      tags: TAGS,
      pages: [{ name: 'A*/B', reads: [], writes: [], roles: 1 }],
      md5: 'a',
      periodMs: 1,
    })
    expect(result.ok && result.source).toContain('/* AB */')
    expect(result.ok && result.source).toContain('static const uint16_t reads_0[1] = {0};')
  })
})
