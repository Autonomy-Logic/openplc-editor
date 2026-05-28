import { describe, expect, it } from '@jest/globals'

import { resolveBoardSelection } from '../steps/resolve-board-selection'

// Minimal hals fixtures.  The resolver only inspects `.compiler`;
// other fields ride through verbatim, so tests don't need to
// construct full BoardHalsCompileEntry shapes.
const halsFixture = {
  'OpenPLC Simulator': { compiler: 'simulator', platform: 'arduino:avr:mega' },
  'OpenPLC Runtime v3': { compiler: 'openplc-compiler' },
  'OpenPLC Runtime v4': { compiler: 'openplc-compiler' },
  'Arduino Mega 2560': { compiler: 'arduino-cli', platform: 'arduino:avr:mega' },
  'Some Future Board': {},
}

describe('resolveBoardSelection', () => {
  it('returns ok=false with a clear message when the boardTarget is missing from hals', () => {
    const result = resolveBoardSelection(halsFixture, 'No Such Board')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/"No Such Board"/)
      expect(result.error).toMatch(/hals\.json/)
    }
  })

  it('returns the entry, boardRuntime, and flags for a simulator target', () => {
    const result = resolveBoardSelection(halsFixture, 'OpenPLC Simulator')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardEntry.compiler).toBe('simulator')
      expect(result.boardRuntime).toBe('simulator')
      expect(result.isSimulator).toBe(true)
      expect(result.isRuntimeV3).toBe(false)
      expect(result.isRuntimeV4).toBe(false)
    }
  })

  it('OpenPLC Runtime v3 sets isRuntimeV3 and NOT isRuntimeV4 even when compiler is openplc-compiler', () => {
    const result = resolveBoardSelection(halsFixture, 'OpenPLC Runtime v3')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('openplc-compiler')
      expect(result.isRuntimeV3).toBe(true)
      expect(result.isRuntimeV4).toBe(false)
      expect(result.isSimulator).toBe(false)
    }
  })

  it('OpenPLC Runtime v4 sets isRuntimeV4 (compiler openplc-compiler + not v3)', () => {
    const result = resolveBoardSelection(halsFixture, 'OpenPLC Runtime v4')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isRuntimeV4).toBe(true)
      expect(result.isRuntimeV3).toBe(false)
      expect(result.isSimulator).toBe(false)
    }
  })

  it('Arduino direct-board target sets none of the runtime flags', () => {
    const result = resolveBoardSelection(halsFixture, 'Arduino Mega 2560')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('arduino-cli')
      expect(result.isSimulator).toBe(false)
      expect(result.isRuntimeV3).toBe(false)
      expect(result.isRuntimeV4).toBe(false)
    }
  })

  it('entry without a `compiler` field produces an empty boardRuntime and all flags false', () => {
    const result = resolveBoardSelection(halsFixture, 'Some Future Board')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('')
      expect(result.isSimulator).toBe(false)
      expect(result.isRuntimeV3).toBe(false)
      expect(result.isRuntimeV4).toBe(false)
    }
  })

  it('non-string `compiler` is treated as empty (defensive against bad hals data)', () => {
    const halsWithBadField = {
      'Bad Board': { compiler: 42 as unknown as string },
    }
    const result = resolveBoardSelection(halsWithBadField, 'Bad Board')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('')
    }
  })
})
