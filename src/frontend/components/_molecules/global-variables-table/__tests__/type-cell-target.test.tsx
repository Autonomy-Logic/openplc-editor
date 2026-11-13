import { fireEvent, render, screen, within } from '@testing-library/react'

import type {
  PLCGlobalVariable,
  PLCGlobalVariableList,
  PLCPou,
  PLCVariable,
  PLCVariableType,
} from '@root/middleware/shared/ports/types'
import { type OpenPLCStore, useOpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'

import { GlobalVariableListTable, GlobalVariablesTable } from '../index'

const INT: PLCVariableType = { definition: 'base-type', value: 'INT' }

const arrayOf = (dimension: string, baseType: string): PLCVariableType => ({
  definition: 'array',
  value: `ARRAY [${dimension}] OF ${baseType}`,
  data: { baseType: { definition: 'base-type', value: baseType }, dimensions: [{ dimension }] },
})

const globalVariable = (name: string, type: PLCVariableType = INT): PLCGlobalVariable => ({
  name,
  class: 'global',
  type,
  location: '',
  initialValue: '',
  documentation: '',
  debug: false,
})

const listMember = (name: string, type: PLCVariableType = INT): PLCVariable => ({
  name,
  class: 'global',
  type,
  location: '',
  initialValue: '',
  documentation: '',
})

const programWithExternal = (externalName: string): PLCPou => ({
  name: 'main',
  pouType: 'program',
  interface: {
    variables: [{ name: externalName, class: 'external', type: INT, location: '', documentation: '' }],
  },
  body: { language: 'st', value: '' },
})

let store: OpenPLCStore

const seedProject = ({
  resourceGlobals = [],
  lists = [],
  pous = [],
}: {
  resourceGlobals?: PLCGlobalVariable[]
  lists?: PLCGlobalVariableList[]
  pous?: PLCPou[]
}) => {
  store.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      dataTypes: [],
      globalVariableLists: lists,
      pous,
      configurations: { resource: { tasks: [], instances: [], globalVariables: resourceGlobals } },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  })
}

const NO_VARIABLES: PLCVariable[] = []

const asTableRows = (variables: PLCVariable[]): PLCGlobalVariable[] =>
  variables.map((variable) => ({ ...variable, class: 'global' }))

/** The list table fed from the store, so a write re-renders its rows as in the editor. */
const ListTableFromStore = ({ listName }: { listName: string }) => {
  const list = useOpenPLCStore((state) =>
    (state.project.data.globalVariableLists ?? []).find((candidate) => candidate.name === listName),
  )
  return (
    <GlobalVariableListTable
      listName={listName}
      tableData={asTableRows(list?.variables ?? NO_VARIABLES)}
      selectedRow={-1}
      handleRowClick={() => undefined}
    />
  )
}

/** The Resource table fed from the store. */
const ResourceTableFromStore = () => {
  const rows = useOpenPLCStore((state) => state.project.data.configurations.resource.globalVariables)
  return <GlobalVariablesTable tableData={asTableRows(rows)} selectedRow={-1} handleRowClick={() => undefined} />
}

const renderListTable = (listName = 'GVL') =>
  render(<ListTableFromStore listName={listName} />, { wrapper: createStoreWrapper(store) })

const renderResourceTable = () => render(<ResourceTableFromStore />, { wrapper: createStoreWrapper(store) })

const dataRow = (rowIndex: number): HTMLElement => {
  const rows = screen.getAllByRole('row').filter((row) => row.querySelectorAll('td').length > 0)
  return rows[rowIndex]
}

/** Columns 0..3 are `#`, Name, Class and Type in both tables. */
const openTypeMenu = (rowIndex: number) => {
  const typeCell = dataRow(rowIndex).querySelectorAll('td')[3]
  const trigger = typeCell.querySelector('[aria-haspopup="menu"]')
  if (!(trigger instanceof HTMLElement)) throw new Error('type cell has no menu trigger')
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

const openSubmenu = (label: string) => {
  const subTrigger = screen.getAllByText(label).at(-1)?.closest('[role="menuitem"]')
  if (!(subTrigger instanceof HTMLElement)) throw new Error(`no submenu named ${label}`)
  fireEvent.keyDown(subTrigger, { key: 'ArrowRight' })
}

const pickBaseTypeFromCell = (rowIndex: number, baseType: string) => {
  openTypeMenu(rowIndex)
  openSubmenu('Base Type')
  fireEvent.click(screen.getByRole('menuitem', { name: baseType }))
}

/** Picks Array on the row's type cell, fills the dialog and presses Save. */
const setArrayFromCell = (rowIndex: number, dimension: string, baseType: string) => {
  openTypeMenu(rowIndex)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Array' }))

  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByLabelText('Add table row button'))
  const input = within(dialog).getAllByLabelText('Array dimension input').at(-1)?.querySelector('input')
  if (!input) throw new Error('no dimension input')
  fireEvent.change(input, { target: { value: dimension } })
  fireEvent.blur(input)

  const baseTypeTrigger = dialog.querySelector('[aria-haspopup="menu"]')
  if (!(baseTypeTrigger instanceof HTMLElement)) throw new Error('no base type selector')
  fireEvent.keyDown(baseTypeTrigger, { key: 'Enter' })
  openSubmenu('Base Type')
  fireEvent.click(screen.getByRole('menuitem', { name: baseType }))

  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
}

const dialogDimensions = () =>
  within(screen.getByRole('dialog'))
    .queryAllByLabelText('Array dimension input')
    .map((row) => row.querySelector('input')?.value)

const dialogBaseType = () => screen.getByRole('dialog').querySelector('[aria-haspopup="menu"] span')?.textContent

const listMemberType = (listName: string, memberName: string) =>
  store
    .getState()
    .project.data.globalVariableLists?.find((list) => list.name === listName)
    ?.variables.find((variable) => variable.name === memberName)?.type

const resourceGlobalType = (name: string) =>
  store.getState().project.data.configurations.resource.globalVariables.find((variable) => variable.name === name)?.type

const externalType = (pouName: string, name: string) =>
  store
    .getState()
    .project.data.pous.find((pou) => pou.name === pouName)
    ?.interface?.variables.find((variable) => variable.class === 'external' && variable.name === name)?.type

const markFilesSaved = (...names: string[]) =>
  store.getState().fileActions.setFiles({
    files: Object.fromEntries(
      names.map((name) => [
        name,
        {
          type: name === 'Resource' ? ('resource' as const) : ('global-variable-list' as const),
          filePath: '',
          saved: true,
        },
      ]),
    ),
  })

const isSaved = (name: string) => store.getState().fileActions.getSavedState({ name })

const typeChangeDialog = () => screen.queryByText('Type Change: Impact Analysis')

beforeEach(() => {
  store = createTestStore()
})

describe('GVL table: the array dialog edits the member it was opened on', () => {
  it('SA1: saves the array on the GVL member at the row', () => {
    seedProject({
      resourceGlobals: [globalVariable('R0')],
      lists: [{ name: 'GVL', variables: [listMember('M0')] }],
    })
    renderListTable()

    setArrayFromCell(0, '0..9', 'INT')

    expect(listMemberType('GVL', 'M0')).toMatchObject({
      definition: 'array',
      value: 'ARRAY [0..9] OF INT',
      data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..9' }] },
    })
  })

  it('SA1: leaves the Resource global at the same row index unchanged', () => {
    seedProject({
      resourceGlobals: [globalVariable('R0')],
      lists: [{ name: 'GVL', variables: [listMember('M0')] }],
    })
    renderListTable()

    setArrayFromCell(0, '0..9', 'INT')

    expect(resourceGlobalType('R0')).toEqual(INT)
  })

  it('SA2: saves the array on the GVL member when the project has no Resource global', () => {
    seedProject({ lists: [{ name: 'GVL', variables: [listMember('M0')] }] })
    renderListTable()

    setArrayFromCell(0, '0..9', 'INT')

    expect(listMemberType('GVL', 'M0')).toMatchObject({ definition: 'array', value: 'ARRAY [0..9] OF INT' })
  })

  it('SA3: opens on the GVL member current dimensions and base type, not a same-named Resource global', () => {
    seedProject({
      resourceGlobals: [globalVariable('M1', arrayOf('0..2', 'BOOL'))],
      lists: [{ name: 'GVL', variables: [listMember('M0'), listMember('M1', arrayOf('1..5', 'REAL'))] }],
    })
    renderListTable()

    openTypeMenu(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Array' }))

    expect({ dimensions: dialogDimensions(), baseType: dialogBaseType() }).toEqual({
      dimensions: ['1..5'],
      baseType: 'REAL',
    })
  })

  it('SA3: opens on the GVL member current dimensions when the project has no Resource global', () => {
    seedProject({ lists: [{ name: 'GVL', variables: [listMember('M1', arrayOf('1..5', 'REAL'))] }] })
    renderListTable()

    openTypeMenu(0)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Array' }))

    expect(dialogDimensions()).toEqual(['1..5'])
  })
})

describe('the array dialog marks the table it was opened from as unsaved', () => {
  it('marks the GVL unsaved and leaves the Resource saved after an array save from the GVL table', () => {
    seedProject({
      resourceGlobals: [globalVariable('R0')],
      lists: [{ name: 'GVL', variables: [listMember('M0')] }],
    })
    markFilesSaved('GVL', 'Resource')
    renderListTable()

    setArrayFromCell(0, '0..9', 'INT')

    expect({ gvlSaved: isSaved('GVL'), resourceSaved: isSaved('Resource') }).toEqual({
      gvlSaved: false,
      resourceSaved: true,
    })
  })

  it('marks the Resource unsaved after a dropdown type change from the Resource table', () => {
    seedProject({ resourceGlobals: [globalVariable('R0')] })
    markFilesSaved('Resource')
    renderResourceTable()

    pickBaseTypeFromCell(0, 'REAL')

    expect(isSaved('Resource')).toBe(false)
  })

  it('marks the Resource unsaved after an array save from the Resource table', () => {
    seedProject({ resourceGlobals: [globalVariable('R0')] })
    markFilesSaved('Resource')
    renderResourceTable()

    setArrayFromCell(0, '0..3', 'BOOL')

    expect(isSaved('Resource')).toBe(false)
  })
})

describe('Resource table: the array dialog keeps editing the Resource global', () => {
  it('SA4: saves the array on the Resource global at the row', () => {
    seedProject({ resourceGlobals: [globalVariable('R0')] })
    renderResourceTable()

    setArrayFromCell(0, '0..3', 'BOOL')

    expect(resourceGlobalType('R0')).toMatchObject({
      definition: 'array',
      value: 'ARRAY [0..3] OF BOOL',
      data: { baseType: { definition: 'base-type', value: 'BOOL' }, dimensions: [{ dimension: '0..3' }] },
    })
  })
})

describe('a GVL member type change never reaches a POU VAR_EXTERNAL', () => {
  it('SA5: a dropdown type change writes the member with no type-change dialog', () => {
    seedProject({
      lists: [{ name: 'GVL', variables: [listMember('Speed')] }],
      pous: [programWithExternal('Speed')],
    })
    renderListTable()

    pickBaseTypeFromCell(0, 'REAL')

    expect({ member: listMemberType('GVL', 'Speed'), dialogShown: typeChangeDialog() !== null }).toEqual({
      member: { definition: 'base-type', value: 'REAL' },
      dialogShown: false,
    })
  })

  it('SA5: a dropdown type change leaves the same-named POU VAR_EXTERNAL unchanged', () => {
    seedProject({
      lists: [{ name: 'GVL', variables: [listMember('Speed')] }],
      pous: [programWithExternal('Speed')],
    })
    renderListTable()

    pickBaseTypeFromCell(0, 'REAL')
    const proceed = screen.queryByRole('button', { name: 'Proceed with Type Change' })
    if (proceed) fireEvent.click(proceed)

    expect({ member: listMemberType('GVL', 'Speed'), external: externalType('main', 'Speed') }).toEqual({
      member: { definition: 'base-type', value: 'REAL' },
      external: INT,
    })
  })

  it('SA6: an array set from the dialog lands on the member and leaves the POU VAR_EXTERNAL unchanged', () => {
    seedProject({
      lists: [{ name: 'GVL', variables: [listMember('Speed')] }],
      pous: [programWithExternal('Speed')],
    })
    renderListTable()

    setArrayFromCell(0, '0..9', 'INT')

    expect({ member: listMemberType('GVL', 'Speed')?.value, external: externalType('main', 'Speed') }).toEqual({
      member: 'ARRAY [0..9] OF INT',
      external: INT,
    })
  })
})

describe('a Resource global type change keeps updating the POU VAR_EXTERNAL', () => {
  it('SA7: a confirmed dropdown type change rewrites the same-named POU VAR_EXTERNAL', () => {
    seedProject({ resourceGlobals: [globalVariable('Speed')], pous: [programWithExternal('Speed')] })
    renderResourceTable()

    pickBaseTypeFromCell(0, 'REAL')
    fireEvent.click(screen.getByRole('button', { name: 'Proceed with Type Change' }))

    expect({ global: resourceGlobalType('Speed'), external: externalType('main', 'Speed') }).toEqual({
      global: { definition: 'base-type', value: 'REAL' },
      external: { definition: 'base-type', value: 'REAL' },
    })
  })
})
