import { fireEvent, render, screen, within } from '@testing-library/react'

import type { ModuleDefinition } from '../../index'
import { ModuleCombobox } from '../module-combobox'

const io = { digitalInputs: 0, digitalOutputs: 0, analogInputs: 0, analogOutputs: 0 }

// Intentionally NOT in alphabetical order, to prove the component sorts.
const modules: ModuleDefinition[] = [
  { id: 'm-relay', name: 'Relay Output', io },
  { id: 'm-analog', name: 'Analog Input', io, description: '4-20mA sensor module' },
  { id: 'm-digital', name: 'Digital Input', io },
]

// jsdom does not implement scrollIntoView; the keep-highlighted-in-view effect
// calls it during keyboard navigation.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const renderCombobox = (overrides?: Partial<React.ComponentProps<typeof ModuleCombobox>>) =>
  render(<ModuleCombobox modules={modules} value='' onChange={() => {}} {...overrides} />)

const openListItems = () => {
  fireEvent.click(screen.getByRole('button'))
  return screen.getAllByRole('option')
}

describe('ModuleCombobox', () => {
  it('lists modules alphabetically by name', () => {
    renderCombobox()
    const labels = openListItems().map((o) => o.textContent)
    expect(labels).toEqual(['Analog Input', 'Digital Input', 'Relay Output'])
  })

  it('shows the "-- Empty --" option first when allowEmpty is set', () => {
    renderCombobox({ allowEmpty: true })
    const labels = openListItems().map((o) => o.textContent)
    expect(labels).toEqual(['-- Empty --', 'Analog Input', 'Digital Input', 'Relay Output'])
  })

  it('filters the list by typed text (name and description)', () => {
    renderCombobox()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.change(screen.getByPlaceholderText('Filter modules...'), { target: { value: 'input' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Analog Input', 'Digital Input'])

    // Description is searchable too.
    fireEvent.change(screen.getByPlaceholderText('Filter modules...'), { target: { value: '4-20mA' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Analog Input'])
  })

  it('shows an empty-state message when nothing matches', () => {
    renderCombobox()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('Filter modules...'), { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching modules.')).toBeTruthy()
  })

  it('commits the module id on selection', () => {
    const onChange = vi.fn()
    renderCombobox({ onChange })
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Digital Input'))
    expect(onChange).toHaveBeenCalledWith('m-digital')
  })

  it('commits an empty value when the empty option is chosen', () => {
    const onChange = vi.fn()
    renderCombobox({ allowEmpty: true, value: 'm-relay', onChange })
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('-- Empty --'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('does not open when disabled', () => {
    renderCombobox({ disabled: true })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByPlaceholderText('Filter modules...')).toBeNull()
  })

  it('selects the highlighted module on Enter', () => {
    const onChange = vi.fn()
    renderCombobox({ onChange })
    fireEvent.click(screen.getByRole('button'))
    const input = screen.getByPlaceholderText('Filter modules...')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // highlight first (Analog Input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('m-analog')
  })

  it('renders the selected module name on the trigger', () => {
    renderCombobox({ value: 'm-relay' })
    expect(within(screen.getByRole('button')).getByText('Relay Output')).toBeTruthy()
  })
})
