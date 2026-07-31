import { render, screen } from '@testing-library/react'

// The variables code editor pulls in Monaco, which cannot run in jsdom.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: () => <div data-testid='variables-code-editor' />,
}))

import { useOpenPLCStore } from '../../../../store'
import { VariablesEditor } from '../index'

const createPou = (
  name: string,
  type: 'program' | 'function' | 'function-block',
  language: 'st' | 'fbd' | 'ld' | 'sfc',
) => {
  const result = useOpenPLCStore.getState().pouActions.create({ type, name, language })
  expect(result.ok).toBe(true)
}

// https://github.com/Autonomy-Logic/openplc-editor/issues/696
describe('VariablesEditor return type selector', () => {
  it('shows the return type selector for a function written in FBD', () => {
    createPou('FbdFunction', 'function', 'fbd')
    render(<VariablesEditor name='FbdFunction' />)
    expect(screen.getByText('Return type :')).toBeTruthy()
  })

  it('shows the return type selector for a function written in LD', () => {
    createPou('LdFunction', 'function', 'ld')
    render(<VariablesEditor name='LdFunction' />)
    expect(screen.getByText('Return type :')).toBeTruthy()
  })

  it('shows the return type selector for a function written in SFC', () => {
    createPou('SfcFunction', 'function', 'sfc')
    render(<VariablesEditor name='SfcFunction' />)
    expect(screen.getByText('Return type :')).toBeTruthy()
  })

  it('associates the return type label with its select trigger', () => {
    createPou('LabeledFunction', 'function', 'fbd')
    render(<VariablesEditor name='LabeledFunction' />)
    const trigger = screen.getByLabelText('Return type :')
    expect(trigger.id).toBe('return-type')
  })

  it('shows the return type selector for a function written in ST', () => {
    createPou('StFunction', 'function', 'st')
    render(<VariablesEditor name='StFunction' />)
    expect(screen.getByText('Return type :')).toBeTruthy()
  })

  it('does not show the return type selector for an FBD program', () => {
    createPou('FbdProgram', 'program', 'fbd')
    render(<VariablesEditor name='FbdProgram' />)
    expect(screen.queryByText('Return type :')).toBeNull()
  })

  it('does not show the return type selector for an FBD function block', () => {
    createPou('FbdBlock', 'function-block', 'fbd')
    render(<VariablesEditor name='FbdBlock' />)
    expect(screen.queryByText('Return type :')).toBeNull()
  })
})
