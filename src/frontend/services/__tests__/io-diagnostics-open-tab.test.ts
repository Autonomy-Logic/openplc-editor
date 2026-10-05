/**
 * The diagnostics tab opens the same way from either menu.
 *
 * A desktop build shows one of two menus depending on whether the window is
 * framed, so this helper has two callers. What is pinned here is that opening
 * twice reuses the one tab rather than stacking a second.
 */

import { openPLCStoreBase } from '@root/frontend/store'

import { DIAGNOSTICS_TAB_NAME, openDiagnosticsTab } from '../io-diagnostics/open-tab'

const getState = () => openPLCStoreBase.getState()

describe('openDiagnosticsTab', () => {
  beforeEach(() => {
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('opens the tab and makes it the active editor', () => {
    openDiagnosticsTab()

    expect(getState().tabs.map((tab) => tab.name)).toContain(DIAGNOSTICS_TAB_NAME)
    expect(getState().editor.type).toBe('plc-diagnostics')
    expect(getState().editor.meta.name).toBe(DIAGNOSTICS_TAB_NAME)
  })

  it('reuses the open tab instead of stacking a second', () => {
    openDiagnosticsTab()
    getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
    openDiagnosticsTab()

    expect(getState().tabs.filter((tab) => tab.name === DIAGNOSTICS_TAB_NAME)).toHaveLength(1)
    expect(getState().editors.filter((model) => model.type === 'plc-diagnostics')).toHaveLength(1)
    expect(getState().editor.type).toBe('plc-diagnostics')
  })
})
