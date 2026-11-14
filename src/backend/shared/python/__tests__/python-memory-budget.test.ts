/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { maxPythonInterpreters } from '../python-memory-budget'

const GiB = 1024 * 1024 * 1024

describe('maxPythonInterpreters', () => {
  it('fits the interpreters in half of the memory', () => {
    expect(maxPythonInterpreters(16 * GiB)).toBe(63)
    expect(maxPythonInterpreters(8 * GiB)).toBe(31)
    expect(maxPythonInterpreters(4 * GiB)).toBe(15)
  })

  it('assumes 8 GiB when the platform reports nothing usable', () => {
    expect(maxPythonInterpreters(null)).toBe(31)
    expect(maxPythonInterpreters(0)).toBe(31)
    expect(maxPythonInterpreters(Number.NaN)).toBe(31)
  })

  it('always allows one interpreter', () => {
    expect(maxPythonInterpreters(256 * 1024 * 1024)).toBe(1)
  })
})
