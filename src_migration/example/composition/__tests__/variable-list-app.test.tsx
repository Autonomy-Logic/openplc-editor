// Composition tests: the real wiring end to end, plus the same root rendered with a fixture controller.
import { act, fireEvent, render, screen } from '@testing-library/react'

import { createVariableListFixture } from '../../fixtures'
import { createInMemoryPersistence } from '../../infrastructure'
import { createBrowserVariableListApp, createVariableListApp, VARIABLE_LIST_STORAGE_KEY, VariableListRoot } from '..'

async function flush() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })
}

function add(name: string, type?: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  if (type) fireEvent.change(screen.getByLabelText('Type'), { target: { value: type } })
  fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
}

function names() {
  return screen.queryAllByRole('listitem').map((item) => item.firstElementChild?.textContent)
}

describe('variable list app', () => {
  it('runs the whole feature through every layer', async () => {
    const persistence = createInMemoryPersistence({ variables: [{ id: 1, name: 'Start', type: 'BOOL' }], nextId: 2 })
    const app = createVariableListApp({ persistence })
    render(<VariableListRoot controller={app.controller} theme='light' />)
    await act(async () => {
      expect(await app.start()).toEqual({ ok: true })
    })

    expect(names()).toEqual(['Start'])
    expect(screen.getByRole('status').textContent).toBe('All changes saved')

    add('start')
    expect(screen.getByRole('alert').textContent).toBe('A variable named "start" already exists.')
    add('Speed', 'INT')
    expect(names()).toEqual(['Start', 'Speed'])
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes')

    fireEvent.click(screen.getByRole('button', { name: 'Rename Speed' }))
    fireEvent.change(screen.getByLabelText('New name for Speed'), { target: { value: 'MotorSpeed' } })
    fireEvent.keyDown(screen.getByLabelText('New name for Speed'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Start' }))
    expect(names()).toEqual(['MotorSpeed'])

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await flush()
    expect(screen.getByRole('status').textContent).toBe('All changes saved')
    expect(persistence.stored()).toEqual({ variables: [{ id: 2, name: 'MotorSpeed', type: 'INT' }], nextId: 3 })
    app.dispose()
  })

  it('renders the same view with the fixture controller', () => {
    render(<VariableListRoot controller={createVariableListFixture('populated')} />)
    expect(names()).toEqual(['StartButton', 'MotorSpeed', 'TankLevel'])
    expect(screen.getByRole('status').textContent).toBe('Simulated scenario: nothing is persisted.')
  })

  it('dispose releases every subscription created by the composition', () => {
    const app = createVariableListApp({ persistence: createInMemoryPersistence() })
    let notified = 0
    app.controller.model.subscribe(() => notified++)
    app.api.subscribe(() => notified++)
    app.dispose()
    expect(app.api.addVariable({ name: 'Late', type: 'BOOL' })).toEqual({ ok: false, error: { kind: 'disposed' } })
    expect(notified).toBe(0)
  })

  it('persists to and restores from browser storage', async () => {
    window.localStorage.removeItem(VARIABLE_LIST_STORAGE_KEY)
    const first = createBrowserVariableListApp(window.localStorage)
    await first.start()
    first.api.addVariable({ name: 'Level', type: 'REAL' })
    expect(await first.api.save()).toEqual({ ok: true })
    first.dispose()

    const second = createBrowserVariableListApp(window.localStorage)
    await second.start()
    expect(second.api.getSnapshot().variables).toEqual([{ id: 1, name: 'Level', type: 'REAL' }])
    second.dispose()

    window.localStorage.setItem(VARIABLE_LIST_STORAGE_KEY, '{broken')
    const third = createBrowserVariableListApp(window.localStorage)
    expect(await third.start()).toEqual({ ok: false, error: { kind: 'load-failed' } })
    third.dispose()
    window.localStorage.removeItem(VARIABLE_LIST_STORAGE_KEY)
  })
})
