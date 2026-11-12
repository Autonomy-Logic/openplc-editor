import Toaster from '@root/frontend/components/_features/[app]/toast/toaster'
import { Console } from '@root/frontend/components/_organisms/console'
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { getMemoryState, toast } from '@root/frontend/utils/toast'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { WriteProjectFiles } from '@root/middleware/shared/ports/project-port'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

const UNCLOSED = 'VAR\n  bFirstScan : BOOL := TRUE; (* Executado (* ciclo 1 *)\n  Q1 AT %QX0.0 : BOOL;'
const FIXED = 'VAR\n  bFirstScan : BOOL := TRUE; (* Executado (* ciclo 1 *) *)\n  Q1 AT %QX0.0 : BOOL;\nEND_VAR'
const BODY = 'Q1 := bFirstScan;'

const BOARD_NAME = 'OpenPLC Runtime'
const BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

const compileProgram = vi.fn(() => Promise.resolve({ success: true }))
const compileForDebug = vi.fn(() => Promise.resolve({ success: true }))
const compileLibrary = vi.fn(() => Promise.resolve({ success: true }))
const savedFiles: WriteProjectFiles[] = []
const saveProject = vi.fn((files: WriteProjectFiles) => {
  savedFiles.push(files)
  return Promise.resolve({ success: true })
})

let store: OpenPLCStore

interface CompileEntry {
  name: string
  library: boolean
  pou: string
  start: () => void
  compiled: () => boolean
}

function chooseBuildOption(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Build options' }))
  const row = screen.getByText(label).closest('button')
  if (!row) throw new Error(`build option "${label}" rendered without a button`)
  fireEvent.click(row)
}

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })

const BUILD: CompileEntry = {
  name: 'Build',
  library: false,
  pou: 'main',
  start: () => chooseBuildOption('Build only'),
  compiled: () => compileProgram.mock.calls.length > 0,
}

const DEBUGGER: CompileEntry = {
  name: 'Debugger',
  library: false,
  pou: 'main',
  start: () => fireEvent.click(button('Debugger')),
  compiled: () => compileForDebug.mock.calls.length > 0,
}

const BUILD_LIBRARY: CompileEntry = {
  name: 'Build Library',
  library: true,
  pou: 'Counter',
  start: () => fireEvent.click(button('Build Library')),
  compiled: () => compileLibrary.mock.calls.length > 0,
}

const DEBUG_LIBRARY: CompileEntry = {
  name: 'Debug Library',
  library: true,
  pou: 'Counter',
  start: () => fireEvent.click(button('Debugger')),
  compiled: () => compileProgram.mock.calls.length > 0,
}

const ALL_COMPILES = [BUILD, DEBUGGER, BUILD_LIBRARY, DEBUG_LIBRARY]

/** Build Library saves without consulting `canEdit`, so only the other three can run as a viewer. */
const VIEWER_COMPILES = [BUILD, DEBUGGER, DEBUG_LIBRARY]

function seed(entry: CompileEntry, buffer: string) {
  const state = store.getState()
  if (entry.library) {
    state.projectActions.setProject({
      ...state.project,
      meta: { ...state.project.meta, name: 'lib', type: 'plc-library', path: '/projects/lib' },
    })
  }
  const type = entry.library ? 'function-block' : 'program'
  expect(store.getState().pouActions.create({ type, name: entry.pou, language: 'st' }).ok).toBe(true)
  store.getState().projectActions.updatePou({ name: entry.pou, content: { language: 'st', value: BODY } })
  store.getState().editorActions.addModel({
    type: 'plc-textual',
    meta: { name: entry.pou, path: `/pous/${entry.pou}`, language: 'st', pouType: type },
    variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '-1' },
  })
  typeIntoCodeView(entry.pou, buffer)
}

function typeIntoCodeView(pouName: string, code: string) {
  store.getState().editorActions.updateModelVariablesForName(pouName, { display: 'code', code })
}

function renderBar(options: { canEdit: boolean; withConsole?: boolean }) {
  const { deviceActions, workspaceActions, consoleActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD_NAME, BOARD]]) })
  deviceActions.setDeviceBoard(BOARD_NAME)
  deviceActions.setSelectedDevice(null)
  deviceActions.setRuntimeConnectionStatus('connected')
  deviceActions.setDeviceConnectionStatus('connected')
  workspaceActions.setCanEdit(options.canEdit)
  consoleActions.clearLogs()

  const ports = createTestPorts({
    capabilities: EDITOR_CAPABILITIES,
    compiler: { compileProgram, compileForDebug, compileLibrary },
    debugger: {
      readProgramMd5: () => Promise.resolve({ success: true, md5: 'local-md5' }),
      connect: () => Promise.resolve({ success: true }),
      verifyMd5: () => Promise.resolve({ success: true, match: false, targetMd5: 'device-md5' }),
      disconnect: () => Promise.resolve({ success: true }),
    },
    project: { saveProject },
  })
  render(
    <>
      <DefaultWorkspaceActivityBar />
      {options.withConsole && (
        <>
          <Console />
          <Toaster />
        </>
      )}
    </>,
    { wrapper: createStoreWrapper(store, ports) },
  )
}

const refusalPrefix = (pouName: string) => `Build refused: The variables of "${pouName}" do not parse: line `

function refusalLog(pouName: string) {
  return store.getState().logs.find((entry) => entry.message.startsWith(refusalPrefix(pouName)))
}

function savedPouFile(pouName: string) {
  const last = savedFiles[savedFiles.length - 1]
  return last?.pouFiles.find((file) => file.relativePath.endsWith(`/${pouName}.st`))?.content
}

function editorBuffer(pouName: string) {
  const model = store.getState().editorActions.getEditorFromEditors(pouName)
  const variable = model && 'variable' in model ? model.variable : undefined
  return variable && 'code' in variable ? variable.code : undefined
}

describe('Build is refused while the variables text does not parse', () => {
  beforeEach(() => {
    compileProgram.mockClear()
    compileForDebug.mockClear()
    compileLibrary.mockClear()
    saveProject.mockClear()
    savedFiles.length = 0
    getMemoryState().toasts.length = 0
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it.each(ALL_COMPILES)('$name refuses an unclosed comment in the code view and never compiles', async (entry) => {
    seed(entry, UNCLOSED)
    renderBar({ canEdit: true })

    entry.start()

    await waitFor(() => expect(refusalLog(entry.pou)).toBeDefined())
    expect(refusalLog(entry.pou)?.level).toBe('error')
    expect(refusalLog(entry.pou)?.message).toMatch(/Unclosed block comment/)
    expect(entry.compiled()).toBe(false)
  })

  it.each(ALL_COMPILES)('$name saves the typed text as typed before refusing', async (entry) => {
    seed(entry, UNCLOSED)
    renderBar({ canEdit: true })

    entry.start()

    await waitFor(() => expect(refusalLog(entry.pou)).toBeDefined())
    expect(savedFiles).toHaveLength(1)
    expect(savedPouFile(entry.pou)).toContain(`\n${UNCLOSED}\n`)
    expect(editorBuffer(entry.pou)).toBe(UNCLOSED)
    expect(store.getState().project.data.pous.find((pou) => pou.name === entry.pou)?.body.value).toBe(BODY)
  })

  it.each(ALL_COMPILES)('$name shows the refusal in a failure toast', async (entry) => {
    seed(entry, UNCLOSED)
    renderBar({ canEdit: true })

    entry.start()

    await waitFor(() => expect(refusalLog(entry.pou)).toBeDefined())
    const shown = getMemoryState().toasts.find((candidate) => candidate.title === 'Build refused')
    expect(shown?.variant).toBe('fail')
    expect(shown?.description).toBe(refusalLog(entry.pou)?.message.slice('Build refused: '.length))
  })

  it.each(VIEWER_COMPILES)('$name skips the save without write permission and still refuses', async (entry) => {
    seed(entry, UNCLOSED)
    renderBar({ canEdit: false })

    entry.start()

    await waitFor(() => expect(refusalLog(entry.pou)).toBeDefined())
    expect(savedFiles).toHaveLength(0)
    expect(entry.compiled()).toBe(false)
  })

  it.each(ALL_COMPILES)('$name compiles once the user closes the comment and adds END_VAR', async (entry) => {
    seed(entry, UNCLOSED)
    renderBar({ canEdit: true })
    entry.start()
    await waitFor(() => expect(refusalLog(entry.pou)).toBeDefined())

    typeIntoCodeView(entry.pou, FIXED)
    entry.start()

    await waitFor(() => expect(entry.compiled()).toBe(true))
    const saved = savedPouFile(entry.pou)
    expect(saved).toContain(`\n${FIXED}\n`)
    expect(saved).not.toContain(UNCLOSED)
  })

  it('refuses the stored text of a POU the loader could not parse, with no code view open', async () => {
    expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'st' }).ok).toBe(true)
    store.getState().projectActions.setPouVariablesText('main', UNCLOSED, true)
    renderBar({ canEdit: false })

    BUILD.start()

    await waitFor(() => expect(refusalLog('main')).toBeDefined())
    expect(compileProgram).not.toHaveBeenCalled()
  })

  /**
   * AS5: markup in a parse error reaches the console line and the toast as text.
   * Fed at component level so it does not depend on the parser's wording.
   */
  it('shows markup in a Build-blocked message as text in the console line and the toast', async () => {
    const markup = '<img src=x onerror=alert(1)>'
    const reason = `The variables of "main" do not parse: line 2: Unexpected ${markup} at line 2`
    renderBar({ canEdit: false, withConsole: true })

    act(() => {
      store.getState().consoleActions.addLog({ level: 'error', message: `Build refused: ${reason}` })
      toast({ title: 'Build refused', description: reason, variant: 'fail' })
    })

    const consolePanel = screen.getByLabelText('Console')
    const logLine = within(consolePanel).getByText(
      (_content, element) => element?.tagName === 'P' && (element.textContent ?? '').includes(markup),
    )
    const toastMessages = await screen.findAllByText(reason)
    for (const element of [logLine, ...toastMessages]) {
      expect(element.textContent).toContain(markup)
      expect(element.querySelector('img[src="x"]')).toBeNull()
    }
    expect(consolePanel.querySelector('img[src="x"]')).toBeNull()
  })

  it('leaves a project whose variables parse untouched by the gate', async () => {
    seed(BUILD, FIXED)
    renderBar({ canEdit: true })

    BUILD.start()

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(refusalLog(BUILD.pou)).toBeUndefined()
  })
})
