import type { HmiWidgetCatalog, HmiWidgetInfo } from '@root/middleware/shared/ports/hmi-preview-types'
import { parseDesignerBlock } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { fireEvent, render, screen } from '@testing-library/react'

import { Inspector, type InspectorActions } from '../inspector'

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
  const ignore = () => undefined
  const actions: InspectorActions = {
    setProperty: (element, property, value) => {
      calls.push([element, property, value])
    },
    bind: ignore,
    setEvent: ignore,
    rename: ignore,
    remove: ignore,
  }
  render(
    <Inspector
      model={parsed.model}
      element={parsed.model.elements[0] ?? null}
      catalog={CATALOG}
      variables={[]}
      screens={[]}
      actions={actions}
      locked={false}
    />,
  )
  return calls
}

describe('Inspector', () => {
  it('writes the unbound main input of a STRING widget as a string literal', () => {
    const calls = setup(
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
})
