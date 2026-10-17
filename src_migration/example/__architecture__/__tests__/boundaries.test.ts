// Architecture tests: the real sources pass, and each kind of forbidden import is caught on synthetic input.
import { resolve } from 'node:path'

import { type BoundaryViolation, checkBoundaries, classify, type ExampleSource } from '../check-boundaries'
import { collectSources } from '../collect-sources'
import { LAYERS } from '../rules'

const EXAMPLE_ROOT = resolve(__dirname, '..', '..')

function check(path: string, text: string): readonly BoundaryViolation[] {
  return checkBoundaries([{ path, text }])
}

describe('example boundaries', () => {
  const sources: readonly ExampleSource[] = collectSources(EXAMPLE_ROOT)

  it('the example respects every boundary', () => {
    expect(checkBoundaries(sources)).toEqual([])
  })

  it('every layer has production sources', () => {
    const covered = new Set(
      sources.filter((source) => !source.path.includes('__tests__/')).map((source) => classify(source.path)),
    )
    expect(LAYERS.filter((layer) => !covered.has(layer))).toEqual([])
  })

  it.each<[string, string, string, string]>([
    ['a view importing state', 'frontend/x.tsx', "import { createVariableDocumentStore } from '../state'", '../state'],
    ['anything importing legacy src', 'domain/x.ts', "import { x } from '../../../src/frontend/store'", 'outside'],
    ['the legacy @root alias', 'presentation/x.ts', "import { x } from '@root/frontend/store'", '@root'],
    ['zustand outside state', 'application/x.ts', "import { createStore } from 'zustand/vanilla'", 'zustand'],
    ['react in presentation', 'presentation/x.ts', "import { useState } from 'react'", 'react'],
    ['a deep import into another layer', 'presentation/x.ts', "import type { X } from '../domain/variable'", 'private'],
    ['a stylesheet outside design-system', 'frontend/x.tsx', "import styles from './x.module.css'", 'stylesheets'],
    ['a re-export of a forbidden layer', 'frontend/x.ts', "export { x } from '../infrastructure'", 'infrastructure'],
    ['a dynamic import of a forbidden layer', 'domain/x.ts', "const m = import('../application')", 'application'],
    [
      'a test importing a layer its own layer may not use',
      'domain/__tests__/x.test.ts',
      "import '../../state'",
      'state',
    ],
    ['a file outside every layer', 'utils/x.ts', 'export const x = 1', 'not part of any layer'],
  ])('rejects %s', (_label, path, text, hint) => {
    const violations = check(path, text)
    expect(violations).toHaveLength(1)
    expect(`${violations[0].specifier} ${violations[0].reason}`).toContain(hint)
  })

  it('allows the documented dependencies', () => {
    expect(check('state/x.ts', "import type { P } from '../application/ports'")).toEqual([])
    expect(check('infrastructure/x.ts', "import { isVariableType } from '../domain/index'")).toEqual([])
    expect(check('react-bindings/__tests__/x.test.tsx', "import { f } from '../../fixtures'")).toEqual([])
    expect(check('composition/x.ts', "import { createVariableDocumentStore } from '../state'")).toEqual([])
  })
})
