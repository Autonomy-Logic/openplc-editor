import { fireEvent, render, screen } from '@testing-library/react'

import type { CreateGraphicalVariableModalData } from '../../../../store/slices/modal/types'
import { CreateGraphicalVariableModal } from '../create-graphical-variable-modal'

// Plain closures instead of vi.fn/jest.fn so the same file runs under the
// editor's jest and the web's vitest.
let confirmed: Parameters<CreateGraphicalVariableModalData['onConfirm']>[0][]
let closes: number

const makeData = (overrides: Partial<CreateGraphicalVariableModalData> = {}): CreateGraphicalVariableModalData => ({
  pinType: 'ANY_NUM',
  name: 'dst',
  suggestedType: { definition: 'base-type', value: 'INT' },
  onConfirm: (choice) => confirmed.push(choice),
  ...overrides,
})

const renderModal = (data = makeData(), dataTypeNames: string[] = ['MyStruct']) =>
  render(
    <CreateGraphicalVariableModal
      isOpen
      data={data}
      dataTypeNames={dataTypeNames}
      onOpenChange={() => undefined}
      onClose={() => {
        closes += 1
      }}
    />,
  )

const typeOptionValues = () =>
  Array.from(screen.getByLabelText('Type').querySelectorAll('option')).map((option) => option.getAttribute('value'))

describe('CreateGraphicalVariableModal', () => {
  beforeEach(() => {
    confirmed = []
    closes = 0
  })

  it('pre-fills the name and the type the editor inferred', () => {
    renderModal()

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('dst')
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('INT')
    expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('local')
  })

  it('offers only the types a restricted generic accepts', () => {
    renderModal(makeData({ pinType: 'ANY_REAL' }))

    expect(typeOptionValues()).toEqual(['REAL', 'LREAL'])
  })

  it('offers base types plus the project data types on a bare ANY pin', () => {
    renderModal(makeData({ pinType: 'ANY', suggestedType: { definition: 'base-type', value: 'DINT' } }))

    const options = typeOptionValues()
    expect(options).toContain('BOOL')
    expect(options).toContain('DINT')
    expect(options).toContain('MyStruct')
  })

  it('hands the edited name, class and type back to the caller and closes', () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'sink' } })
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'output' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'LREAL' } })
    fireEvent.click(screen.getByText('Create'))

    expect(confirmed).toEqual([{ name: 'sink', class: 'output', type: { definition: 'base-type', value: 'LREAL' } }])
    expect(closes).toBe(1)
  })

  it('marks a user data type chosen on an ANY pin as user-data-type', () => {
    renderModal(makeData({ pinType: 'ANY', suggestedType: { definition: 'base-type', value: 'DINT' } }))

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'MyStruct' } })
    fireEvent.click(screen.getByText('Create'))

    expect(confirmed[0].type).toEqual({ definition: 'user-data-type', value: 'MyStruct' })
  })

  it('trims the name and confirms on Enter in the name field', () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  spaced  ' } })
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })

    expect(confirmed).toHaveLength(1)
    expect(confirmed[0].name).toBe('spaced')
  })

  it('creates nothing on cancel and lets the caller undo the box state', () => {
    let cancels = 0
    renderModal(makeData({ onCancel: () => (cancels += 1) }))

    fireEvent.click(screen.getByText('Cancel'))

    expect(confirmed).toEqual([])
    expect(cancels).toBe(1)
    expect(closes).toBe(1)
  })

  it('does not run the caller undo when the variable is created', () => {
    let cancels = 0
    renderModal(makeData({ onCancel: () => (cancels += 1) }))

    fireEvent.click(screen.getByText('Create'))

    expect(confirmed).toHaveLength(1)
    expect(cancels).toBe(0)
  })

  it('tolerates a payload without onCancel', () => {
    renderModal()

    fireEvent.click(screen.getByText('Cancel'))

    expect(confirmed).toEqual([])
    expect(closes).toBe(1)
  })

  it('blocks confirmation while the name is blank', () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })

    expect((screen.getByText('Create') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
    expect(confirmed).toEqual([])
    expect(closes).toBe(0)
  })
})
