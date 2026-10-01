/**
 * useNavigateToCompileError — branches on language + section to drive
 * the right tab/view/cursor combo.  The store actions are wrapped in
 * write-through spies so the test can pin which actions ran with which
 * arguments against a real store.
 */

import type { StructuredCompileError } from '@root/middleware/shared/ports/types'
import { renderHook } from '@testing-library/react'

import type { OpenPLCStore } from '../../store'
import { createPouObject } from '../../store/slices/shared/utils'
import { CreateEditorObjectFromTab } from '../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useNavigateToCompileError } from '../use-navigate-to-compile-error'

type PouLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

let store: OpenPLCStore

function addPou(overrides?: {
  name?: string
  pouType?: 'program' | 'function-block' | 'function'
  language?: PouLanguage
}) {
  const pou = createPouObject({
    name: overrides?.name ?? 'MANUAL_OVERRIDE',
    type: overrides?.pouType ?? 'function-block',
    language: overrides?.language ?? 'st',
  })
  const result = store.getState().projectActions.createPou(pou)
  if (!result.ok) throw new Error(`could not seed POU: ${result.message ?? ''}`)
}

/** Immer freezes the action namespaces, so spies go in as a swapped, write-through copy. */
function installActionSpies() {
  const { tabsActions, editorActions } = store.getState()
  const spies = {
    updateTabs: jest.fn(tabsActions.updateTabs),
    setSelectedTab: jest.fn(tabsActions.setSelectedTab),
    addModel: jest.fn(editorActions.addModel),
    setEditor: jest.fn(editorActions.setEditor),
    getEditorFromEditors: jest.fn(editorActions.getEditorFromEditors),
    setEditorCursor: jest.fn(editorActions.setEditorCursor),
    updateModelVariablesForName: jest.fn(editorActions.updateModelVariablesForName),
  }
  store.setState({
    tabsActions: { ...tabsActions, updateTabs: spies.updateTabs, setSelectedTab: spies.setSelectedTab },
    editorActions: {
      ...editorActions,
      addModel: spies.addModel,
      setEditor: spies.setEditor,
      getEditorFromEditors: spies.getEditorFromEditors,
      setEditorCursor: spies.setEditorCursor,
      updateModelVariablesForName: spies.updateModelVariablesForName,
    },
  })
  return spies
}

let spies: ReturnType<typeof installActionSpies>

function renderNavigate() {
  return renderHook(() => useNavigateToCompileError(), { wrapper: createStoreWrapper(store) })
}

const baseError = (overrides?: Partial<StructuredCompileError>): StructuredCompileError => ({
  message: 'error msg',
  line: 9,
  column: 1,
  severity: 'error',
  pouName: 'MANUAL_OVERRIDE',
  pouKind: 'FUNCTION_BLOCK',
  ...overrides,
})

beforeEach(() => {
  store = createTestStore()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useNavigateToCompileError', () => {
  it('opens the POU tab and places the cursor at bodyLine for body errors', () => {
    addPou()
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ section: 'body', bodyLine: 7, column: 5 }))

    expect(spies.updateTabs).toHaveBeenCalledTimes(1)
    expect(spies.updateTabs.mock.calls[0][0]).toEqual({
      name: 'MANUAL_OVERRIDE',
      path: 'MANUAL_OVERRIDE',
      elementType: { type: 'function-block', language: 'st' },
    })
    expect(spies.setSelectedTab).toHaveBeenCalledWith('MANUAL_OVERRIDE')
    expect(spies.setEditorCursor).toHaveBeenCalledWith('MANUAL_OVERRIDE', {
      lineNumber: 7,
      column: 5,
      offset: 0,
      target: 'body',
    })
    expect(spies.updateModelVariablesForName).not.toHaveBeenCalled()
  })

  it('falls back to error.line when bodyLine is unset', () => {
    addPou()
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ section: 'body', line: 12 }))

    expect(spies.setEditorCursor).toHaveBeenCalledWith('MANUAL_OVERRIDE', {
      lineNumber: 12,
      column: 1,
      offset: 0,
      target: 'body',
    })
  })

  it('switches the variables view to code mode and routes the cursor for var-block errors', () => {
    addPou()
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ section: 'var-block', line: 4, column: 3, variableName: 'ASD' }))

    expect(spies.updateModelVariablesForName).toHaveBeenCalledWith('MANUAL_OVERRIDE', { display: 'code' })
    expect(spies.setEditorCursor).toHaveBeenCalledWith('MANUAL_OVERRIDE', {
      lineNumber: 4,
      column: 3,
      offset: 0,
      target: 'variables',
    })
  })

  it('only opens the tab for graphical languages — no cursor jump', () => {
    addPou({ language: 'ld' })
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ section: 'body', bodyLine: 5 }))

    expect(spies.updateTabs).toHaveBeenCalledTimes(1)
    expect(spies.setSelectedTab).toHaveBeenCalledWith('MANUAL_OVERRIDE')
    expect(spies.setEditorCursor).not.toHaveBeenCalled()
    expect(spies.updateModelVariablesForName).not.toHaveBeenCalled()
  })

  it.each(['fbd', 'sfc'] as const)('treats %s the same as ld (graphical, no cursor)', (lang) => {
    addPou({ language: lang })
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ section: 'body', bodyLine: 5 }))

    expect(spies.updateTabs).toHaveBeenCalledTimes(1)
    expect(spies.setEditorCursor).not.toHaveBeenCalled()
  })

  it('opens the tab without cursor for interface-section errors', () => {
    addPou()
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ section: 'interface' }))

    expect(spies.updateTabs).toHaveBeenCalledTimes(1)
    expect(spies.setEditorCursor).not.toHaveBeenCalled()
    expect(spies.updateModelVariablesForName).not.toHaveBeenCalled()
  })

  it('is a no-op when the POU is not in the project (deleted between compile and click)', () => {
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ section: 'body', bodyLine: 7 }))

    expect(spies.updateTabs).not.toHaveBeenCalled()
    expect(spies.setSelectedTab).not.toHaveBeenCalled()
    expect(spies.setEditorCursor).not.toHaveBeenCalled()
  })

  it('is a no-op when the error has no pouName (synthetic / non-POU diagnostic)', () => {
    addPou()
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ pouName: undefined }))

    expect(spies.updateTabs).not.toHaveBeenCalled()
  })

  it('matches POU name case-insensitively (strucpp uppercases, project preserves user casing)', () => {
    addPou({ name: 'Manual_Override' }) // user-typed casing
    spies = installActionSpies()
    const { result } = renderNavigate()
    result.current(baseError({ pouName: 'MANUAL_OVERRIDE', section: 'body', bodyLine: 7 }))

    expect(spies.updateTabs).toHaveBeenCalledTimes(1)
    expect(spies.setSelectedTab).toHaveBeenCalledWith('Manual_Override') // canonical name from project
  })

  it('reuses an existing editor model when one is already open for the POU', () => {
    addPou()
    const existingModel = CreateEditorObjectFromTab({
      name: 'MANUAL_OVERRIDE',
      path: 'MANUAL_OVERRIDE',
      elementType: { type: 'function-block', language: 'st' },
    })
    store.getState().editorActions.addModel(existingModel)
    spies = installActionSpies()

    const { result } = renderNavigate()
    result.current(baseError({ section: 'body', bodyLine: 7 }))

    expect(spies.addModel).not.toHaveBeenCalled() // didn't recreate
    expect(spies.setEditor).toHaveBeenCalledWith(existingModel)
  })
})
