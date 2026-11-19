import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { DebugTreeNode, PLCVariable } from '@root/middleware/shared/ports/types'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { DebugTagTable } from '..'

const variable = (name: string, location: string, documentation: string, type = 'BOOL'): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: type },
  location,
  documentation,
  debug: false,
})

const leaf = (compositeKey: string, name: string, type: string, debugIndex: number): DebugTreeNode => ({
  name,
  fullPath: compositeKey.replace(':', '.'),
  compositeKey,
  type,
  isComplex: false,
  debugIndex,
})

function renderTable() {
  const store = createTestStore()

  store.getState().projectActions.setProject({
    meta: { name: 'tank', type: 'plc-project', path: '/tank' },
    data: {
      dataTypes: [],
      pous: [
        {
          name: 'main',
          pouType: 'program',
          interface: { variables: [variable('motor', '%QX0.0', 'Main motor')] },
          body: { language: 'st', value: '' },
          documentation: '',
        },
        {
          name: 'aux',
          pouType: 'program',
          interface: { variables: [variable('setpoint', '%IW10', 'Tank setpoint', 'INT')] },
          body: { language: 'st', value: '' },
          documentation: '',
        },
      ],
      globalVariableLists: [],
      servers: [],
      remoteDevices: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
  })

  store.getState().fileActions.setFiles({
    files: { Resource: { type: 'resource', filePath: 'Resource', saved: true } },
  })

  const { workspaceActions } = store.getState()
  workspaceActions.setDebugVariableTree(
    new Map([
      ['main:motor', leaf('main:motor', 'motor', 'BOOL', 1)],
      ['aux:setpoint', leaf('aux:setpoint', 'setpoint', 'INT', 2)],
    ]),
  )
  workspaceActions.setDebugVariableIndexes(
    new Map([
      ['main.motor', 1],
      ['aux.setpoint', 2],
    ]),
  )

  const forced: string[][] = []
  const onForceVariable = (
    compositeKey: string,
    variableType: string,
    value?: boolean,
    _valueBuffer?: Uint8Array,
    lookupKey?: string,
  ) => {
    forced.push([compositeKey, variableType, String(value), lookupKey ?? ''])
    return Promise.resolve()
  }

  const view = render(<DebugTagTable onForceVariable={onForceVariable} />, { wrapper: createStoreWrapper(store) })

  return { store, forced, unmount: view.unmount }
}

const rowOf = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('tr')
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${name}`)
  return row
}

describe('DebugTagTable', () => {
  it('lists every variable of the project with its address, type and comment, without the user adding any', () => {
    renderTable()

    expect(screen.getByText('2 of 2 tags')).toBeTruthy()
    expect(within(rowOf('motor')).getByText('%QX0.0')).toBeTruthy()
    expect(within(rowOf('motor')).getByText('Main motor')).toBeTruthy()
    expect(within(rowOf('setpoint')).getByText('%IW10')).toBeTruthy()
    expect(within(rowOf('setpoint')).getByText('INT')).toBeTruthy()
  })

  it('publishes the tags it shows so the debugger polls them', () => {
    const { store } = renderTable()

    expect([...store.getState().workspace.debugTagTableKeys].sort()).toEqual(['aux:setpoint', 'main:motor'])
  })

  it('stops the reads it asked for when it closes', () => {
    const { store, unmount } = renderTable()

    act(() => unmount())

    expect(store.getState().workspace.debugTagTableKeys).toEqual([])
  })

  it('filters the table and polls only what is left', () => {
    const { store } = renderTable()

    fireEvent.change(screen.getByLabelText('Filter tags'), { target: { value: 'motor' } })

    expect(screen.getByText('1 of 2 tags')).toBeTruthy()
    expect(screen.queryByText('setpoint')).toBeNull()
    expect(store.getState().workspace.debugTagTableKeys).toEqual(['main:motor'])
  })

  it('moves a tag to a view and keeps the view in the project', () => {
    const { store } = renderTable()

    fireEvent.click(screen.getByText('New view'))
    fireEvent.change(screen.getByLabelText('Monitor view'), { target: { value: '' } })
    fireEvent.change(within(rowOf('motor')).getByLabelText('Area of motor'), { target: { value: 'View 1' } })

    expect(store.getState().project.data.monitorViews).toEqual([{ name: 'View 1', entries: ['main:motor'] }])
  })

  it('shows only the tags of the selected view', () => {
    const { store } = renderTable()

    act(() => {
      store.getState().projectActions.setMonitorViews([{ name: 'Motors', entries: ['main:motor'] }])
    })
    fireEvent.change(screen.getByLabelText('Monitor view'), { target: { value: 'Motors' } })

    expect(screen.getByText('1 of 2 tags')).toBeTruthy()
    expect(screen.queryByText('setpoint')).toBeNull()
  })

  it('falls back to every tag when the selected view is deleted', () => {
    const { store } = renderTable()

    act(() => {
      store.getState().projectActions.setMonitorViews([{ name: 'Motors', entries: ['main:motor'] }])
    })
    fireEvent.change(screen.getByLabelText('Monitor view'), { target: { value: 'Motors' } })
    fireEvent.click(screen.getByText('Delete view'))

    expect(store.getState().project.data.monitorViews).toEqual([])
    expect(screen.getByText('2 of 2 tags')).toBeTruthy()
  })

  it('marks the project unsaved when a view changes, because the views live in project.json', () => {
    const { store } = renderTable()

    fireEvent.click(screen.getByText('New view'))

    expect(store.getState().fileActions.getFile({ name: 'Resource' }).file?.saved).toBe(false)
    expect(store.getState().workspace.editingState).toBe('unsaved')
  })

  it('names the next view past the ones that exist, after one was deleted', () => {
    const { store } = renderTable()

    act(() => {
      store.getState().projectActions.setMonitorViews([{ name: 'View 2', entries: [] }])
    })
    fireEvent.click(screen.getByText('New view'))

    expect(store.getState().project.data.monitorViews?.map((view) => view.name)).toEqual(['View 2', 'View 3'])
    expect(screen.queryByText('Cannot create the view')).toBeNull()
  })

  it('drops the entries of variables the project no longer declares', () => {
    const { store } = renderTable()

    act(() => {
      store.getState().projectActions.setMonitorViews([{ name: 'Motors', entries: ['main:motor', 'main:gone'] }])
    })

    expect(store.getState().project.data.monitorViews).toEqual([{ name: 'Motors', entries: ['main:motor'] }])
  })

  it('keeps the members of a structured tag visible inside a view', () => {
    const { store } = renderTable()

    act(() => {
      store.getState().workspaceActions.setDebugVariableTree(
        new Map([
          [
            'main:t1',
            {
              name: 't1',
              fullPath: 'main.t1',
              compositeKey: 'main:t1',
              type: 'TON',
              isComplex: true,
              children: [
                {
                  name: 'Q',
                  fullPath: 'main.t1.Q',
                  compositeKey: 'main:t1.Q',
                  type: 'BOOL',
                  isComplex: false,
                  debugIndex: 4,
                },
              ],
            },
          ],
        ]),
      )
      store.getState().projectActions.setMonitorViews([{ name: 'Timers', entries: ['main:t1'] }])
    })
    fireEvent.change(screen.getByLabelText('Monitor view'), { target: { value: 'Timers' } })
    fireEvent.click(screen.getByLabelText('Expand t1'))

    expect(screen.getByText('Q')).toBeTruthy()
  })

  it('forces a BOOL tag from its row, by the key the debug map knows', () => {
    const { forced } = renderTable()

    fireEvent.click(within(rowOf('motor')).getByLabelText('Force motor true'))

    expect(forced).toEqual([['main:motor', 'BOOL', 'true', 'main.motor']])
  })

  it('forces a typed value when the row input is confirmed', () => {
    const { forced } = renderTable()

    const input = within(rowOf('setpoint')).getByLabelText('Force value for setpoint')
    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(forced).toEqual([['aux:setpoint', 'INT', 'true', 'aux.setpoint']])
  })
})
