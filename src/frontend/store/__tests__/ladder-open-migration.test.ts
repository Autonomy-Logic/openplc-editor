import { readCorpusProject } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'

import { createTestStore } from '../testing'

describe('opening a project saved in the old LD layout', () => {
  it('converts its LD POUs, marks them modified and keeps them for the next save', () => {
    const store = createTestStore()
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(readCorpusProject('ld-corpus-parallel-width'))
    const state = store.getState()
    expect(state.ladderFlows.map((flow) => [flow.name, flow.updated])).toEqual([
      ['Blocks', true],
      ['Branches', true],
    ])
    expect([state.files.Blocks?.saved, state.files.Branches?.saved]).toEqual([false, false])
  })
})
