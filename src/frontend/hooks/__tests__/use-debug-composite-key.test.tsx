import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import { renderHook } from '@testing-library/react'

import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { useDebugCompositeKey } from '../use-debug-composite-key'

const variable = (name: string, cls: PLCVariable['class']): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'BOOL' },
  location: '',
  documentation: '',
})

const ldarr: PLCPou = {
  name: 'ldarr',
  pouType: 'program',
  interface: { variables: [variable('g_plant', 'external'), variable('lp', 'local')] },
  body: { language: 'ld', value: { name: 'ldarr', rungs: [] } },
} as unknown as PLCPou

describe('useDebugCompositeKey', () => {
  it('keys a contact on a VAR_EXTERNAL global under the canonical key and a local under the POU', () => {
    const store = createTestStore()
    const state = store.getState()
    store.setState({
      project: { ...state.project, data: { ...state.project.data, pous: [ldarr] } },
      editor: { ...state.editor, meta: { ...state.editor.meta, name: 'ldarr' } } as typeof state.editor,
    })

    const { result } = renderHook(() => useDebugCompositeKey(), {
      wrapper: createStoreWrapper(store, createTestPorts({ capabilities: EDITOR_CAPABILITIES })),
    })

    expect(result.current('g_plant.LINES[2].MOTORS[1].RUNNING')).toBe('Config0:g_plant.LINES[2].MOTORS[1].RUNNING')
    expect(result.current('lp.LINES[1].MOTORS[1].RUNNING')).toBe('ldarr:lp.LINES[1].MOTORS[1].RUNNING')
  })
})
