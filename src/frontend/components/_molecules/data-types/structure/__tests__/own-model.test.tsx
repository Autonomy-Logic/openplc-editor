import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { useOpenPLCStore } from '@root/frontend/store'
import type { PLCDataType, PLCStructureVariable } from '@root/middleware/shared/ports/types'

import { StructureDataType } from '../index'

const getState = () => useOpenPLCStore.getState()

const field = (name: string): PLCStructureVariable => ({
  name,
  type: { definition: 'base-type', value: 'DINT' },
  initialValue: { simpleValue: { value: '' } },
})

const structure = (name: string, fieldName: string): PLCDataType => ({
  name,
  derivation: 'structure',
  variable: [field(fieldName)],
})

const fieldsOf = (name: string) => {
  const dataType = getState().project.data.dataTypes.find((candidate) => candidate.name === name)
  return dataType?.derivation === 'structure' ? dataType.variable.map((member) => member.name) : undefined
}

/** `create` activates the type it made, so Motor ends up the hidden tab. */
const seedBoth = () => {
  getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
  getState().datatypeActions.create({ name: 'Pump', derivation: 'structure' })
  getState().projectActions.updateDatatype('Motor', structure('Motor', 'Speed'))
  getState().projectActions.updateDatatype('Pump', structure('Pump', 'Flow'))
}

const renderBoth = () => {
  render(
    <>
      <div data-testid='motor-panel'>
        <StructureDataType dataTypeName='Motor' />
      </div>
      <div data-testid='pump-panel'>
        <StructureDataType dataTypeName='Pump' />
      </div>
    </>,
  )
  return {
    motor: within(screen.getByTestId('motor-panel')),
    pump: within(screen.getByTestId('pump-panel')),
  }
}

describe('StructureDataType with two structure types open', () => {
  beforeEach(() => {
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
    seedBoth()
  })

  it('shows each type its own fields', () => {
    const { motor, pump } = renderBoth()

    expect(motor.getByDisplayValue('Speed')).toBeTruthy()
    expect(pump.getByDisplayValue('Flow')).toBeTruthy()
    expect(motor.queryByDisplayValue('Flow')).toBeNull()
    expect(pump.queryByDisplayValue('Speed')).toBeNull()
  })

  it('writes a mutation from the hidden tab into its own type', () => {
    const { motor } = renderBoth()

    fireEvent.click(motor.getByLabelText('Add table row button'))

    expect(fieldsOf('Motor')).toEqual(['Speed', 'Speed_1'])
    expect(fieldsOf('Pump')).toEqual(['Flow'])
  })

  it('keeps row selection on the tab that made it', () => {
    const { motor, pump } = renderBoth()

    act(() => {
      getState().editorActions.updateModelStructureForName('Motor', { selectedRow: 0 })
    })

    expect(motor.getByLabelText('Remove table row button').hasAttribute('disabled')).toBe(false)
    expect(pump.getByLabelText('Remove table row button').hasAttribute('disabled')).toBe(true)
  })

  it('deletes from the hidden tab into its own type', () => {
    const { motor } = renderBoth()

    act(() => {
      getState().editorActions.updateModelStructureForName('Motor', { selectedRow: 0 })
    })
    fireEvent.click(motor.getByLabelText('Remove table row button'))

    expect(fieldsOf('Motor')).toEqual([])
    expect(fieldsOf('Pump')).toEqual(['Flow'])
  })
})
