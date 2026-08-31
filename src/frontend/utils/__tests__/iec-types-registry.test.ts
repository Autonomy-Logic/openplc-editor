import {
  BASE_TYPE_NAMES,
  IEC_BASE_TYPES,
  isBaseTypeName,
  isLengthQualifiedType,
  lookupBaseType,
  lookupBaseTypeByXmlElement,
  MAX_STRING_LENGTH,
  parseStringLength,
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

  // The length is parenthesised in the declaration, bounded by the capacity of
  // the unqualified type.
  describe('a declared string length', () => {
    it('splits the standard parenthesised form', () => {
      expect(parseStringLength('STRING(23)')).toEqual({ base: 'STRING', length: 23, valid: true })
    })

    it('accepts the bracket form and reports the same base', () => {
      expect(parseStringLength('STRING[23]')).toEqual({ base: 'STRING', length: 23, valid: true })
    })

    it('normalises case and whitespace, as IEC identifiers are case-insensitive', () => {
      expect(parseStringLength('  wstring ( 8 ) ')).toEqual({ base: 'WSTRING', length: 8, valid: true })
    })

    it('reports no length for an unqualified name, without calling it invalid', () => {
      // `valid` describes what was written, so "nothing was written" is not an
      // error — it is how a caller tells a plain STRING from STRING(0).
      expect(parseStringLength('STRING')).toEqual({ base: 'STRING', valid: true })
      expect(parseStringLength('INT')).toEqual({ base: 'INT', valid: true })
    })

    it.each([
      ['zero', 'STRING(0)'],
      ['past the implementation maximum', `STRING(${MAX_STRING_LENGTH + 1})`],
    ])('rejects %s', (_label, declared) => {
      expect(parseStringLength(declared).valid).toBe(false)
    })

    it('rejects a length on a type that cannot carry one', () => {
      // `INT(4)` is not a narrower integer — only STRING and WSTRING are
      // length-qualified, so this must not resolve to the INT metadata.
      expect(parseStringLength('INT(4)').valid).toBe(false)
      expect(lookupBaseType('INT(4)')).toBeUndefined()
    })

    it('leaves an ARRAY declaration alone', () => {
      // The regex must anchor on a bare identifier plus a length, or an inline
      // array would be mistaken for one.
      expect(parseStringLength('ARRAY[0..3] OF INT').length).toBeUndefined()
    })
  })

  describe('lookupBaseType with a declared length', () => {
    it('resolves to the STRING metadata, so every existing caller keeps working', () => {
      // ~31 call sites across 12 files — baseTypeTag, the XML emitters, the
      // debugger decoder, the force encoder — ask this one function what a type
      // is. Stripping the length here is what keeps them all unchanged.
      expect(lookupBaseType('STRING(23)')).toBe(lookupBaseType('STRING'))
      expect(lookupBaseType('WSTRING(8)')?.name).toBe('WSTRING')
    })

    it('keeps the XML element name, which is what the emitters need', () => {
      expect(lookupBaseType('STRING(23)')?.xml.elementName).toBe('string')
    })

    it('returns undefined for a length it cannot carry', () => {
      expect(lookupBaseType('STRING(0)')).toBeUndefined()
      expect(lookupBaseType('STRING(999)')).toBeUndefined()
    })

    it('is reflected by isBaseTypeName', () => {
      expect(isBaseTypeName('STRING(23)')).toBe(true)
      expect(isBaseTypeName('STRING(0)')).toBe(false)
    })
  })

  // The type dropdown asks this to decide which rows get a length box.
  describe('isLengthQualifiedType', () => {
    it('is true for STRING and WSTRING only', () => {
      expect(isLengthQualifiedType('STRING')).toBe(true)
      expect(isLengthQualifiedType('WSTRING')).toBe(true)
      for (const name of ['INT', 'DINT', 'REAL', 'BOOL', 'TIME', 'ARRAY']) {
        expect(isLengthQualifiedType(name)).toBe(false)
      }
    })

    it('normalises case and surrounding whitespace, like the rest of the registry', () => {
      expect(isLengthQualifiedType(' string ')).toBe(true)
      expect(isLengthQualifiedType('WString')).toBe(true)
    })
  })

})
