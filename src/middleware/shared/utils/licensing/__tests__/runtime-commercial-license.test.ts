import {
  isRuntimeHardwareId,
  parseRuntimeCommercialLicense,
  parseRuntimeHardwareId,
} from '../runtime-commercial-license'

const ID = `hw2:${'ab'.repeat(32)}`

describe('parseRuntimeCommercialLicense', () => {
  it('keeps the two values the runtime reports', () => {
    expect(parseRuntimeCommercialLicense('commercial')).toBe('commercial')
    expect(parseRuntimeCommercialLicense('gpl')).toBe('gpl')
  })

  it('treats a missing or unknown value as not reported', () => {
    for (const value of [undefined, null, '', 'GPL', 'Commercial', 'mit', 1, true, {}, ['gpl']]) {
      expect(parseRuntimeCommercialLicense(value)).toBeUndefined()
    }
  })
})

describe('isRuntimeHardwareId', () => {
  it('accepts hw2 followed by 64 lowercase hex', () => {
    expect(isRuntimeHardwareId(ID)).toBe(true)
  })

  it('refuses anything else', () => {
    for (const value of [
      `hw1:${'ab'.repeat(32)}`,
      `hw2:${'AB'.repeat(32)}`,
      `hw2:${'ab'.repeat(31)}`,
      `hw2:${'ab'.repeat(33)}`,
      `${ID}\n`,
      ` ${ID}`,
      `hw2:${'zz'.repeat(32)}`,
      null,
      42,
    ]) {
      expect(isRuntimeHardwareId(value)).toBe(false)
    }
  })
})

describe('parseRuntimeHardwareId', () => {
  it('reads an ID computed on the device', () => {
    expect(parseRuntimeHardwareId({ hardwareId: ID, source: 'device', elements: [] })).toEqual({
      hardwareId: ID,
      source: 'device',
    })
  })

  it('reads the host ID of a vPLC', () => {
    expect(parseRuntimeHardwareId({ hardwareId: ID, source: 'orchestrator' })).toEqual({
      hardwareId: ID,
      source: 'orchestrator',
    })
  })

  it('reports no ID when the runtime derives none', () => {
    expect(parseRuntimeHardwareId({ hardwareId: null, source: null, elements: [] })).toEqual({
      hardwareId: null,
      source: null,
    })
  })

  it('drops an unknown source but keeps a valid ID', () => {
    expect(parseRuntimeHardwareId({ hardwareId: ID, source: 'cloud' })).toEqual({ hardwareId: ID, source: null })
  })

  it('refuses a malformed ID or body', () => {
    expect(parseRuntimeHardwareId({ hardwareId: 'hw2:../../etc', source: 'device' })).toBeNull()
    expect(parseRuntimeHardwareId({ hardwareId: 7 })).toBeNull()
    expect(parseRuntimeHardwareId('hw2')).toBeNull()
    expect(parseRuntimeHardwareId(null)).toBeNull()
  })
})
