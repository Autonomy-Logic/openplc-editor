import type { OpenPLCStore } from '@root/frontend/store'
import { createTestStore } from '@root/frontend/store/testing'
import type { ProjectPort } from '@root/middleware/shared/ports/project-port'

import { externalReloadWarning, resolveExternalBodyReload } from '../external-pou-reload'

const FILE_PATH = '/projects/demo/pous/programs/main.st'
const BODY = 'counter := counter + 1;\nmarker := 1;'

const ON_DISK = [
  'PROGRAM main',
  '  VAR',
  '    counter : INT;',
  '    marker : INT;',
  '  END_VAR',
  '',
  'counter := counter + 1;',
  'marker := 1;',
  '',
  'END_PROGRAM',
].join('\n')

/** The AS6 rewrite: the same file without its `END_VAR` line and with a different body. */
const REWRITTEN = ON_DISK.replace('  END_VAR\n', '').replace('marker := 1;', 'marker := 2;')

const CHANGED = ON_DISK.replace('marker := 1;', 'marker := 9;')

let store: OpenPLCStore

function portReturning(answer: { success: boolean; content?: string }): { port: ProjectPort; reads: string[] } {
  const reads: string[] = []
  const port = {
    readFileContent: (filePath: string) => {
      reads.push(filePath)
      return Promise.resolve(answer)
    },
  } as unknown as ProjectPort
  return { port, reads }
}

function seedMain(): void {
  expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'st' }).ok).toBe(true)
  store.getState().projectActions.updatePou({ name: 'main', content: { language: 'st', value: BODY } })
  store.getState().projectActions.setPouVariablesText('main', 'VAR\n  counter : INT;\n  marker : INT;\nEND_VAR', false)
  store.getState().editorActions.addModel({
    type: 'plc-textual',
    meta: { name: 'main', path: '/pous/main', language: 'st', pouType: 'program' },
    variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '-1' },
  })
}

const reload = (port: ProjectPort) =>
  resolveExternalBodyReload(store, port, {
    pouName: 'main',
    filePath: FILE_PATH,
    language: 'st',
    pouType: 'program',
  })

const bodyOf = () => store.getState().project.data.pous.find((pou) => pou.name === 'main')?.body.value

const variableNamesOf = () =>
  store
    .getState()
    .project.data.pous.find((pou) => pou.name === 'main')
    ?.interface?.variables.map((variable) => variable.name)

describe('resolveExternalBodyReload', () => {
  beforeEach(() => {
    store = createTestStore()
    seedMain()
  })

  it('applies a body that changed on disk', async () => {
    const { port } = portReturning({ success: true, content: CHANGED })

    await expect(reload(port)).resolves.toEqual({ kind: 'apply', body: 'counter := counter + 1;\nmarker := 9;' })
  })

  it('reports an unchanged body as unchanged', async () => {
    const { port } = portReturning({ success: true, content: ON_DISK })

    await expect(reload(port)).resolves.toEqual({ kind: 'unchanged' })
  })

  it('skips a POU whose code view holds a buffer the store has not taken in, without reading the file', async () => {
    store.getState().editorActions.updateModelVariablesForName('main', {
      display: 'code',
      code: 'VAR\n  counter : INT;\n  marker : INT;\n  extra : BOOL;\nEND_VAR',
    })
    const { port, reads } = portReturning({ success: true, content: CHANGED })

    await expect(reload(port)).resolves.toEqual({ kind: 'skip-unapplied-variables', filePath: FILE_PATH })
    expect(reads).toEqual([])
  })

  it('skips a POU whose stored text could not be parsed, without reading the file', async () => {
    store.getState().projectActions.setPouVariablesText('main', 'VAR\n  counter : INT;', true)
    const { port, reads } = portReturning({ success: true, content: CHANGED })

    await expect(reload(port)).resolves.toEqual({ kind: 'skip-unapplied-variables', filePath: FILE_PATH })
    expect(reads).toEqual([])
  })

  it('reports a file that does not parse and leaves the body and the variables alone', async () => {
    const { port } = portReturning({ success: true, content: REWRITTEN })

    const outcome = await reload(port)

    expect(outcome.kind).toBe('parse-failed')
    if (outcome.kind !== 'parse-failed') return
    expect(outcome.filePath).toBe(FILE_PATH)
    expect(outcome.message).toMatch(/line \d+/)
    expect(bodyOf()).toBe(BODY)
    expect(variableNamesOf()).toEqual(['counter', 'marker'])
  })

  it.each([
    ['the read failed', { success: false }],
    ['the file came back empty', { success: true, content: '' }],
  ])('reports a read that gave nothing to parse: %s', async (_label, answer) => {
    const { port } = portReturning(answer)

    await expect(reload(port)).resolves.toEqual({ kind: 'read-failed', filePath: FILE_PATH })
  })

  it.each([
    ['apply', CHANGED],
    ['unchanged', ON_DISK],
    ['parse-failed', REWRITTEN],
  ])('never writes to the store, outcome %s', async (_label, content) => {
    const { port } = portReturning({ success: true, content })

    await reload(port)

    expect(bodyOf()).toBe(BODY)
    expect(variableNamesOf()).toEqual(['counter', 'marker'])
  })
})

describe('externalReloadWarning', () => {
  it.each([
    ['parse-failed', { kind: 'parse-failed', filePath: FILE_PATH, message: 'Parse error on line 3: boom' }],
    ['skip-unapplied-variables', { kind: 'skip-unapplied-variables', filePath: FILE_PATH }],
  ] as const)('names the file and says the editor kept its content, for %s', (_label, outcome) => {
    const warning = externalReloadWarning(outcome)

    expect(warning).not.toBeNull()
    expect(warning?.title).toBe('File not reloaded')
    expect(warning?.description).toContain(FILE_PATH)
    expect(typeof warning?.description).toBe('string')
  })

  it('carries the parse message in the description', () => {
    const warning = externalReloadWarning({
      kind: 'parse-failed',
      filePath: FILE_PATH,
      message: 'Parse error on line 3: boom',
    })

    expect(warning?.description).toContain('Parse error on line 3: boom')
  })

  it('returns markup from the parse message verbatim, as a string', () => {
    const markup = '<img src=x onerror=alert(1)>'
    const warning = externalReloadWarning({ kind: 'parse-failed', filePath: FILE_PATH, message: markup })

    expect(warning?.description).toContain(markup)
  })

  it.each([
    ['apply', { kind: 'apply', body: 'x := 1;' }],
    ['unchanged', { kind: 'unchanged' }],
    ['read-failed', { kind: 'read-failed', filePath: FILE_PATH }],
  ] as const)('has nothing to warn about for %s', (_label, outcome) => {
    expect(externalReloadWarning(outcome)).toBeNull()
  })
})
