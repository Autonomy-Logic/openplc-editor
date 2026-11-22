/**
 * @jest-environment node
 * @vitest-environment node
 */
import {
  ldPouNames,
  readCorpusProject,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import { savedRungs } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'

import { pouLabelSource } from '../labels'
import { migrateLadderRungs } from '../migrate'

describe('migrateLadderRungs', () => {
  const { projectData } = readCorpusProject('ld-corpus-basic')

  it('converts every rung saved in the old layout, keeping every element and the compiled order, without warnings', () => {
    for (const pou of ldPouNames(projectData)) {
      const before = savedRungs(projectData, pou)
      const migration = migrateLadderRungs(pou, before, pouLabelSource(projectData, pou))
      expect({ pou, changed: migration.changed, warnings: migration.warnings }).toEqual({
        pou,
        changed: true,
        warnings: [],
      })
      // Every node keeps its id and its data (variables, variants, pins); only geometry may change.
      const content = (rungs: typeof before) =>
        rungs.map((rung) => rung.nodes.map((node) => JSON.stringify([node.id, node.type, node.data.variable ?? null])))
      expect(content(migration.rungs)).toEqual(content(before))
    }
  })

  it('leaves a POU already in the new layout unchanged', () => {
    const pou = ldPouNames(projectData)[0]
    const src = pouLabelSource(projectData, pou)
    const once = migrateLadderRungs(pou, savedRungs(projectData, pou), src)
    expect(migrateLadderRungs(pou, once.rungs, src).changed).toBe(false)
  })
})
