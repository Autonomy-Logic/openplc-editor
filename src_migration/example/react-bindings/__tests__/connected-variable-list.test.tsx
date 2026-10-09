// Binding tests: a fixture controller proves the view re-renders through useSyncExternalStore.
import { act, fireEvent, render, screen } from '@testing-library/react'

import { createVariableListFixture } from '../../fixtures'
import { ConnectedVariableList, useVariableListController, VariableListControllerProvider } from '..'

describe('ConnectedVariableList', () => {
  it('renders the controller model and re-renders when it changes', () => {
    const fixture = createVariableListFixture('populated')
    render(
      <VariableListControllerProvider controller={fixture}>
        <ConnectedVariableList />
      </VariableListControllerProvider>,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove MotorSpeed' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    act(() => fixture.changeNewName('FromOutside'))
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('FromOutside')
  })

  it('fails loudly without a provider', () => {
    function Probe() {
      useVariableListController()
      return null
    }
    const silence = console.error
    const swallow = (event: ErrorEvent) => event.preventDefault()
    console.error = () => undefined
    window.addEventListener('error', swallow)
    try {
      expect(() => render(<Probe />)).toThrow('useVariableListController must be used inside')
    } finally {
      window.removeEventListener('error', swallow)
      console.error = silence
    }
  })
})
