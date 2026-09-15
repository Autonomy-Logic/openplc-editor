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

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const STRICT = 'resolveTargetCapabilities'
const PRODUCER = 'resolveAddressProducerCapabilities'

/** Every `.ts`/`.tsx` under `src`, walked rather than shelled out for.
 *
 * `execSync('grep …')` read better but made the suite POSIX-only: this is an
 * Electron IDE whose release matrix includes Windows, where a developer
 * running `npm test` got a red suite for a reason unrelated to their change.
 * It also needed `|| true`, which swallowed a grep that failed for a real
 * reason. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

/** Every source file that builds an address pool, found rather than listed:
 *  a hard-coded list is the thing that goes stale. */
function filesThatBuildAPool(): string[] {
  return (
    sourceFiles('src')
      .filter((path) => {
        const source = readFileSync(path, 'utf-8')
        return source.includes('buildAddressPool(') || source.includes('allocateAddresses(')
      })
      // The pool machinery itself, which takes capabilities as an argument and
      // resolves nothing.
      .filter((path) => !path.includes(join('utils', 'iec-address')))
  )
}

/**
 * The pool builders, by name.
 *
 * THE EXACT SET AND NOT A COUNT, which a `>=` guard cannot give. With nine
 * files found and a floor of eight, one file that quietly stops matching --
 * renamed helper, a builder moved behind an indirection -- leaves that file
 * unchecked by every assertion below while the suite stays green. That is the
 * silent pass this guard exists to prevent, one level down from where it was
 * looking.
 *
 * Failing on an ADDITION is the point rather than the cost. A new pool builder
 * is exactly the event this suite is here for, and the failure names the file
 * and asks its author to confirm it resolves the producer way. Updating this
 * list is one line, and it is the moment the question gets asked.
 */
const POOL_BUILDERS = [
  join('src', 'backend', 'shared', 'compile', 'steps', 'compute-io-image.ts'),
  join(
    'src',
    'frontend',
    'components',
    '_features',
    '[workspace]',
    'editor',
    'device',
    'configuration',
    'components',
    'pin-mapping-table.tsx',
  ),
  join(
    'src',
    'frontend',
    'components',
    '_features',
    '[workspace]',
    'editor',
    'device',
    'configuration',
    'vendor-screen',
    'layouts',
    'io-table-layout.tsx',
  ),
  join(
    'src',
    'frontend',
    'components',
    '_features',
    '[workspace]',
    'editor',
    'device',
    'configuration',
    'vendor-screen',
    'layouts',
    'module-slots-layout.tsx',
  ),
  join(
    'src',
    'frontend',
    'components',
    '_features',
    '[workspace]',
    'editor',
    'device',
    'ethercat',
    'ethercat-device-editor.tsx',
  ),
  join('src', 'frontend', 'components', '_features', '[workspace]', 'editor', 'device', 'ethercat', 'index.tsx'),
  join('src', 'frontend', 'hooks', 'use-alias-registry.ts'),
  join('src', 'frontend', 'hooks', 'use-device-configuration.ts'),
  join('src', 'frontend', 'store', 'slices', 'project', 'slice.ts'),
]

describe('address pools are scoped by the producer resolver', () => {
  it('finds exactly the pool builders it is meant to', () => {
    // A guard on the guard: a rename that makes the matcher match nothing --
    // or one file fewer -- would otherwise turn this whole suite into a
    // silent pass.
    expect(filesThatBuildAPool().sort()).toEqual([...POOL_BUILDERS].sort())
  })

  it.each(filesThatBuildAPool())('%s never resolves capabilities strictly', (path) => {
    expect(readFileSync(path, 'utf-8').split(`${STRICT}(`).length - 1).toBe(0)
  })

  it.each(filesThatBuildAPool())('%s resolves producers, or resolves nothing at all', (path) => {
    // THE POSITIVE, not only the negative. "Does not call the strict one"
    // leaves a tenth pool builder free to pass a hand-assembled capability
    // object, or `undefined`, or a block computed some other way — satisfying
    // the negative while reintroducing exactly the divergence this closes.
    //
    // A file that RECEIVES capabilities as an input is the legitimate other
    // shape: `compute-io-image.ts` takes them from the pipeline, which is
    // where the resolving happens. What must never occur is a builder that
    // resolves and resolves the wrong way, which the first assertion covers,
    // or one that resolves nothing and invents a block, which this one does.
    const source = readFileSync(path, 'utf-8')
    const resolves = source.includes(`${PRODUCER}(`)
    const receives = /capabilities[?:]/.test(source)
    expect(resolves || receives).toBe(true)
  })
})
