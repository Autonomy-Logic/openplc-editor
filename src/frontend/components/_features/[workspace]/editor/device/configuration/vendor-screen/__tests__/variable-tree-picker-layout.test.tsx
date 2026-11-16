import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { produce } from 'immer'

import type { ScreenSection } from '../index'
import { SectionRenderer } from '../section-renderer'

/**
 * Hierarchical variable-tree-picker layout — covers program/GVL grouping,
 * tri-state group selection, the inline Access dropdown on the selected list,
 * filter behaviour and the `enabledWhen` gate. Storage round-trip stays flat
 * (`{ qualifier, direction }[]`) so the emitter wire does not change.
 */

const PACKAGE_ID = 'com.test.vpp'
const BOARD = 'TEST-BOARD'

const SECTION: ScreenSection = {
  id: 'variables',
  title: 'Variables',
  layout: 'variable-tree-picker',
  persistence: 'vpp-extensions',
  storageId: 'data-hub',
  search: { field: 'qualifier', placeholder: 'Filter by qualifier...' },
}

const GATED_SECTION: ScreenSection = {
  ...SECTION,
  enabledWhen: { condition: 'enabled', operator: 'equals', value: true },
}

let store: OpenPLCStore

function seedBoardWithPackage(target: OpenPLCStore) {
  target.setState(
    produce((state) => {
      state.deviceDefinitions.configuration.deviceBoard = BOARD
      state.deviceAvailableOptions.availableBoards.set(BOARD, {
        compiler: 'runtime_v4',
        core: 'openplc',
        preview: 'generic.png',
        specs: {},
        vpp: {
          packageId: PACKAGE_ID,
          vendor: 'Test',
          deviceId: 'test',
          packagePath: '/packages/com.test.vpp',
          screens: {},
          moduleSystem: null,
        },
      })
    }),
  )
}

function seedPouProgram(target: OpenPLCStore, name: string, variableNames: string[], type = 'INT') {
  target.setState(
    produce((state) => {
      state.project.data.pous.push({
        name,
        pouType: 'program',
        interface: {
          variables: variableNames.map((varName, index) => ({
            name: varName,
            class: 'local',
            type: { definition: 'base-type', value: type },
            location: '',
            documentation: '',
            debug: false,
            initialValue: '',
            id: `${name}-v${index}`,
          })),
        },
        body: { language: 'st', value: '' },
        documentation: '',
      })
    }),
  )
}

function seedGlobalVariables(target: OpenPLCStore, names: string[], type = 'INT') {
  target.setState(
    produce((state) => {
      state.project.data.configurations.resource.globalVariables.push(
        ...names.map((varName, index) => ({
          name: varName,
          class: 'global',
          type: { definition: 'base-type', value: type },
          location: '',
          documentation: '',
          debug: false,
          initialValue: '',
          id: `gvl-v${index}`,
        })),
      )
    }),
  )
}

function renderSection(section: ScreenSection) {
  return render(<SectionRenderer section={section} moduleSystem={null} />, {
    wrapper: createStoreWrapper(store),
  })
}

function readExports(target: OpenPLCStore): unknown {
  const payload = target.getState().projectActions.getVppExtension(PACKAGE_ID, 'data-hub') as
    | { exports?: unknown }
    | undefined
  return payload?.exports
}

describe('VariableTreePickerLayout', () => {
  beforeEach(() => {
    store = createTestStore()
    seedBoardWithPackage(store)
  })

  afterEach(() => {
    cleanup()
    jest.useRealTimers()
  })

  it('renders the empty-state hint when the project has no exportable variables', () => {
    renderSection(SECTION)

    expect(screen.getByText(/no exportable variables in this project yet/i)).toBeTruthy()
    expect(screen.getByText(/select variables from the tree to expose/i)).toBeTruthy()
  })

  it('groups variables by program and GVL, listing programs first alphabetically', () => {
    seedPouProgram(store, 'Program1', ['x'])
    seedPouProgram(store, 'Program0', ['pump_speed', 'temp_pv'])
    seedGlobalVariables(store, ['setpoint'])

    renderSection(SECTION)

    // Groups: Program0, Program1 (both expanded by default), then GVL.
    const groupHeaders = screen.getAllByText(/^(Program0|Program1|GVL)$/)
    expect(groupHeaders.map((n) => n.textContent)).toEqual(['Program0', 'Program1', 'GVL'])

    expect(screen.getByText('Program0.pump_speed')).toBeTruthy()
    expect(screen.getByText('Program0.temp_pv')).toBeTruthy()
    expect(screen.getByText('Program1.x')).toBeTruthy()
    expect(screen.getByText('GVL.setpoint')).toBeTruthy()
  })

  it('writes an export entry with direction RO when a leaf is checked', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'])
    renderSection(SECTION)

    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    expect(readExports(store)).toEqual([{ qualifier: 'Program0.pump_speed', direction: 'RO' }])
  })

  it('removes the entry when the leaf is unchecked again', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'])
    renderSection(SECTION)
    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    expect(readExports(store)).toEqual([])
  })

  it('selects every variable in a group when the group checkbox goes to true', () => {
    seedPouProgram(store, 'Program0', ['a', 'b'])
    seedPouProgram(store, 'Program1', ['c'])
    renderSection(SECTION)

    fireEvent.click(screen.getByLabelText('Select all variables in Program0'))

    expect(readExports(store)).toEqual([
      { qualifier: 'Program0.a', direction: 'RO' },
      { qualifier: 'Program0.b', direction: 'RO' },
    ])
  })

  it('clears only the group when the group checkbox goes to false', () => {
    seedPouProgram(store, 'Program0', ['a', 'b'])
    seedPouProgram(store, 'Program1', ['c'])
    renderSection(SECTION)
    fireEvent.click(screen.getByLabelText('Select all variables in Program0'))
    fireEvent.click(screen.getByLabelText('Expose Program1.c'))

    fireEvent.click(screen.getByLabelText('Select all variables in Program0'))

    // Only Program1.c survives; Program0 entries are gone.
    expect(readExports(store)).toEqual([{ qualifier: 'Program1.c', direction: 'RO' }])
  })

  it('reports the selected / total count next to each group header', () => {
    seedPouProgram(store, 'Program0', ['a', 'b', 'c'])
    renderSection(SECTION)
    expect(screen.getByText(/Program · 0\/3/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Expose Program0.a'))
    expect(screen.getByText(/Program · 1\/3/)).toBeTruthy()
  })

  it('reflects the current selection in the right-hand list with the qualifier and its direction', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'])
    renderSection(SECTION)
    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    expect(screen.getByText(/Selected for Data Hub \(1\)/)).toBeTruthy()
    // The qualifier appears both in the tree row (checked) and in the selected list.
    expect(screen.getAllByText('Program0.pump_speed').length).toBeGreaterThanOrEqual(1)
    // The Access trigger is labelled with the qualifier so it stays unique per row.
    expect(screen.getByLabelText('Access for Program0.pump_speed')).toBeTruthy()
  })

  it('removes an entry when its row X is clicked in the selected list', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'])
    renderSection(SECTION)
    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    fireEvent.click(screen.getByLabelText('Remove Program0.pump_speed'))

    expect(readExports(store)).toEqual([])
  })

  it('debounces the search box and hides groups whose variables do not match', () => {
    jest.useFakeTimers()
    seedPouProgram(store, 'Program0', ['pump_speed', 'temp_pv'])
    seedPouProgram(store, 'Program1', ['x'])
    renderSection(SECTION)

    const input = screen.getByLabelText('Filter variables') as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'pump' } })
    })

    // Before the 300 ms debounce elapses, every group stays visible.
    expect(screen.getByText('Program1.x')).toBeTruthy()

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(screen.getByText('Program0.pump_speed')).toBeTruthy()
    expect(screen.queryByText('Program0.temp_pv')).toBeNull()
    expect(screen.queryByText('Program1.x')).toBeNull()
    // Program1 header is suppressed when none of its leaves match.
    expect(screen.queryByText(/^Program1$/)).toBeNull()
  })

  it('shows a dedicated no-match hint when the filter excludes every variable', () => {
    jest.useFakeTimers()
    seedPouProgram(store, 'Program0', ['pump_speed'])
    renderSection(SECTION)
    const input = screen.getByLabelText('Filter variables') as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'zzz' } })
      jest.advanceTimersByTime(300)
    })

    expect(screen.getByText(/no variables match the filter/i)).toBeTruthy()
  })

  it('keeps the tree inert when enabledWhen fails — toggling writes nothing', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'])
    renderSection(GATED_SECTION)

    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    expect(readExports(store)).toBeUndefined()
  })

  it('opens the gate when enabledWhen evaluates to true', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'])
    act(() => {
      store.getState().projectActions.setVppExtension(PACKAGE_ID, 'data-hub', { enabled: true })
    })
    renderSection(GATED_SECTION)

    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    const stored = store.getState().projectActions.getVppExtension(PACKAGE_ID, 'data-hub') as {
      enabled: boolean
      exports?: Array<{ qualifier: string; direction: string }>
    }
    expect(stored.enabled).toBe(true)
    expect(stored.exports).toEqual([{ qualifier: 'Program0.pump_speed', direction: 'RO' }])
  })

  it('persists the exact flat shape the Data Hub emitter consumes', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'])
    seedGlobalVariables(store, ['setpoint'])
    renderSection(SECTION)

    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))
    fireEvent.click(screen.getByLabelText('Expose GVL.setpoint'))

    expect(readExports(store)).toEqual([
      { qualifier: 'Program0.pump_speed', direction: 'RO' },
      { qualifier: 'GVL.setpoint', direction: 'RO' },
    ])
  })
})
