import { fireEvent, render, screen } from '@testing-library/react'

import type { SystemLibrary, SystemLibraryPou } from '../../../../../middleware/shared/ports/library-types'
import type { PLCGlobalVariable } from '../../../../../middleware/shared/ports/types'
import { type OpenPLCStore, useOpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { GlobalVariablesTable } from '../index'

const ROWS = 50

let store: OpenPLCStore
let libraryReads = 0

const functionBlock = (name: string): SystemLibraryPou => ({
  name,
  type: 'function-block',
  language: 'st',
  variables: [],
  body: '',
  documentation: '',
})

/** A system library that counts every read of its POU list. */
const countingLibrary = (): SystemLibrary => {
  const pous = [functionBlock('ALPHAFB'), functionBlock('BETAFB')]
  const library = { name: 'counting', author: '', version: '1', stPath: '', cPath: '' } as SystemLibrary
  Object.defineProperty(library, 'pous', {
    enumerable: true,
    get: () => {
      libraryReads += 1
      return pous
    },
  })
  return library
}

const globalVariable = (index: number): PLCGlobalVariable => ({
  name: `g${index}`,
  class: 'global',
  type: { definition: 'base-type', value: 'INT' },
  location: '',
  initialValue: '',
  documentation: '',
  debug: false,
})

const seed = () => {
  store.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      dataTypes: [],
      globalVariableLists: [],
      pous: [],
      configurations: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: Array.from({ length: ROWS }, (_, index) => globalVariable(index)),
        },
      },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  })
  store.setState({ libraries: { ...store.getState().libraries, system: [countingLibrary()] } })
  libraryReads = 0
}

/** The Resource table fed from the store, so a type change re-renders its rows as in the editor. */
const ResourceTableFromStore = () => {
  const rows = useOpenPLCStore((state) => state.project.data.configurations.resource.globalVariables)
  return (
    <GlobalVariablesTable
      tableData={rows.map((row) => ({ ...row, class: 'global' }))}
      selectedRow={0}
      handleRowClick={() => undefined}
    />
  )
}

const renderTable = () => render(<ResourceTableFromStore />, { wrapper: createStoreWrapper(store) })

/** Columns 0..3 are `#`, Name, Class and Type. */
const openTypeMenu = (rowIndex: number) => {
  const rows = screen.getAllByRole('row').filter((row) => row.querySelectorAll('td').length > 0)
  const trigger = rows[rowIndex].querySelectorAll('td')[3].querySelector('[aria-haspopup="menu"]')
  if (!(trigger instanceof HTMLElement)) throw new Error('type cell has no menu trigger')
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

const openSubmenu = (label: string) => {
  const subTrigger = screen.getAllByText(label).at(-1)?.closest('[role="menuitem"]')
  if (!(subTrigger instanceof HTMLElement)) throw new Error(`no submenu named ${label}`)
  fireEvent.keyDown(subTrigger, { key: 'ArrowRight' })
}

const globalType = (name: string) =>
  store.getState().project.data.configurations.resource.globalVariables.find((variable) => variable.name === name)?.type

beforeEach(() => {
  store = createTestStore()
  seed()
})

describe('Resource globals table: closed type cells', () => {
  it('builds no library list while every type picker is closed', () => {
    renderTable()
    expect({ rows: screen.getAllByText(/^g\d+$/).length, libraryReads }).toEqual({ rows: ROWS, libraryReads: 0 })
  })
})

describe('Resource globals table: the open type picker', () => {
  it('lists system library function blocks and filters them by the search', () => {
    renderTable()
    openTypeMenu(0)
    openSubmenu('System')
    const listed = screen.getAllByRole('menuitem').map((item) => item.textContent)
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'BETA' } })
    const filtered = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect({
      listedBoth: listed.includes('ALPHAFB') && listed.includes('BETAFB'),
      filteredAlpha: filtered.includes('ALPHAFB'),
      filteredBeta: filtered.includes('BETAFB'),
    }).toEqual({ listedBoth: true, filteredAlpha: false, filteredBeta: true })
  })

  it('changes the global variable type when a base type is chosen', () => {
    renderTable()
    openTypeMenu(0)
    openSubmenu('Base Type')
    fireEvent.click(screen.getByRole('menuitem', { name: 'REAL' }))
    expect(globalType('g0')).toEqual({ definition: 'base-type', value: 'REAL' })
  })

  it('opens the array dialog from the Array item', () => {
    renderTable()
    openTypeMenu(0)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Array' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
