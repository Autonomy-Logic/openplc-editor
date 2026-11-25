import type { StlibArchiveDTO } from '../../../../../middleware/shared/ports/library-port'
import { createTestStore } from '../../../testing'

const archive = (name: string, block: string): StlibArchiveDTO => ({
  manifest: {
    name,
    version: '1.0.0',
    namespace: name,
    isBuiltin: false,
    functions: [],
    functionBlocks: [{ name: block, inputs: [], outputs: [], inouts: [] }],
    types: [],
  },
})

describe('libraryActions.applyInstalledLibraries', () => {
  it('puts the library tree, the POU requirements and the pre-installed names into the store', () => {
    const store = createTestStore()
    store.getState().libraryActions.applyInstalledLibraries(
      [archive('iec', 'TON'), archive('oscat', 'RAMP')],
      [
        { name: 'iec', bundled: true },
        { name: 'oscat', bundled: false },
      ],
    )
    const state = store.getState()
    expect(state.libraries.system.map((library) => library.name)).toEqual(['iec', 'oscat'])
    expect(state.libraries.system.map((library) => library.pous.map((pou) => pou.name))).toEqual([['TON'], ['RAMP']])
    expect(state.bundledLibraryNames).toEqual(['iec'])
    expect(state.pouRequirements).toEqual([])
  })
})
