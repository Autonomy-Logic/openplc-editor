import type {
  VariableListController,
  VariableListModel,
  VariableRowModel,
  VariableTypeOption,
} from '../contracts/presentation'

/** Named view states for catalogs and tests. Each one is a ready model, not a sequence of steps. */
export type VariableListScenario = 'empty' | 'populated' | 'loading' | 'save-failed'

/** One intent received by the fixture, kept so tests can assert what the view asked for. */
export type FixtureCall = { readonly intent: string; readonly argument?: string | number }

/** A presentation controller with no application behind it, plus the log of intents it received. */
export interface VariableListFixture extends VariableListController {
  readonly calls: () => readonly FixtureCall[]
}

const TYPE_OPTIONS: readonly VariableTypeOption[] = ['BOOL', 'INT', 'REAL']

const SAMPLE_ROWS: readonly VariableRowModel[] = [
  { id: 1, name: 'StartButton', type: 'BOOL', rename: null },
  { id: 2, name: 'MotorSpeed', type: 'INT', rename: null },
  { id: 3, name: 'TankLevel', type: 'REAL', rename: null },
]

function initialModel(scenario: VariableListScenario): VariableListModel {
  const base: VariableListModel = {
    rows: [],
    emptyMessage: 'No variables yet.',
    newVariable: { name: '', type: 'BOOL', error: null },
    typeOptions: TYPE_OPTIONS,
    status: { tone: 'neutral', text: 'Simulated scenario: nothing is persisted.' },
    editable: true,
    canSave: false,
  }
  switch (scenario) {
    case 'empty':
      return base
    case 'populated':
      return { ...base, rows: SAMPLE_ROWS, canSave: true }
    case 'loading':
      return {
        ...base,
        emptyMessage: 'Loading…',
        editable: false,
        status: { tone: 'busy', text: 'Loading variables…' },
      }
    case 'save-failed':
      return {
        ...base,
        rows: SAMPLE_ROWS,
        canSave: true,
        status: { tone: 'error', text: 'Saving failed. Your changes are still pending.' },
      }
    default: {
      const unreachable: never = scenario
      return unreachable
    }
  }
}

/**
 * Simulated controller for catalogs and view tests; it records intents and never touches real resources.
 * Its transitions are deliberately naive (no IEC validation): fixtures demonstrate views, not rules.
 */
export function createVariableListFixture(scenario: VariableListScenario): VariableListFixture {
  let model = initialModel(scenario)
  const calls: FixtureCall[] = []
  const listeners = new Set<() => void>()

  const record = (intent: string, argument?: string | number) => calls.push({ intent, argument })
  const update = (next: VariableListModel) => {
    model = next
    listeners.forEach((listener) => listener())
  }
  const updateRow = (id: number, change: (row: VariableRowModel) => VariableRowModel) =>
    update({ ...model, rows: model.rows.map((row) => (row.id === id ? change(row) : row)) })
  const renaming = () => model.rows.find((row) => row.rename !== null)

  return {
    model: {
      getSnapshot: () => model,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    calls: () => calls,
    changeNewName: (value) => {
      record('changeNewName', value)
      update({ ...model, newVariable: { ...model.newVariable, name: value } })
    },
    changeNewType: (value) => {
      record('changeNewType', value)
      update({ ...model, newVariable: { ...model.newVariable, type: value } })
    },
    submitNew: () => {
      record('submitNew')
      const name = model.newVariable.name.trim()
      if (!name) return
      const id = model.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
      update({
        ...model,
        rows: [...model.rows, { id, name, type: model.newVariable.type, rename: null }],
        newVariable: { ...model.newVariable, name: '' },
      })
    },
    startRename: (id) => {
      record('startRename', id)
      updateRow(id, (row) => ({ ...row, rename: { draft: row.name, error: null } }))
    },
    changeRename: (value) => {
      record('changeRename', value)
      const row = renaming()
      if (row) updateRow(row.id, (current) => ({ ...current, rename: { draft: value, error: null } }))
    },
    commitRename: () => {
      record('commitRename')
      const row = renaming()
      if (row)
        updateRow(row.id, (current) => ({ ...current, name: current.rename?.draft ?? current.name, rename: null }))
    },
    cancelRename: () => {
      record('cancelRename')
      const row = renaming()
      if (row) updateRow(row.id, (current) => ({ ...current, rename: null }))
    },
    remove: (id) => {
      record('remove', id)
      update({ ...model, rows: model.rows.filter((row) => row.id !== id) })
    },
    requestSave: () => {
      record('requestSave')
      update({ ...model, status: { tone: 'neutral', text: 'Simulated save: nothing was written.' } })
    },
  }
}
