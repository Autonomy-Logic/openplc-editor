import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pythonShmRuntime } from '../python-shm-runtime'
import { SHM_STRING_CHARS } from '../shm-type-map'

/**
 * The runtime is the half of the generated `.py` that must NOT vary by project.
 * Pinning it byte-for-byte is what makes "identical in every build" a fact
 * rather than an intention: any edit to the emitted Python has to be made
 * deliberately, in the fixture too, and the fixture is what the Python-level
 * round-trip test executes.
 */
describe('pythonShmRuntime', () => {
  const fixture = readFileSync(join(__dirname, 'fixtures/python-shm-runtime.fixture.py'), 'utf-8')

  it('is byte-identical to the checked-in fixture', () => {
    expect(pythonShmRuntime(SHM_STRING_CHARS)).toBe(fixture)
  })

  it('carries the transport cap from one place', () => {
    expect(pythonShmRuntime(SHM_STRING_CHARS)).toContain(`_STR_CHARS = ${SHM_STRING_CHARS}`)
    // The token must be fully substituted — a leftover marker would be a
    // syntax error in the deployed block, discovered at runtime.
    expect(pythonShmRuntime(SHM_STRING_CHARS)).not.toContain('__STR_CHARS__')
  })

  it('contains no project-specific text', () => {
    const emitted = pythonShmRuntime(SHM_STRING_CHARS)
    // Every name it defines is generic; nothing is per-variable or per-POU.
    expect(emitted).not.toMatch(/_SHM_(IN|OUT)\s*=/)
    expect(emitted).toContain('def _shm_unpack(buf, layout, scope):')
    expect(emitted).toContain('def _shm_pack(buf, layout, scope):')
  })
})
