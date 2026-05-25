import {
  getExpectedRuntimeVersion,
  isArduinoTarget,
  isOpenPLCRuntimeTarget,
  isOpenPLCRuntimeV4Target,
  isSimulatorTarget,
  validateRuntimeVersion,
} from '../device'

describe('isArduinoTarget', () => {
  it('returns false for undefined boardInfo', () => {
    expect(isArduinoTarget(undefined)).toBe(false)
  })

  it('returns true when compiler is arduino-cli', () => {
    expect(isArduinoTarget({ compiler: 'arduino-cli' })).toBe(true)
  })

  it('returns false when compiler is something else', () => {
    expect(isArduinoTarget({ compiler: 'openplc-compiler' })).toBe(false)
  })

  it('returns false when compiler is undefined', () => {
    expect(isArduinoTarget({})).toBe(false)
  })
})

describe('isOpenPLCRuntimeTarget', () => {
  it('returns false for undefined boardInfo', () => {
    expect(isOpenPLCRuntimeTarget(undefined)).toBe(false)
  })

  it('returns true when compiler is openplc-compiler', () => {
    expect(isOpenPLCRuntimeTarget({ compiler: 'openplc-compiler' })).toBe(true)
  })

  it('returns false when compiler is something else', () => {
    expect(isOpenPLCRuntimeTarget({ compiler: 'arduino-cli' })).toBe(false)
  })

  it('returns false when compiler is undefined', () => {
    expect(isOpenPLCRuntimeTarget({})).toBe(false)
  })
})

describe('isSimulatorTarget', () => {
  it('returns false for undefined boardInfo', () => {
    expect(isSimulatorTarget(undefined)).toBe(false)
  })

  it('returns true when compiler is simulator', () => {
    expect(isSimulatorTarget({ compiler: 'simulator' })).toBe(true)
  })

  it('returns false when compiler is something else', () => {
    expect(isSimulatorTarget({ compiler: 'arduino-cli' })).toBe(false)
  })

  it('returns false when compiler is undefined', () => {
    expect(isSimulatorTarget({})).toBe(false)
  })
})

describe('getExpectedRuntimeVersion', () => {
  it('extracts version from board target string', () => {
    expect(getExpectedRuntimeVersion('OpenPLC Runtime v4')).toBe('v4')
  })

  it('extracts version case-insensitively', () => {
    expect(getExpectedRuntimeVersion('openplc runtime V3')).toBe('v3')
  })

  it('returns undefined when no version pattern matches', () => {
    expect(getExpectedRuntimeVersion('Arduino Mega 2560')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(getExpectedRuntimeVersion('')).toBeUndefined()
  })
})

describe('isOpenPLCRuntimeV4Target', () => {
  it('returns true for v4 target', () => {
    expect(isOpenPLCRuntimeV4Target('OpenPLC Runtime v4')).toBe(true)
  })

  it('returns false for non-v4 target', () => {
    expect(isOpenPLCRuntimeV4Target('OpenPLC Runtime v3')).toBe(false)
  })

  it('returns false when no version is present', () => {
    expect(isOpenPLCRuntimeV4Target('Arduino Mega 2560')).toBe(false)
  })

  it('returns true for a VPP board with openplc-compiler (runtime-v4 by construction)', () => {
    const vppBoard = { compiler: 'openplc-compiler', vpp: { packageId: 'com.vendor.slm-rp4' } }
    expect(isOpenPLCRuntimeV4Target('SLM-RP4', vppBoard)).toBe(true)
  })

  it('ignores VPP metadata when the compiler is not openplc-compiler', () => {
    const vppArduinoBoard = { compiler: 'arduino-cli', vpp: { packageId: 'com.vendor.arduino-thing' } }
    expect(isOpenPLCRuntimeV4Target('Arduino Thing', vppArduinoBoard)).toBe(false)
  })
})

describe('validateRuntimeVersion', () => {
  it('returns ok when board target has no expected version', () => {
    const result = validateRuntimeVersion('Arduino Mega 2560', 'v4')
    expect(result).toEqual({ status: 'ok' })
  })

  it('returns missing when expected version exists but detected is undefined', () => {
    const result = validateRuntimeVersion('OpenPLC Runtime v4', undefined)
    expect(result.status).toBe('missing')
    expect(result.message).toContain('older than the version of the editor')
  })

  it('returns mismatch when detected version does not match expected', () => {
    const result = validateRuntimeVersion('OpenPLC Runtime v4', 'v3')
    expect(result.status).toBe('mismatch')
    expect(result.message).toContain('Runtime version mismatch')
    expect(result.message).toContain('OpenPLC Runtime v4')
    expect(result.message).toContain('v3')
  })

  it('returns ok when detected version matches expected', () => {
    const result = validateRuntimeVersion('OpenPLC Runtime v4', 'v4')
    expect(result).toEqual({ status: 'ok' })
  })

  it('normalizes detected version to lowercase for comparison', () => {
    const result = validateRuntimeVersion('OpenPLC Runtime v4', 'V4')
    expect(result).toEqual({ status: 'ok' })
  })

  it('accepts full SemVer detected versions matching the expected major', () => {
    // What `/api/version` actually returns on shipping runtimes.
    expect(validateRuntimeVersion('OpenPLC Runtime v4', '4.1.0-RC3')).toEqual({ status: 'ok' })
    expect(validateRuntimeVersion('OpenPLC Runtime v4', '4.2.0-rc1')).toEqual({ status: 'ok' })
    expect(validateRuntimeVersion('OpenPLC Runtime v4', '4.0.5')).toEqual({ status: 'ok' })
  })

  it('still flags SemVer detected versions whose major differs', () => {
    const result = validateRuntimeVersion('OpenPLC Runtime v4', '3.5.2')
    expect(result.status).toBe('mismatch')
    expect(result.message).toContain('3.5.2')
  })
})
