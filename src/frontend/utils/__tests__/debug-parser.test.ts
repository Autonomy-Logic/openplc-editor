import {
  buildLeafInfoMap,
  buildLeafPathMap,
  type DebugMap,
  packDebugAddr,
  parseDebugMap,
  unpackDebugAddr,
} from '../debug-parser'

describe('packDebugAddr / unpackDebugAddr', () => {
  it('packs (0, 0) as 0', () => {
    expect(packDebugAddr({ arrayIdx: 0, elemIdx: 0 })).toBe(0)
  })

  it('packs (1, 0) into the high half', () => {
    expect(packDebugAddr({ arrayIdx: 1, elemIdx: 0 })).toBe(1 << 16)
  })

  it('packs (0, 5) into the low half', () => {
    expect(packDebugAddr({ arrayIdx: 0, elemIdx: 5 })).toBe(5)
  })

  it('packs (3, 42) into the combined slot', () => {
    expect(packDebugAddr({ arrayIdx: 3, elemIdx: 42 })).toBe((3 << 16) | 42)
  })

  it('masks arrayIdx to 8 bits', () => {
    // arrayIdx=0x100 wraps; only the low 8 bits survive → 0.
    expect(packDebugAddr({ arrayIdx: 0x100, elemIdx: 1 })).toBe(1)
  })

  it('masks elemIdx to 16 bits', () => {
    expect(packDebugAddr({ arrayIdx: 1, elemIdx: 0x1ffff })).toBe((1 << 16) | 0xffff)
  })

  it('unpacks the high+low halves correctly', () => {
    expect(unpackDebugAddr((3 << 16) | 42)).toEqual({ arrayIdx: 3, elemIdx: 42 })
  })

  it('round-trips a representative range of values', () => {
    for (const a of [0, 1, 7, 0x80, 0xff]) {
      for (const e of [0, 1, 100, 0xffff]) {
        const round = unpackDebugAddr(packDebugAddr({ arrayIdx: a, elemIdx: e }))
        expect(round).toEqual({ arrayIdx: a, elemIdx: e })
      }
    }
  })

  it('handles negative packed values via unsigned shift', () => {
    // The high bit being set (e.g. 0xFF000000) used to throw a signed-shift
    // off-by-one on the unpacker; assert it survives.
    const packed = 0xff000000 | 0x123
    const out = unpackDebugAddr(packed)
    expect(out.arrayIdx).toBe(0)
    expect(out.elemIdx).toBe(0x123)
  })
})

describe('parseDebugMap', () => {
  const validMap: DebugMap = {
    version: 2,
    md5: 'abc123',
    typeTags: { INT: 0, REAL: 1 },
    arrays: [{ index: 0, count: 3 }],
    leaves: [
      { arrayIdx: 0, elemIdx: 0, path: 'PRG.x', type: 'INT', size: 2 },
      { arrayIdx: 0, elemIdx: 1, path: 'PRG.y', type: 'REAL', size: 4 },
    ],
  }

  it('parses a valid v2 debug map', () => {
    const result = parseDebugMap(JSON.stringify(validMap))
    expect(result).toEqual(validMap)
  })

  it('returns undefined for non-JSON content', () => {
    expect(parseDebugMap('not json')).toBeUndefined()
  })

  it('returns undefined for empty input', () => {
    expect(parseDebugMap('')).toBeUndefined()
  })

  it('returns undefined when version is wrong', () => {
    expect(parseDebugMap(JSON.stringify({ ...validMap, version: 1 }))).toBeUndefined()
    expect(parseDebugMap(JSON.stringify({ ...validMap, version: undefined }))).toBeUndefined()
  })

  it('returns undefined when leaves is not an array', () => {
    expect(parseDebugMap(JSON.stringify({ ...validMap, leaves: 'oops' }))).toBeUndefined()
  })

  it('returns undefined when arrays is not an array', () => {
    expect(parseDebugMap(JSON.stringify({ ...validMap, arrays: null }))).toBeUndefined()
  })

  it('accepts a map with empty leaves and arrays', () => {
    const empty = { ...validMap, leaves: [], arrays: [] }
    const result = parseDebugMap(JSON.stringify(empty))
    expect(result).toEqual(empty)
  })
})

describe('buildLeafPathMap', () => {
  it('returns an empty map for a debug map with no leaves', () => {
    const map: DebugMap = {
      version: 2,
      md5: 'x',
      typeTags: {},
      arrays: [],
      leaves: [],
    }
    expect(buildLeafPathMap(map).size).toBe(0)
  })

  it('keys the lookup by uppercase path', () => {
    const map: DebugMap = {
      version: 2,
      md5: 'x',
      typeTags: {},
      arrays: [{ index: 0, count: 2 }],
      leaves: [
        { arrayIdx: 0, elemIdx: 0, path: 'prg.lower', type: 'INT', size: 2 },
        { arrayIdx: 0, elemIdx: 1, path: 'PRG.UPPER', type: 'INT', size: 2 },
      ],
    }
    const out = buildLeafPathMap(map)
    expect(out.has('PRG.LOWER')).toBe(true)
    expect(out.has('PRG.UPPER')).toBe(true)
    expect(out.has('prg.lower')).toBe(false)
  })

  it('packs the (arrayIdx, elemIdx) into the value', () => {
    const map: DebugMap = {
      version: 2,
      md5: 'x',
      typeTags: {},
      arrays: [{ index: 2, count: 1 }],
      leaves: [{ arrayIdx: 2, elemIdx: 7, path: 'foo', type: 'INT', size: 2 }],
    }
    const out = buildLeafPathMap(map)
    expect(out.get('FOO')).toBe(packDebugAddr({ arrayIdx: 2, elemIdx: 7 }))
  })

  it('overwrites duplicate paths (last writer wins)', () => {
    const map: DebugMap = {
      version: 2,
      md5: 'x',
      typeTags: {},
      arrays: [{ index: 0, count: 2 }],
      leaves: [
        { arrayIdx: 0, elemIdx: 0, path: 'PRG.X', type: 'INT', size: 2 },
        { arrayIdx: 0, elemIdx: 1, path: 'PRG.X', type: 'INT', size: 2 }, // dup
      ],
    }
    const out = buildLeafPathMap(map)
    expect(out.size).toBe(1)
    expect(unpackDebugAddr(out.get('PRG.X')!)).toEqual({ arrayIdx: 0, elemIdx: 1 })
  })
})

describe('buildLeafInfoMap', () => {
  it('returns an empty map for a debug map with no leaves', () => {
    const map: DebugMap = { version: 2, md5: 'x', typeTags: {}, arrays: [], leaves: [] }
    expect(buildLeafInfoMap(map).size).toBe(0)
  })

  it('keys by uppercase path and retains canonical arr/elem/type/size', () => {
    const map: DebugMap = {
      version: 2,
      md5: 'x',
      typeTags: {},
      arrays: [{ index: 0, count: 2 }],
      leaves: [
        { arrayIdx: 0, elemIdx: 1, path: 'cfg.g_b', type: 'DINT', size: 4 },
        { arrayIdx: 5, elemIdx: 0, path: 'IH1.X', type: 'LREAL', size: 8 },
      ],
    }
    const out = buildLeafInfoMap(map)
    expect(out.get('CFG.G_B')).toEqual({ arr: 0, elem: 1, type: 'DINT', size: 4 })
    expect(out.get('IH1.X')).toEqual({ arr: 5, elem: 0, type: 'LREAL', size: 8 })
    expect(out.has('cfg.g_b')).toBe(false)
  })

  it('overwrites duplicate paths (last writer wins)', () => {
    const map: DebugMap = {
      version: 2,
      md5: 'x',
      typeTags: {},
      arrays: [{ index: 0, count: 2 }],
      leaves: [
        { arrayIdx: 0, elemIdx: 0, path: 'PRG.X', type: 'INT', size: 2 },
        { arrayIdx: 0, elemIdx: 1, path: 'PRG.X', type: 'REAL', size: 4 }, // dup
      ],
    }
    const out = buildLeafInfoMap(map)
    expect(out.size).toBe(1)
    expect(out.get('PRG.X')).toEqual({ arr: 0, elem: 1, type: 'REAL', size: 4 })
  })
})
