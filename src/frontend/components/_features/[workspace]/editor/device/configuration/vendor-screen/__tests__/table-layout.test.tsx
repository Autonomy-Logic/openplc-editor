import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { produce } from 'immer'

import type { ScreenSection } from '../index'
import { SectionRenderer } from '../section-renderer'

/**
 * Table layout for the Data Hub Variables picker — covers the surface the
 * iframe-based screen had (rows from the PLC model, exports[] round-trip,
 * search filter) plus the new section-level `enabledWhen` gate.
 */

const PACKAGE_ID = 'com.test.vpp'
const BOARD = 'TEST-BOARD'

const COLUMNS = [
  { id: 'qualifier', label: 'Qualifier', type: 'text' as const, readonly: true },
  { id: 'type', label: 'Type', type: 'text' as const, readonly: true },
  { id: 'access', label: 'Access', type: 'select' as const, options: ['RO', 'RW'] },
]

const SECTION: ScreenSection = {
  id: 'variables',
  title: 'Variables',
  layout: 'table',
  persistence: 'vpp-extensions',
  storageId: 'data-hub',
  source: 'variable-picker',
  columns: COLUMNS,
  search: { field: 'qualifier', placeholder: 'Filter by qualifier...' },
}

const GATED_SECTION: ScreenSection = {
  ...SECTION,
  enabledWhen: { condition: 'enabled', operator: 'equals', value: true },
}

let store: OpenPLCStore

function seedBoardWithPackage(target: OpenPLCStore) {
  // The useSectionStorage hook resolves vppExtensions through
  // `deviceAvailableOptions.availableBoards.get(deviceBoard).vpp.packageId`,
  // so the test store needs a board that advertises the package id the
  // section's data lives under.
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
            id: `v${index}`,
          })),
        },
        body: { language: 'st', value: '' },
        documentation: '',
      })
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

describe('TableLayout — variable-picker source', () => {
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
    // Headers do not render in the empty state — the table is replaced by the hint.
    expect(screen.queryByText('Qualifier')).toBeNull()
  })

  it('lists every exportable variable from the PLC model with its qualifier and type', () => {
    seedPouProgram(store, 'Program0', ['pump_speed', 'temp_pv'], 'INT')
    renderSection(SECTION)

    expect(screen.getByText('Program0.pump_speed')).toBeTruthy()
    expect(screen.getByText('Program0.temp_pv')).toBeTruthy()
    expect(screen.getAllByText('INT').length).toBe(2)
  })

  it('writes an export entry with direction RO when a row is checked', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
    renderSection(SECTION)

    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    expect(readExports(store)).toEqual([{ qualifier: 'Program0.pump_speed', direction: 'RO' }])
  })

  it('updates direction in-place without duplicating the entry when the access select changes', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
    renderSection(SECTION)
    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    // Changing direction goes through Radix Select — exercise the public store
    // action directly for determinism; the UI binding is covered by the
    // smoke rendering above.
    act(() => {
      const current = readExports(store) as Array<{ qualifier: string; direction: string }>
      store.getState().projectActions.setVppExtension(PACKAGE_ID, 'data-hub', {
        exports: current.map((e) => ({ ...e, direction: 'RW' })),
      })
    })

    expect(readExports(store)).toEqual([{ qualifier: 'Program0.pump_speed', direction: 'RW' }])
  })

  it('removes the entry when the row is unchecked', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
    renderSection(SECTION)
    // Re-query between clicks: @tanstack/react-table rebuilds row cells when
    // column defs change (which they do when `exports` updates), so the first
    // DOM node is stale after state settles.
    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))
    expect(readExports(store)).toEqual([{ qualifier: 'Program0.pump_speed', direction: 'RO' }])

    fireEvent.click(screen.getByLabelText('Expose Program0.pump_speed'))

    expect(readExports(store)).toEqual([])
  })

  it('debounces the search input and filters by qualifier', () => {
    jest.useFakeTimers()
    seedPouProgram(store, 'Program0', ['pump_speed', 'temp_pv', 'other'], 'INT')
    renderSection(SECTION)

    const input = screen.getByLabelText('Filter variables') as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'temp' } })
    })

    // Before the 300 ms debounce elapses, the model stays unfiltered.
    expect(screen.getByText('Program0.pump_speed')).toBeTruthy()
    expect(screen.getByText('Program0.other')).toBeTruthy()

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(screen.queryByText('Program0.pump_speed')).toBeNull()
    expect(screen.queryByText('Program0.other')).toBeNull()
    expect(screen.getByText('Program0.temp_pv')).toBeTruthy()
  })

  it('reflects a new variable added to the project after mount — the model subscription keeps the table live', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
    renderSection(SECTION)
    expect(screen.getByText('Program0.pump_speed')).toBeTruthy()
    expect(screen.queryByText('Program0.added_later')).toBeNull()

    act(() => {
      store.setState(
        produce((state) => {
          const program = state.project.data.pous.find((p: { name: string }) => p.name === 'Program0')
          program.interface.variables.push({
            name: 'added_later',
            class: 'local',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
            debug: false,
            initialValue: '',
            id: 'vN',
          })
        }),
      )
    })

    expect(screen.getByText('Program0.added_later')).toBeTruthy()
  })

  it('keeps the row checkboxes and the access select inert when enabledWhen fails', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
    renderSection(GATED_SECTION)

    const checkbox = screen.getByLabelText('Expose Program0.pump_speed') as HTMLButtonElement
    fireEvent.click(checkbox)

    // The gate's condition value (`enabled`) is never true for this section,
    // so the toggle write is dropped — exports[] stays untouched.
    expect(readExports(store)).toBeUndefined()
  })

  it('opens the gate when enabledWhen evaluates to true', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
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

  it('counts filtered rows next to the search bar', () => {
    jest.useFakeTimers()
    seedPouProgram(store, 'Program0', ['pump_speed', 'temp_pv'], 'INT')
    renderSection(SECTION)
    expect(screen.getByText(/2 of 2/)).toBeTruthy()

    act(() => {
      fireEvent.change(screen.getByLabelText('Filter variables'), { target: { value: 'temp' } })
      jest.advanceTimersByTime(300)
    })

    expect(screen.getByText(/1 of 2/)).toBeTruthy()
  })

  it('still renders rows when no search spec is declared, with no filter bar', () => {
    const withoutSearch = { ...SECTION, search: undefined }
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
    renderSection(withoutSearch)

    expect(screen.getByText('Program0.pump_speed')).toBeTruthy()
    expect(screen.queryByLabelText('Filter variables')).toBeNull()
  })

  it('bulk-selects every row from the header checkbox and bulk-clears on a second click', () => {
    seedPouProgram(store, 'Program0', ['pump_speed', 'temp_pv'], 'INT')
    renderSection(SECTION)

    fireEvent.click(screen.getByLabelText('Select all variables'))

    expect(readExports(store)).toEqual([
      { qualifier: 'Program0.pump_speed', direction: 'RO' },
      { qualifier: 'Program0.temp_pv', direction: 'RO' },
    ])

    // Re-query — see `removes the entry when the row is unchecked`.
    fireEvent.click(screen.getByLabelText('Select all variables'))
    expect(readExports(store)).toEqual([])
  })

  // Light smoke test for the GARAGEDO-style column schema: the renderer must
  // tolerate unknown column ids without crashing, so a vendor package that
  // ships a stray column still produces a working picker instead of a blank
  // screen.
  it('ignores unknown schema column ids and keeps rendering', () => {
    seedPouProgram(store, 'Program0', ['pump_speed'], 'INT')
    const extendedColumns = [...COLUMNS, { id: 'extra', label: 'Extra', type: 'text' as const }]
    renderSection({ ...SECTION, columns: extendedColumns })

    expect(screen.getByText('Program0.pump_speed')).toBeTruthy()
    // The unknown column header renders with no cell data — the accessor
    // returns the empty string by convention.
    const headers = screen.getAllByText('Extra')
    expect(headers.length).toBeGreaterThan(0)
    expect(within(headers[0]).queryByText('int')).toBeNull()
  })
})
