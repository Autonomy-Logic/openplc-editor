import {
  BASE_TYPE_NAMES,
  IEC_BASE_TYPES,
  isBaseTypeName,
  lookupBaseType,
  lookupBaseTypeByXmlElement,
} from '../iec-types-registry'

describe('iec-types-registry', () => {
  describe('IEC_BASE_TYPES', () => {
    it("loads strucpp's full elementary type list", () => {
      // Spot-check across categories — the strucpp side has its own
      // full pin suite. Failure here means the JSON shipped with the
      // bundled strucpp lost rows.
      const names = IEC_BASE_TYPES.map((t) => t.name)
      expect(names).toContain('BOOL')
      expect(names).toContain('INT')
      expect(names).toContain('REAL')
      expect(names).toContain('TIME')
      expect(names).toContain('DT')
      expect(names).toContain('STRING')
      expect(names).toContain('WSTRING')
      expect(names.length).toBeGreaterThanOrEqual(20)
    })

    it('every entry exposes the fields the editor relies on', () => {
      for (const t of IEC_BASE_TYPES) {
        expect(typeof t.name).toBe('string')
        expect(Array.isArray(t.aliases)).toBe(true)
        expect(typeof t.byteSize).toBe('number')
        expect(typeof t.bits).toBe('number')
        expect(typeof t.cppType).toBe('string')
        expect(typeof t.wireFormat).toBe('string')
        expect(typeof t.xml.elementName).toBe('string')
        expect(typeof t.xml.plcopenStandard).toBe('boolean')
      }
    })
  })

  describe('lookupBaseType', () => {
    it('resolves canonical names', () => {
      expect(lookupBaseType('BOOL')?.name).toBe('BOOL')
      expect(lookupBaseType('REAL')?.byteSize).toBe(4)
    })

    it('resolves aliases to the same metadata as the canonical name', () => {
      const tod = lookupBaseType('TOD')
      expect(lookupBaseType('TIME_OF_DAY')).toBe(tod)
      const dt = lookupBaseType('DT')
      expect(lookupBaseType('DATE_AND_TIME')).toBe(dt)
    })

    it('matches case-insensitively and trims whitespace', () => {
      expect(lookupBaseType('  bool  ')?.name).toBe('BOOL')
      expect(lookupBaseType('Int')?.name).toBe('INT')
      expect(lookupBaseType('\tString\n')?.name).toBe('STRING')
    })

    it('returns undefined for non-elementary names', () => {
      expect(lookupBaseType('MyStruct')).toBeUndefined()
      expect(lookupBaseType('')).toBeUndefined()
      // LOGLEVEL was an OpenPLC extension that never made it into
      // strucpp's canonical registry — confirm it's truly gone.
      expect(lookupBaseType('LOGLEVEL')).toBeUndefined()
    })
  })

  describe('isBaseTypeName', () => {
    it('accepts canonical names', () => {
      expect(isBaseTypeName('BOOL')).toBe(true)
      expect(isBaseTypeName('WSTRING')).toBe(true)
    })

    it('accepts aliases', () => {
      expect(isBaseTypeName('TIME_OF_DAY')).toBe(true)
      expect(isBaseTypeName('DATE_AND_TIME')).toBe(true)
    })

    it('matches case-insensitively and trims whitespace', () => {
      expect(isBaseTypeName('  int  ')).toBe(true)
      expect(isBaseTypeName('Real')).toBe(true)
    })

    it('rejects unknown names', () => {
      expect(isBaseTypeName('MyStruct')).toBe(false)
      expect(isBaseTypeName('')).toBe(false)
    })
  })

  describe('lookupBaseTypeByXmlElement', () => {
    it('resolves the standard uppercase element names', () => {
      expect(lookupBaseTypeByXmlElement('BOOL')?.name).toBe('BOOL')
      expect(lookupBaseTypeByXmlElement('INT')?.name).toBe('INT')
      expect(lookupBaseTypeByXmlElement('REAL')?.name).toBe('REAL')
    })

    it('resolves the lowercase string/wstring element names', () => {
      expect(lookupBaseTypeByXmlElement('string')?.name).toBe('STRING')
      expect(lookupBaseTypeByXmlElement('wstring')?.name).toBe('WSTRING')
    })

    it('is case-sensitive (does not match on the wrong case)', () => {
      expect(lookupBaseTypeByXmlElement('STRING')).toBeUndefined()
      expect(lookupBaseTypeByXmlElement('WSTRING')).toBeUndefined()
      expect(lookupBaseTypeByXmlElement('bool')).toBeUndefined()
    })

    it('returns undefined for unknown element names', () => {
      expect(lookupBaseTypeByXmlElement('derived')).toBeUndefined()
      expect(lookupBaseTypeByXmlElement('')).toBeUndefined()
    })

    it("round-trips every registry entry's own xml.elementName", () => {
      for (const t of IEC_BASE_TYPES) {
        expect(lookupBaseTypeByXmlElement(t.xml.elementName)).toBe(t)
      }
    })
  })

  describe('BASE_TYPE_NAMES', () => {
    it('exposes canonical names only (no aliases)', () => {
      expect(BASE_TYPE_NAMES).toContain('TOD')
      expect(BASE_TYPE_NAMES).toContain('DT')
      expect(BASE_TYPE_NAMES).not.toContain('TIME_OF_DAY')
      expect(BASE_TYPE_NAMES).not.toContain('DATE_AND_TIME')
    })

    it("preserves the order from strucpp's canonical list", () => {
      // Order is stable and intended for UI dropdowns. If strucpp
      // reorders, the editor follows.
      expect(BASE_TYPE_NAMES.length).toBe(IEC_BASE_TYPES.length)
      BASE_TYPE_NAMES.forEach((name, i) => {
        expect(name).toBe(IEC_BASE_TYPES[i].name)
      })
    })
  })
})
