// View tests: a literal model in, recorded intents out. No controller, no store.
import { fireEvent, render, screen } from '@testing-library/react'

import type { VariableListIntents, VariableListModel } from '../../contracts/presentation'
import { VariableListView } from '..'

const MODEL: VariableListModel = {
  rows: [
    { id: 1, name: 'Start', type: 'BOOL', rename: null },
    { id: 2, name: 'Speed', type: 'INT', rename: { draft: 'Spd', error: 'Too short.' } },
  ],
  emptyMessage: 'No variables yet.',
  newVariable: { name: 'Level', type: 'BOOL', error: 'Bad name.' },
  typeOptions: ['BOOL', 'INT', 'REAL'],
  status: { tone: 'warning', text: 'Unsaved changes' },
  editable: true,
  canSave: true,
}

function recordingIntents() {
  const calls: string[] = []
  const intents: VariableListIntents = {
    changeNewName: (value) => calls.push(`changeNewName:${value}`),
    changeNewType: (value) => calls.push(`changeNewType:${value}`),
    submitNew: () => calls.push('submitNew'),
    startRename: (id) => calls.push(`startRename:${id}`),
    changeRename: (value) => calls.push(`changeRename:${value}`),
    commitRename: () => calls.push('commitRename'),
    cancelRename: () => calls.push('cancelRename'),
    remove: (id) => calls.push(`remove:${id}`),
    requestSave: () => calls.push('requestSave'),
  }
  return { calls, intents }
}

describe('VariableListView', () => {
  it('renders exactly what the model says', () => {
    render(<VariableListView model={MODEL} intents={recordingIntents().intents} />)
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes')
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Level')
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual(['Bad name.', 'Too short.'])
    expect(screen.getByLabelText<HTMLInputElement>('New name for Speed').value).toBe('Spd')
    expect(screen.queryByText('No variables yet.')).toBeNull()
  })

  it('turns user actions into intents', () => {
    const { calls, intents } = recordingIntents()
    render(<VariableListView model={MODEL} intents={intents} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tank' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'REAL' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename Start' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Start' }))
    fireEvent.change(screen.getByLabelText('New name for Speed'), { target: { value: 'Spe' } })
    fireEvent.keyDown(screen.getByLabelText('New name for Speed'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('New name for Speed'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(calls).toEqual([
      'changeNewName:Tank',
      'changeNewType:REAL',
      'submitNew',
      'startRename:1',
      'remove:1',
      'changeRename:Spe',
      'commitRename',
      'cancelRename',
      'commitRename',
      'cancelRename',
      'requestSave',
    ])
  })

  it('shows the empty message and disables editing when the model says so', () => {
    const { calls, intents } = recordingIntents()
    render(
      <VariableListView
        model={{ ...MODEL, rows: [], editable: false, canSave: false, emptyMessage: 'Loading…' }}
        intents={intents}
      />,
    )
    expect(screen.getByText('Loading…')).not.toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(calls).toEqual([])
  })
})
