/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { buildNeedsArduinoComponents } from '../board-toolchain'
import hals from '../hals.json'

describe('buildNeedsArduinoComponents', () => {
  it('is false only for the OpenPLC Simulator', () => {
    expect(buildNeedsArduinoComponents(hals, 'OpenPLC Simulator')).toBe(false)
    expect(buildNeedsArduinoComponents(hals, 'OpenPLC Runtime v4')).toBe(true)
  })

  it('assumes a board it cannot find needs them', () => {
    expect(buildNeedsArduinoComponents(hals, 'A VPP board')).toBe(true)
    expect(buildNeedsArduinoComponents(null, 'OpenPLC Simulator')).toBe(true)
  })
})
