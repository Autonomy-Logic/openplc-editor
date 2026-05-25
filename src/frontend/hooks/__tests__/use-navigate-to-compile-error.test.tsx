/**
 * useNavigateToCompileError — branches on language + section to drive
 * the right tab/view/cursor combo.  The store calls are stubbed at the
 * module boundary so the test can pin which actions ran with which
 * arguments without spinning up the full Zustand machinery.
 */

import { renderHook } from '@testing-library/react'

import type { StructuredCompileError } from '@root/middleware/shared/ports/types'

import { useNavigateToCompileError } from '../use-navigate-to-compile-error'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const updateTabs = jest.fn()
const setSelectedTab = jest.fn()
const addModel = jest.fn()
const setEditor = jest.fn()
const getEditorFromEditors = jest.fn(() => null)
const setEditorCursor = jest.fn()
const updateModelVariablesForName = jest.fn()

const samplePou = (overrides?: {
  name?: string
  pouType?: 'program' | 'function-block' | 'function'
  language?: string
}) => ({
  name: overrides?.name ?? 'MANUAL_OVERRIDE',
  pouType: overrides?.pouType ?? 'function-block',
  body: { language: overrides?.language ?? 'st', value: '' },
})

let mockPous: ReturnType<typeof samplePou>[] = []

jest.mock('../../store', () => ({
  useOpenPLCStore: (selector: (state: unknown) => unknown) =>
    selector({
      project: { data: { pous: mockPous } },
      tabsActions: { updateTabs, setSelectedTab },
      editorActions: {
        addModel,
        setEditor,
        getEditorFromEditors,
        setEditorCursor,
        updateModelVariablesForName,
      },
    }),
}))

// CreateEditorObjectFromTab is invoked when no model exists yet — return
// a stable object so we can assert addModel/setEditor were called with it.
jest.mock('../../store/slices/tabs/utils', () => ({
  CreateEditorObjectFromTab: jest.fn((tab: unknown) => ({ __mockModel: true, tab })),
}))

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
  jest.clearAllMocks()
  mockPous = [samplePou()]
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useNavigateToCompileError', () => {
  it('opens the POU tab and places the cursor at bodyLine for body errors', () => {
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'body', bodyLine: 7, column: 5 }))

    expect(updateTabs).toHaveBeenCalledTimes(1)
    expect(updateTabs.mock.calls[0][0]).toEqual({
      name: 'MANUAL_OVERRIDE',
      path: 'MANUAL_OVERRIDE',
      elementType: { type: 'function-block', language: 'st' },
    })
    expect(setSelectedTab).toHaveBeenCalledWith('MANUAL_OVERRIDE')
    expect(setEditorCursor).toHaveBeenCalledWith('MANUAL_OVERRIDE', {
      lineNumber: 7,
      column: 5,
      offset: 0,
      target: 'body',
    })
    expect(updateModelVariablesForName).not.toHaveBeenCalled()
  })

  it('falls back to error.line when bodyLine is unset', () => {
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'body', line: 12 }))

    expect(setEditorCursor).toHaveBeenCalledWith('MANUAL_OVERRIDE', {
      lineNumber: 12,
      column: 1,
      offset: 0,
      target: 'body',
    })
  })

  it('switches the variables view to code mode and routes the cursor for var-block errors', () => {
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'var-block', line: 4, column: 3, variableName: 'ASD' }))

    expect(updateModelVariablesForName).toHaveBeenCalledWith('MANUAL_OVERRIDE', { display: 'code' })
    expect(setEditorCursor).toHaveBeenCalledWith('MANUAL_OVERRIDE', {
      lineNumber: 4,
      column: 3,
      offset: 0,
      target: 'variables',
    })
  })

  it('only opens the tab for graphical languages — no cursor jump', () => {
    mockPous = [samplePou({ language: 'ld' })]
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'body', bodyLine: 5 }))

    expect(updateTabs).toHaveBeenCalledTimes(1)
    expect(setSelectedTab).toHaveBeenCalledWith('MANUAL_OVERRIDE')
    expect(setEditorCursor).not.toHaveBeenCalled()
    expect(updateModelVariablesForName).not.toHaveBeenCalled()
  })

  it.each(['fbd', 'sfc'])('treats %s the same as ld (graphical, no cursor)', (lang) => {
    mockPous = [samplePou({ language: lang })]
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'body', bodyLine: 5 }))

    expect(updateTabs).toHaveBeenCalledTimes(1)
    expect(setEditorCursor).not.toHaveBeenCalled()
  })

  it('opens the tab without cursor for interface-section errors', () => {
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'interface' }))

    expect(updateTabs).toHaveBeenCalledTimes(1)
    expect(setEditorCursor).not.toHaveBeenCalled()
    expect(updateModelVariablesForName).not.toHaveBeenCalled()
  })

  it('is a no-op when the POU is not in the project (deleted between compile and click)', () => {
    mockPous = []
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'body', bodyLine: 7 }))

    expect(updateTabs).not.toHaveBeenCalled()
    expect(setSelectedTab).not.toHaveBeenCalled()
    expect(setEditorCursor).not.toHaveBeenCalled()
  })

  it('is a no-op when the error has no pouName (synthetic / non-POU diagnostic)', () => {
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ pouName: undefined }))

    expect(updateTabs).not.toHaveBeenCalled()
  })

  it('matches POU name case-insensitively (strucpp uppercases, project preserves user casing)', () => {
    mockPous = [samplePou({ name: 'Manual_Override' })] // user-typed casing
    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ pouName: 'MANUAL_OVERRIDE', section: 'body', bodyLine: 7 }))

    expect(updateTabs).toHaveBeenCalledTimes(1)
    expect(setSelectedTab).toHaveBeenCalledWith('Manual_Override') // canonical name from project
  })

  it('reuses an existing editor model when one is already open for the POU', () => {
    const existingModel = { __existing: true }
    getEditorFromEditors.mockReturnValueOnce(existingModel as never)

    const { result } = renderHook(() => useNavigateToCompileError())
    result.current(baseError({ section: 'body', bodyLine: 7 }))

    expect(addModel).not.toHaveBeenCalled() // didn't recreate
    expect(setEditor).toHaveBeenCalledWith(existingModel)
  })
})
