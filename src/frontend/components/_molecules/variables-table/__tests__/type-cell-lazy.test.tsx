import { fireEvent, render, screen } from '@testing-library/react'

import type { SystemLibrary, SystemLibraryPou } from '../../../../../middleware/shared/ports/library-types'
import type { PLCPou, PLCVariable } from '../../../../../middleware/shared/ports/types'
import { type OpenPLCStore, useOpenPLCStore } from '../../../../store'
import { CreateEditorModelObject } from '../../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { VariablesTable } from '../index'

const POU = 'main'
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

const variable = (index: number): PLCVariable => ({
  name: `v${index}`,
  class: 'local',
  type: { definition: 'base-type', value: 'INT' },
  location: '',
  documentation: '',
  debug: false,
})

const program = (): PLCPou => ({
  name: POU,
  pouType: 'program',
  interface: { variables: Array.from({ length: ROWS }, (_, index) => variable(index)) },
  body: { language: 'st', value: '' },
})

const seed = () => {
  store.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      dataTypes: [],
      globalVariableLists: [],
      pous: [program()],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  })
  store.getState().editorActions.setEditor(CreateEditorModelObject(POU, 'st', 'program'))
  store.setState({ libraries: { ...store.getState().libraries, system: [countingLibrary()] } })
  libraryReads = 0
}

const NO_VARIABLES: PLCVariable[] = []

/** The POU table fed from the store, so a type change re-renders its rows as in the editor. */
const TableFromStore = () => {
  const rows = useOpenPLCStore(
    (state) => state.project.data.pous.find((pou) => pou.name === POU)?.interface?.variables ?? NO_VARIABLES,
  )
  return <VariablesTable tableData={rows} selectedRow={0} handleRowClick={() => undefined} />
}

const renderTable = () => render(<TableFromStore />, { wrapper: createStoreWrapper(store) })

/** Column 4 is Type in a program's table (`#`, Name, Class, Flags, Type). */
const openTypeMenu = (rowIndex: number) => {
  const rows = screen.getAllByRole('row').filter((row) => row.querySelectorAll('td').length > 0)
  const trigger = rows[rowIndex].querySelectorAll('td')[4].querySelector('[aria-haspopup="menu"]')
  if (!(trigger instanceof HTMLElement)) throw new Error('type cell has no menu trigger')
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

const openSubmenu = (label: string) => {
  const subTrigger = screen.getAllByText(label).at(-1)?.closest('[role="menuitem"]')
  if (!(subTrigger instanceof HTMLElement)) throw new Error(`no submenu named ${label}`)
  fireEvent.keyDown(subTrigger, { key: 'ArrowRight' })
}

const variableType = (name: string) =>
  store
    .getState()
    .project.data.pous.find((pou) => pou.name === POU)
    ?.interface?.variables.find((candidate) => candidate.name === name)?.type

beforeEach(() => {
  store = createTestStore()
  seed()
})

describe('POU variables table: closed type cells', () => {
  it('builds no library list while every type picker is closed', () => {
    renderTable()
    expect({ rows: screen.getAllByText(/^v\d+$/).length, libraryReads }).toEqual({ rows: ROWS, libraryReads: 0 })
  })
})

describe('POU variables table: the open type picker', () => {
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

  it('lists the base, user data, array and library groups', () => {
    renderTable()
    openTypeMenu(0)
    expect(
      screen
        .getAllByRole('menuitem')
        .map((item) => item.firstElementChild?.firstChild?.textContent ?? item.textContent),
    ).toEqual(['Base Type', 'User Data Type', 'Array', 'System', 'User'])
  })

  it('changes the variable type when a base type is chosen', () => {
    renderTable()
    openTypeMenu(0)
    openSubmenu('Base Type')
    fireEvent.click(screen.getByRole('menuitem', { name: 'REAL' }))
    expect(variableType('v0')).toEqual({ definition: 'base-type', value: 'REAL' })
  })

  it('opens the array dialog from the Array item', () => {
    renderTable()
    openTypeMenu(0)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Array' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
