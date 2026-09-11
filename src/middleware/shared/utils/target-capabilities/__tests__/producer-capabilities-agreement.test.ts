/**
 * Whatever builds an address pool must scope it with the PRODUCER resolver
 * (DOPE-615, C1).
 *
 * Nine places built a pool through `resolveTargetCapabilities` while the
 * store's allocation used `resolveAddressProducerCapabilities`. The two
 * answer differently in exactly one state: a board that does not resolve —
 * its VPP package is not installed, the project came from another machine, or
 * the catalogue has not finished loading. There the strict resolver says "no
 * producers at all".
 *
 * A pool scoped that way is EMPTY, so every address already claimed looks
 * free. The screen allocates from index zero on top of them, and the alias
 * registry stops reporting the conflicts it exists to report — while the
 * store and the compiler believe every producer is active. The addresses go
 * into the project and the damage is found much later.
 *
 * This reads the sources rather than exercising the screens, deliberately.
 * The defect is not a wrong value a component test would catch; it is the
 * WRONG FUNCTION being called, in a state that needs a board missing from the
 * catalogue to reproduce. Reading the import is what actually fails when
 * someone adds a tenth pool and reaches for the resolver they saw next door.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { execSync } from 'node:child_process'

const STRICT = 'resolveTargetCapabilities'
const PRODUCER = 'resolveAddressProducerCapabilities'

/** Every source file that builds an address pool, found rather than listed:
 *  a hard-coded list is the thing that goes stale. */
function filesThatBuildAPool(): string[] {
  const out = execSync(
    "grep -rl --include='*.ts' --include='*.tsx' -e 'buildAddressPool(' -e 'allocateAddresses(' src || true",
    { encoding: 'utf-8' },
  )
  return out
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.includes('__tests__'))
    // The pool machinery itself, which takes capabilities as an argument and
    // resolves nothing.
    .filter((path) => !path.includes('utils/iec-address/'))
}

describe('address pools are scoped by the producer resolver', () => {
  it('finds the pool builders at all', () => {
    // A guard on the guard: a rename that makes the grep match nothing would
    // otherwise turn this whole suite into a silent pass.
    expect(filesThatBuildAPool().length).toBeGreaterThanOrEqual(8)
  })

  it.each(filesThatBuildAPool())('%s does not resolve capabilities strictly', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf-8')
    const strictCalls = source.split(`${STRICT}(`).length - 1
    expect(strictCalls).toBe(0)
  })

  it('at least one of them resolves producers, so the check is not vacuous', () => {
    const resolving = filesThatBuildAPool().filter((path) =>
      readFileSync(join(process.cwd(), path), 'utf-8').includes(`${PRODUCER}(`),
    )
    expect(resolving.length).toBeGreaterThan(0)
  })
})
