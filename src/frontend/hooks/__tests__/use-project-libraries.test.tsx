import { renderHook } from '@testing-library/react'
import { act } from 'react'

import { libraryPouRequirements } from '../../../middleware/shared/utils/library/pou-requirements'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { stlibToSystemLibrary } from '../../utils/stlib-to-system-library'
import { useProjectLibraryNames, useProjectPlcLibraries } from '../use-project-libraries'

const archive = (name: string, blocks: string[], chunks: object[]) => ({
  formatVersion: 1,
  manifest: {
    name,
    version: '1.0.0',
    namespace: name,
    functions: [],
    functionBlocks: blocks.map((b) => ({ name: b, inputs: [], outputs: [], inouts: [] })),
    types: [],
    headers: [],
    isBuiltin: false,
  },
  chunks,
  dependencies: [],
  sources: [],
  globalConstants: {},
})
const chunk = (name: string, headers: object[] = []) => ({
  name,
  kind: 'functionBlock',
  header: '',
  cpp: '',
  deps: [],
  headers,
})

const standard = archive('standard', ['TON'], [chunk('TON')])
const widgets = archive(
  'widgets',
  ['HMIBUTTON', 'FMT'],
  [chunk('HMIBUTTON', [{ name: 'hmi_core.h', version: '1' }]), chunk('FMT')],
)
const userLib = archive('user-lib', ['PUMP'], [chunk('PUMP')])
const unlisted = archive('unlisted', ['MIXER'], [chunk('MIXER')])

function seededStore() {
  const store = createTestStore()
  const archives = [standard, widgets, userLib, unlisted]
  const { libraryActions } = store.getState()
  libraryActions.setSystemLibraries(archives.map(stlibToSystemLibrary))
  libraryActions.setPouRequirements(libraryPouRequirements(archives))
  libraryActions.setBundledLibraryNames(['standard', 'widgets'])
  libraryActions.setProjectLibraries([
    { name: 'user-lib', version: '1.0.0' },
    { name: 'missing-lib', version: '1.0.0' },
  ])
  return store
}

describe('useProjectPlcLibraries', () => {
  it('shows the bundled and listed libraries only, without widgets', () => {
    const store = seededStore()
    const { result } = renderHook(() => useProjectPlcLibraries(), { wrapper: createStoreWrapper(store) })
    expect(result.current.map((l) => [l.name, l.pous.map((p) => p.name)])).toEqual([
      ['standard', ['TON']],
      ['widgets', ['FMT']],
      ['user-lib', ['PUMP']],
    ])
  })

  it('follows the project list: an unlisted installed library appears once the project lists it', () => {
    const store = seededStore()
    const { result } = renderHook(() => useProjectPlcLibraries(), { wrapper: createStoreWrapper(store) })
    expect(result.current.map((l) => l.name)).not.toContain('unlisted')
    act(() => store.getState().libraryActions.enableLibrary('unlisted'))
    expect(result.current.map((l) => l.name)).toContain('unlisted')
  })
})

describe('useProjectLibraryNames', () => {
  it('names the bundled libraries, then the listed ones that are installed', () => {
    const store = seededStore()
    const { result } = renderHook(() => useProjectLibraryNames(), { wrapper: createStoreWrapper(store) })
    expect(result.current).toEqual(['standard', 'widgets', 'user-lib'])
    expect(store.getState().missingLibraries.map((m) => m.name)).toEqual(['missing-lib'])
  })
})
