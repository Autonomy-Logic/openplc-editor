// Presentation tests: the controller runs against a fake API, with no React; snapshots and intents are asserted directly.
import type {
  CommandResult,
  VariableItem,
  VariableListApi,
  VariableListError,
  VariableListSnapshot,
} from '../../contracts/application'
import { createVariableListController } from '..'

interface FakeApi extends VariableListApi {
  readonly set: (next: Partial<VariableListSnapshot>) => void
  readonly respondWith: (error: VariableListError | null) => void
  readonly listenerCount: () => number
  readonly saveCalls: () => number
}

function createFakeApi(variables: readonly VariableItem[] = []): FakeApi {
  let snapshot: VariableListSnapshot = { variables, revision: 0, dirty: false, activity: 'idle', lastFailure: null }
  let nextResult: CommandResult = { ok: true }
  let saves = 0
  const listeners = new Set<() => void>()
  const reply = () => nextResult
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    load: () => Promise.resolve(reply()),
    save: () => {
      saves++
      return Promise.resolve(reply())
    },
    addVariable: reply,
    renameVariable: reply,
    removeVariable: reply,
    set: (next) => {
      snapshot = { ...snapshot, ...next }
      listeners.forEach((listener) => listener())
    },
    respondWith: (error) => {
      nextResult = error ? { ok: false, error } : { ok: true }
    },
    listenerCount: () => listeners.size,
    saveCalls: () => saves,
  }
}

const START: VariableItem = { id: 1, name: 'Start', type: 'BOOL' }
const SPEED: VariableItem = { id: 2, name: 'Speed', type: 'INT' }

describe('variable list controller', () => {
  it('returns the same model while nothing relevant changed', () => {
    const controller = createVariableListController(createFakeApi([START]))
    const first = controller.model.getSnapshot()
    expect(controller.model.getSnapshot()).toBe(first)
  })

  it('reuses unchanged rows when another row changes', () => {
    const api = createFakeApi([START, SPEED])
    const controller = createVariableListController(api)
    const before = controller.model.getSnapshot()
    api.set({ variables: [START, { ...SPEED, name: 'MotorSpeed' }], revision: 1, dirty: true })
    const after = controller.model.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.rows[0]).toBe(before.rows[0])
    expect(after.rows[1]).not.toBe(before.rows[1])
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const api = createFakeApi()
    const controller = createVariableListController(api)
    let notified = 0
    const unsubscribe = controller.model.subscribe(() => notified++)
    api.set({ dirty: true })
    controller.changeNewName('Mo')
    expect(notified).toBe(2)
    unsubscribe()
    controller.changeNewName('Motor')
    expect(notified).toBe(2)
  })

  it('submits a trimmed new variable and clears the form on success', () => {
    const api = createFakeApi()
    const added: string[] = []
    const controller = createVariableListController({
      ...api,
      addVariable: (command) => {
        added.push(`${command.name}:${command.type}`)
        return { ok: true }
      },
    })
    controller.changeNewName('  Motor  ')
    controller.changeNewType('REAL')
    controller.submitNew()
    expect(added).toEqual(['Motor:REAL'])
    expect(controller.model.getSnapshot().newVariable).toEqual({ name: '', type: 'REAL', error: null })
  })

  it('shows the rule violation next to the new name and clears it on edit', () => {
    const api = createFakeApi()
    const controller = createVariableListController(api)
    api.respondWith({ kind: 'invalid-name', name: '1x', reason: 'invalid-format' })
    controller.changeNewName('1x')
    controller.submitNew()
    expect(controller.model.getSnapshot().newVariable.error).toBe('"1x" is not a valid IEC 61131-3 identifier.')
    controller.changeNewName('x')
    expect(controller.model.getSnapshot().newVariable.error).toBeNull()
  })

  it('drives the rename flow on a single row', () => {
    const api = createFakeApi([START, SPEED])
    const controller = createVariableListController(api)
    controller.startRename(2)
    expect(controller.model.getSnapshot().rows[1].rename).toEqual({ draft: 'Speed', error: null })
    controller.changeRename('Speed')
    api.respondWith({ kind: 'duplicate-name', name: 'Start' })
    controller.changeRename('Start')
    controller.commitRename()
    expect(controller.model.getSnapshot().rows[1].rename?.error).toBe('A variable named "Start" already exists.')
    api.respondWith(null)
    controller.commitRename()
    expect(controller.model.getSnapshot().rows[1].rename).toBeNull()
  })

  it('ignores rename intents when no row is being renamed or the id is unknown', () => {
    const controller = createVariableListController(createFakeApi([START]))
    const before = controller.model.getSnapshot()
    controller.startRename(99)
    controller.changeRename('x')
    controller.commitRename()
    expect(controller.model.getSnapshot()).toBe(before)
    controller.startRename(1)
    controller.cancelRename()
    expect(controller.model.getSnapshot().rows[0].rename).toBeNull()
  })

  it('removes a variable and drops its pending rename', () => {
    const api = createFakeApi([START])
    const controller = createVariableListController(api)
    controller.startRename(1)
    controller.remove(1)
    api.set({ variables: [] })
    expect(controller.model.getSnapshot().rows).toEqual([])
    api.respondWith({ kind: 'unknown-variable', id: 1 })
    controller.remove(1)
    expect(controller.model.getSnapshot().status).toEqual({ tone: 'warning', text: 'That variable no longer exists.' })
  })

  it('projects activity, failures and dirty state into the status', () => {
    const api = createFakeApi()
    const controller = createVariableListController(api)
    const status = () => controller.model.getSnapshot().status
    expect(status()).toEqual({ tone: 'neutral', text: 'All changes saved' })
    api.set({ activity: 'loading' })
    expect(status().tone).toBe('busy')
    expect(controller.model.getSnapshot()).toMatchObject({ editable: false, emptyMessage: 'Loading…' })
    api.set({ activity: 'saving', dirty: true })
    expect(status()).toEqual({ tone: 'busy', text: 'Saving…' })
    expect(controller.model.getSnapshot().canSave).toBe(false)
    api.set({ activity: 'idle', lastFailure: 'save-failed' })
    expect(status()).toEqual({ tone: 'error', text: 'Saving failed. Your changes are still pending.' })
    api.set({ lastFailure: 'load-failed' })
    expect(status().text).toBe('The saved variables could not be read.')
    api.set({ lastFailure: null })
    expect(status()).toEqual({ tone: 'warning', text: 'Unsaved changes' })
    expect(controller.model.getSnapshot().canSave).toBe(true)
  })

  it('requests a save and reports a busy refusal', async () => {
    const api = createFakeApi()
    const controller = createVariableListController(api)
    api.respondWith({ kind: 'busy' })
    controller.requestSave()
    await Promise.resolve()
    await Promise.resolve()
    expect(api.saveCalls()).toBe(1)
    expect(controller.model.getSnapshot().status.text).toBe('Wait for the current operation to finish.')
  })

  it('describes a disposed api', () => {
    const api = createFakeApi()
    const controller = createVariableListController(api)
    api.respondWith({ kind: 'disposed' })
    controller.submitNew()
    expect(controller.model.getSnapshot().newVariable.error).toBe('This list is closed.')
  })

  it('releases its api subscription and ignores intents after dispose', () => {
    const api = createFakeApi()
    const controller = createVariableListController(api)
    controller.model.subscribe(() => undefined)
    expect(api.listenerCount()).toBe(1)
    controller.dispose()
    expect(api.listenerCount()).toBe(0)
    const before = controller.model.getSnapshot()
    controller.changeNewName('Late')
    expect(controller.model.getSnapshot()).toBe(before)
    let notified = 0
    controller.model.subscribe(() => notified++)
    api.set({ dirty: true })
    expect(notified).toBe(0)
  })
})
