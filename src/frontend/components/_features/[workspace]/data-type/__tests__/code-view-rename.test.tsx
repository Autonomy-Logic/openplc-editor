import { act, fireEvent, render, screen } from '@testing-library/react'

// The code view pulls in Monaco, which cannot run in jsdom. The stub is
// writable so a test can play the user typing into the buffer.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: ({ code, onCodeChange }: { code: string; onCodeChange: (value: string) => void }) => (
    <textarea data-testid='variables-code-editor' value={code} onChange={(event) => onCodeChange(event.target.value)} />
  ),
}))

const toastMock = vi.fn()
vi.mock('@root/frontend/components/_features/[app]/toast/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toast: toastMock }),
}))

import type { PLCDataType, PLCVariable } from '@root/middleware/shared/ports/types'
import { useOpenPLCStore } from '@root/frontend/store'
import { serializeDataTypeToText } from '@root/frontend/utils/PLC/data-type-serializer'

import { DataTypeEditor } from '../index'

const declaration = (name: string, fields = '        Speed : INT; (* rpm *)') =>
  `TYPE\n    ${name} : STRUCT\n${fields}\n    END_STRUCT;\nEND_TYPE\n`

const motorVariable: PLCVariable = {
  name: 'motor',
  class: 'local',
  type: { definition: 'user-data-type', value: 'Motor' },
  location: '',
  documentation: '',
}

const getState = () => useOpenPLCStore.getState()

const fieldNames = (dataType: PLCDataType) =>
  dataType.derivation === 'structure' ? dataType.variable.map((field) => field.name) : undefined

const getBuffer = (name: string) => {
  const model = getState().editors.find((editor) => editor.meta.name === name)
  if (model?.type !== 'plc-datatype' || model.structure.display !== 'code') return undefined
  return model.structure.code
}

/** A commit re-canonicalises the buffer, so the expectation is the serializer's text, not the typed one. */
const canonicalOf = (name: string) => {
  const dataType = getState().project.data.dataTypes.find((candidate) => candidate.name === name)
  return dataType ? serializeDataTypeToText(dataType) : undefined
}

const typeInto = (text: string) => {
  fireEvent.change(screen.getByTestId('variables-code-editor'), { target: { value: text } })
}

const clickAway = async () => {
  await act(async () => {
    fireEvent.mouseDown(document.body)
  })
}

/** Seed the store before rendering — an action fired afterwards updates outside `act`. */
const seedMotor = () => {
  getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
  getState().editorActions.updateModelStructureForName('Motor', { display: 'code' })
}

const seedReference = () => {
  getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
  getState().projectActions.setPouVariables({ pouName: 'Main', variables: [motorVariable] })
}

const renderEditor = () => render(<DataTypeEditor dataTypeName='Motor' />)

const editedBody = '        Speed : INT; (* rpm *)\n        Torque : INT;'

describe('DataTypeEditor rename from the code view', () => {
  beforeEach(() => {
    toastMock.mockClear()
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('renames an unreferenced type straight away, body edit included', async () => {
    seedMotor()
    renderEditor()

    typeInto(declaration('Pump', editedBody))
    await clickAway()

    const dataTypes = getState().project.data.dataTypes
    expect(dataTypes.map((dataType) => dataType.name)).toEqual(['Pump'])
    expect(fieldNames(dataTypes[0])).toEqual(['Speed', 'Torque'])
    expect(getState().pendingDatatypeRename).toBeNull()
  })

  it('parks the impact modal when the type is referenced, and confirm propagates', async () => {
    seedMotor()
    seedReference()
    renderEditor()

    typeInto(declaration('Pump', editedBody))
    await clickAway()

    expect(getState().pendingDatatypeRename?.newName).toBe('Pump')
    expect(getState().pendingDatatypeRename?.impact.totalReferences).toBe(1)
    // The body landed first, so the edit survives whatever the user answers.
    expect(getState().project.data.dataTypes[0]).toMatchObject({ name: 'Motor' })
    expect(fieldNames(getState().project.data.dataTypes[0])).toEqual(['Speed', 'Torque'])

    await act(async () => {
      getState().datatypeActions.respondToPendingRename(true)
    })

    expect(getState().project.data.dataTypes.map((dataType) => dataType.name)).toEqual(['Pump'])
    expect(getState().project.data.pous[0].interface?.variables[0].type.value).toBe('Pump')
  })

  it('restores only the name line when the rename is cancelled', async () => {
    seedMotor()
    seedReference()
    renderEditor()

    typeInto(declaration('Pump', editedBody))
    await clickAway()

    await act(async () => {
      getState().datatypeActions.respondToPendingRename(false)
    })

    expect(getBuffer('Motor')).toBe(canonicalOf('Motor'))
    expect(getState().project.data.dataTypes[0]).toMatchObject({ name: 'Motor' })
    expect(fieldNames(getState().project.data.dataTypes[0])).toEqual(['Speed', 'Torque'])
    // A declined modal is a choice, not a failure.
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('surfaces a refused name and behaves like a cancel', async () => {
    seedMotor()
    getState().datatypeActions.create({ name: 'Pump', derivation: 'structure' })
    renderEditor()

    typeInto(declaration('Pump', editedBody))
    await clickAway()

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Rename failed', description: 'Data type name already exists' }),
    )
    expect(getBuffer('Motor')).toBe(canonicalOf('Motor'))
    expect(getState().project.data.dataTypes.map((dataType) => dataType.name)).toEqual(['Motor', 'Pump'])
    expect(fieldNames(getState().project.data.dataTypes[0])).toEqual(['Speed', 'Torque'])
  })

  it('normalizes a case-only edit instead of renaming', async () => {
    seedMotor()
    renderEditor()

    typeInto(declaration('MOTOR', editedBody))
    await clickAway()

    expect(getState().pendingDatatypeRename).toBeNull()
    expect(getState().project.data.dataTypes.map((dataType) => dataType.name)).toEqual(['Motor'])
    expect(fieldNames(getState().project.data.dataTypes[0])).toEqual(['Speed', 'Torque'])
  })

  it('still rejects a syntax error without touching the type', async () => {
    seedMotor()
    renderEditor()

    typeInto('TYPE\n    Pump : STRUCT\n        Speed INT;\n    END_STRUCT;\nEND_TYPE\n')
    await clickAway()

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Syntax error' }))
    expect(getState().project.data.dataTypes.map((dataType) => dataType.name)).toEqual(['Motor'])
    expect(screen.getByText(/missing colon/)).toBeTruthy()
  })

  it('renames before switching to the table view', async () => {
    seedMotor()
    renderEditor()

    typeInto(declaration('Pump', editedBody))
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Data type table visualization'))
    })

    expect(getState().project.data.dataTypes.map((dataType) => dataType.name)).toEqual(['Pump'])
    const model = getState().editors.find((editor) => editor.meta.name === 'Pump')
    expect(model?.type === 'plc-datatype' && model.structure.display).toBe('table')
  })
})
