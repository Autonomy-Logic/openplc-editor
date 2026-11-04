import { memo } from 'react'

import type { VariableListIntents, VariableListModel, VariableRowModel } from '../contracts/presentation'
import { Button, SelectField, StatusMessage, TextField, variableListRecipe as recipe } from '../design-system'

export interface VariableListViewProps {
  readonly model: VariableListModel
  readonly intents: VariableListIntents
}

interface VariableRowProps {
  readonly row: VariableRowModel
  readonly editable: boolean
  readonly intents: VariableListIntents
}

// `memo` pays off because the controller reuses unchanged row objects: only edited rows re-render.
const VariableRow = memo(function VariableRow({ row, editable, intents }: VariableRowProps) {
  if (row.rename) {
    return (
      <li className={recipe.row}>
        <div className={recipe.renameField}>
          <TextField
            label={`New name for ${row.name}`}
            value={row.rename.draft}
            error={row.rename.error}
            autoFocus
            onChange={intents.changeRename}
            onEnter={intents.commitRename}
            onEscape={intents.cancelRename}
          />
        </div>
        <Button tone='primary' onClick={intents.commitRename}>
          Apply
        </Button>
        <Button onClick={intents.cancelRename}>Cancel</Button>
      </li>
    )
  }

  return (
    <li className={recipe.row}>
      <span className={recipe.name}>{row.name}</span>
      <span className={recipe.type}>{row.type}</span>
      <Button label={`Rename ${row.name}`} disabled={!editable} onClick={() => intents.startRename(row.id)}>
        Rename
      </Button>
      <Button tone='danger' label={`Remove ${row.name}`} disabled={!editable} onClick={() => intents.remove(row.id)}>
        Remove
      </Button>
    </li>
  )
})

/**
 * Frontend layer: renders the model and turns DOM events into intents. No state, no rules, no I/O, and
 * no knowledge of who implements the intents (real controller or fixture). Styling comes from the recipe.
 */
export function VariableListView({ model, intents }: VariableListViewProps) {
  // The DOM gives a string; only an option the model offered is forwarded as a typed value.
  const selectType = (value: string) => {
    const option = model.typeOptions.find((candidate) => candidate === value)
    if (option) intents.changeNewType(option)
  }

  return (
    <section className={recipe.panel} aria-labelledby='variable-list-title'>
      <header className={recipe.header}>
        <h2 id='variable-list-title' className={recipe.title}>
          Variables
        </h2>
        <StatusMessage tone={model.status.tone} text={model.status.text} />
        <Button tone='primary' disabled={!model.canSave} onClick={intents.requestSave}>
          Save
        </Button>
      </header>

      <form
        className={recipe.addForm}
        onSubmit={(event) => {
          event.preventDefault()
          intents.submitNew()
        }}
      >
        <TextField
          label='Name'
          value={model.newVariable.name}
          error={model.newVariable.error}
          disabled={!model.editable}
          onChange={intents.changeNewName}
        />
        <SelectField
          label='Type'
          value={model.newVariable.type}
          options={model.typeOptions}
          disabled={!model.editable}
          onChange={selectType}
        />
        <Button tone='primary' type='submit' disabled={!model.editable}>
          Add variable
        </Button>
      </form>

      {model.rows.length === 0 ? (
        <p className={recipe.empty}>{model.emptyMessage}</p>
      ) : (
        <ul className={recipe.rows} aria-label='Variable list'>
          {model.rows.map((row) => (
            <VariableRow key={row.id} row={row} editable={model.editable} intents={intents} />
          ))}
        </ul>
      )}
    </section>
  )
}
