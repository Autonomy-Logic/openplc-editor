import type { HmiWidgetCatalog, HmiWidgetInfo } from '@root/middleware/shared/ports/hmi-preview-types'
import { parseDesignerBlock } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { fireEvent, render, screen } from '@testing-library/react'

import { type InspectorActions, PropertiesCard } from '../inspector'

const LABEL: HmiWidgetInfo = {
  name: 'HmiLabel',
  library: 'StandardWidgets',
  extends: 'HmiElement',
  properties: [
    { name: 'Text', type: 'STRING', kind: 'string', group: 'data', defaultValue: "'Label'", declaredBy: 'HmiLabel' },
  ],
  outputs: [],
  main: { name: 'Text', direction: 'input', type: 'STRING' },
  events: [],
}
const CATALOG: HmiWidgetCatalog = { widgets: new Map([['HMILABEL', LABEL]]), colors: [] }

function setup(source: string) {
  const parsed = parseDesignerBlock(source, (type) => type.toUpperCase() === 'HMILABEL')
  if (!parsed.ok) throw new Error('fixture does not parse')
  const calls: Array<[string, string, string | null]> = []
  const shown: string[] = []
  const renamed: string[] = []
  const ignore = () => undefined
  const actions: InspectorActions = {
    setProperty: (element, property, value) => {
      calls.push([element, property, value])
    },
    bind: ignore,
    setEvent: ignore,
    rename: (_element, name) => {
      renamed.push(name)
    },
    remove: ignore,
  }
  const element = parsed.model.elements[0]
  if (!element) throw new Error('fixture has no element')
  render(
    <PropertiesCard
      model={parsed.model}
      element={element}
      catalog={CATALOG}
      variables={[]}
      screens={[]}
      actions={actions}
      locked={false}
      onShowInCode={(name) => {
        shown.push(name)
      }}
    />,
  )
  return { calls, shown, renamed }
}

describe('PropertiesCard', () => {
  it('writes the unbound main input of a STRING widget as a string literal', () => {
    const { calls } = setup(
      "FUNCTION_BLOCK S EXTENDS HmiScreen\n  VAR\n    Title : HmiLabel := (Text := 'Overview');\n  END_VAR\nEND_FUNCTION_BLOCK\n",
    )
    const field = screen.getByTestId('hmi-prop-Text')
    expect(screen.getByDisplayValue('Overview')).toBe(field)
    fireEvent.change(field, { target: { value: "Plant's overview" } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(calls).toEqual([['Title', 'Text', "'Plant$'s overview'"]])
  })

  it('hides the literal field of a main input bound to a variable', () => {
    setup(
      'FUNCTION_BLOCK S EXTENDS HmiScreen\n  VAR\n    Title : HmiLabel;\n  END_VAR\n  Title.Text := Main.Msg;\nEND_FUNCTION_BLOCK\n',
    )
    expect(screen.queryByTestId('hmi-prop-Text')).toBeNull()
  })

  it('shows each property group on its tab, and collapses to its header', () => {
    setup('FUNCTION_BLOCK S EXTENDS HmiScreen\n  VAR\n    Title : HmiLabel;\n  END_VAR\nEND_FUNCTION_BLOCK\n')
    fireEvent.click(screen.getByTestId('hmi-prop-tab-actions'))
    expect(screen.getByText('This widget has no actions.')).toBeTruthy()
    fireEvent.click(screen.getByTestId('hmi-prop-tab-style'))
    expect(screen.getByText('This widget has no style properties.')).toBeTruthy()
    fireEvent.click(screen.getByTestId('hmi-properties-collapse'))
    expect(screen.queryByTestId('hmi-prop-tab-data')).toBeNull()
    fireEvent.click(screen.getByTestId('hmi-properties-collapse'))
    expect(screen.getByTestId('hmi-prop-tab-data')).toBeTruthy()
  })

  it('renames in the header and asks for the code of the element', () => {
    const result = setup(
      'FUNCTION_BLOCK S EXTENDS HmiScreen\n  VAR\n    Title : HmiLabel;\n  END_VAR\nEND_FUNCTION_BLOCK\n',
    )
    const name = screen.getByTestId('hmi-element-name')
    fireEvent.change(name, { target: { value: 'Heading' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('hmi-show-in-code'))
    expect(result.renamed).toEqual(['Heading'])
    expect(result.shown).toEqual(['Title'])
  })
})
