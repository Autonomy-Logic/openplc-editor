import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ViewModeToggle } from '../index'

const renderToggle = (display: 'table' | 'code') => {
  const onDisplayChange = vi.fn()
  render(
    <ViewModeToggle
      display={display}
      onDisplayChange={onDisplayChange}
      containerLabel='Variables visualization switch container'
      tableLabel='Variables table visualization'
      codeLabel='Variables code visualization'
    />,
  )
  return {
    onDisplayChange,
    table: screen.getByRole('button', { name: 'Variables table visualization' }),
    code: screen.getByRole('button', { name: 'Variables code visualization' }),
  }
}

describe('ViewModeToggle', () => {
  it('exposes both views as buttons carrying their pressed state', () => {
    const { table, code } = renderToggle('table')

    expect(table.getAttribute('aria-pressed')).toBe('true')
    expect(code.getAttribute('aria-pressed')).toBe('false')
  })

  it('reaches both views by Tab, in reading order', async () => {
    const user = userEvent.setup()
    const { table, code } = renderToggle('table')

    await user.tab()
    expect(document.activeElement).toBe(table)

    await user.tab()
    expect(document.activeElement).toBe(code)
  })

  it('switches on Enter', async () => {
    const user = userEvent.setup()
    const { onDisplayChange, code } = renderToggle('table')

    code.focus()
    await user.keyboard('{Enter}')

    expect(onDisplayChange).toHaveBeenCalledWith('code')
  })

  it('switches on Space', async () => {
    const user = userEvent.setup()
    const { onDisplayChange, table } = renderToggle('code')

    table.focus()
    await user.keyboard(' ')

    expect(onDisplayChange).toHaveBeenCalledWith('table')
  })

  it('still switches on click', async () => {
    const user = userEvent.setup()
    const { onDisplayChange, code } = renderToggle('table')

    await user.click(code)

    expect(onDisplayChange).toHaveBeenCalledWith('code')
  })
})
