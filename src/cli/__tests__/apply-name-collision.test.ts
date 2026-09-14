/**
 * A spec is a declaration: the name it asks for is the name the rest of the
 * document refers to.
 *
 * The store's `createVariable` auto-increments a colliding name instead of
 * refusing it — that is right for the "+" button in the variables table and
 * wrong for `apply`, where it produced a silent, destructive combination: the
 * renamed variable is not in the spec, so `--prune` deletes it on the same run,
 * and the command still reports success. The failure only surfaced later as
 * `VAR_EXTERNAL '<name>' has no matching VAR_GLOBAL`.
 *
 * Found by binding a global to a Modbus I/O point alias of the same name.
 * Aliases, POUs, data types and globals share one namespace, so any of them can
 * claim a name out from under a variable.
 *
 * A duplicate name WITHIN one spec is not this: the spec is upsert-by-name, so
 * the second entry updates the first.
 */

import { openPLCStoreBase } from '@root/frontend/store'

// The FBD body applier reaches the FBD component modules, which do not load
// under jest. Nothing here applies an FBD body.
jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const BOOL = { definition: 'base-type' as const, value: 'BOOL' }

const apply = (spec: Partial<ApplySpec>, prune = false) =>
  applySpec({ specVersion: 1, ...spec } as ApplySpec, { prune, projectPath: '/does/not/matter' })

const globalsIn = () => openPLCStoreBase.getState().project.data.configurations.resource.globalVariables

describe('a name another element already owns', () => {
  it('reports it instead of accepting a renamed variable', async () => {
    const result = await apply({
      pous: [{ name: 'Level', kind: 'program', language: 'st', variables: [], body: { text: '' } }],
      globalVariables: [{ name: 'Level', class: 'global', type: BOOL }],
    } as Partial<ApplySpec>)

    expect(result.errors.some((error) => error.includes('"Level" could not take that name'))).toBe(true)
    // And it must say WHY. The store throws the reason away, so the driver asks
    // the same gate again — a library block, a POU, a device alias and a
    // reserved word all arrive here and send the reader somewhere different.
    expect(result.errors.some((error) => error.includes('POU'))).toBe(true)
  })

  it('leaves no renamed survivor behind', async () => {
    await apply({
      pous: [{ name: 'Flow', kind: 'program', language: 'st', variables: [], body: { text: '' } }],
      globalVariables: [{ name: 'Flow', class: 'global', type: BOOL }],
    } as Partial<ApplySpec>)

    // Whatever the store did with the name, the command failed — so a caller
    // that reads `errors` never acts on a project it thinks has `Flow`.
    expect(globalsIn().some((variable) => variable.name === 'Flow')).toBe(false)
  })

  it("refuses to change an existing POU's language rather than ignoring it", async () => {
    // The body is stored in a file named for the language, so a change would
    // write `X.st` beside the existing `X.ld` and the loader would keep reading
    // the old one — the project silently compiles a body the spec no longer
    // describes.
    await apply({
      pous: [{ name: 'Switcher', kind: 'program', language: 'st', variables: [], body: { text: '' } }],
    } as Partial<ApplySpec>)

    const result = await apply({
      pous: [{ name: 'Switcher', kind: 'program', language: 'il', variables: [], body: { text: '' } }],
    } as Partial<ApplySpec>)

    expect(result.errors.some((error) => error.includes('cannot be changed in place'))).toBe(true)
    expect(result.errors.some((error) => error.includes('is st and the spec asks for il'))).toBe(true)
  })

  it('says nothing when every name is honoured', async () => {
    const result = await apply({
      globalVariables: [
        { name: 'LevelA', class: 'global', type: BOOL },
        { name: 'LevelB', class: 'global', type: BOOL },
      ],
    })

    expect(result.errors).toEqual([])
    expect(globalsIn().map((variable) => variable.name)).toEqual(expect.arrayContaining(['LevelA', 'LevelB']))
  })

  it('treats a repeated name inside one spec as an upsert, not a collision', async () => {
    const result = await apply({
      globalVariables: [
        { name: 'Repeated', class: 'global', type: BOOL },
        { name: 'Repeated', class: 'global', type: BOOL },
      ],
    })

    expect(result.errors).toEqual([])
    expect(globalsIn().filter((variable) => variable.name === 'Repeated')).toHaveLength(1)
  })
})
