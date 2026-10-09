// Design system tests: primitives expose accessible structure and variants, independent of any feature.
import { fireEvent, render, screen } from '@testing-library/react'

import { Button, SelectField, StatusMessage, TextField, ThemeRoot } from '..'

describe('design system primitives', () => {
  it('Button exposes its accessible label and honours disabled', () => {
    let clicks = 0
    render(
      <Button label='Remove Start' disabled onClick={() => clicks++}>
        Remove
      </Button>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Start' }))
    expect(clicks).toBe(0)
  })

  it('TextField links its label, reports changes and flags errors', () => {
    const changes: string[] = []
    render(<TextField label='Name' value='x' error='Invalid.' onChange={(value) => changes.push(value)} />)
    const input = screen.getByLabelText<HTMLInputElement>('Name')
    fireEvent.change(input, { target: { value: 'xy' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(changes).toEqual(['xy'])
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  })

  it('SelectField lists its options', () => {
    const changes: string[] = []
    render(<SelectField label='Type' value='INT' options={['BOOL', 'INT']} onChange={(value) => changes.push(value)} />)
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'BOOL' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['BOOL', 'INT'])
    expect(changes).toEqual(['BOOL'])
  })

  it('StatusMessage and ThemeRoot expose tone and theme for styling', () => {
    const { container } = render(
      <ThemeRoot theme='dark'>
        <StatusMessage tone='error' text='Failed' />
      </ThemeRoot>,
    )
    expect(container.firstElementChild?.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('error')
  })
})
