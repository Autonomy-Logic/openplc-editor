import { fireEvent, render, screen } from '@testing-library/react'

import { GenericComboboxCell } from '../generic-combobox-cell'

const OPTIONS = [
  { id: 'a', value: 'Alpha', label: 'Alpha' },
  { id: 'b', value: 'Beta', label: 'Beta' },
  { id: 'g', value: 'Gamma', label: 'Gamma' },
]

const renderCell = (props?: Partial<React.ComponentProps<typeof GenericComboboxCell>>) =>
  render(<GenericComboboxCell value='' onValueChange={() => {}} selectValues={OPTIONS} {...props} />)

// Radix DropdownMenu's trigger opens on Enter — deterministic across runners.
const open = () => fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('Enter a value...'), { target: { value: text } })

describe('GenericComboboxCell', () => {
  it('filters options case-insensitively (uppercase query matches mixed-case label)', () => {
    renderCell()
    open()
    type('ALP')

    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.queryByText('Beta')).toBeNull()
    expect(screen.queryByText('Gamma')).toBeNull()
  })

  it('filters options case-insensitively (lowercase query matches mixed-case label)', () => {
    renderCell()
    open()
    type('bet')

    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('keeps the full list visible when disableFilter is set, regardless of typed text', () => {
    renderCell({ disableFilter: true })
    open()
    type('zzz')

    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Gamma')).toBeTruthy()
  })
})
