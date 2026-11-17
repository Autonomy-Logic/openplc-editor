import type { HmiPlcVariable, HmiWidgetCatalog, HmiWidgetInfo } from '@root/middleware/shared/ports/hmi-preview-types'
import { parseDesignerBlock } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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
    removeSeries: ignore,
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

const prop = (name: string, extra: Partial<HmiWidgetInfo['properties'][number]> = {}) => ({
  name,
  type: 'REAL',
  kind: 'number' as const,
  group: 'data' as const,
  declaredBy: 'HmiTrend',
  ...extra,
})
const TREND: HmiWidgetInfo = {
  name: 'HmiTrend',
  library: 'StandardWidgets',
  extends: 'HmiElement',
  properties: [
    prop('Value'),
    prop('Value2'),
    prop('Value3'),
    prop('Pens', { type: 'INT', group: 'display', defaultValue: '1' }),
    prop('Caption', { type: 'STRING', kind: 'string' }),
    prop('AccentColor', { type: 'UDINT', kind: 'color', group: 'display' }),
    prop('Color2', { type: 'UDINT', kind: 'color', group: 'display' }),
    prop('Color3', { type: 'UDINT', kind: 'color', group: 'display' }),
  ],
  outputs: [],
  main: { name: 'Value', direction: 'input', type: 'REAL' },
  events: [],
  series: { count: 'Pens', values: ['Value', 'Value2', 'Value3'], colors: ['AccentColor', 'Color2', 'Color3'] },
}

function trend(decl: string, body = '', variables: HmiPlcVariable[] = []) {
  const source = `FUNCTION_BLOCK S EXTENDS HmiScreen\n  VAR\n    ${decl}\n  END_VAR\n${body}END_FUNCTION_BLOCK\n`
  const parsed = parseDesignerBlock(source, (type) => type.toUpperCase() === 'HMITREND')
  if (!parsed.ok) throw new Error('fixture does not parse')
  const set: Array<[string, string, string | null]> = []
  const removed: Array<[string, number]> = []
  const ignore = () => undefined
  const element = parsed.model.elements[0]
  if (!element) throw new Error('fixture has no element')
  render(
    <PropertiesCard
      model={parsed.model}
      element={element}
      catalog={{ widgets: new Map([['HMITREND', TREND]]), colors: ['Accent'] }}
      variables={variables}
      screens={[]}
      actions={{
        setProperty: (e, p, v) => {
          set.push([e, p, v])
        },
        bind: ignore,
        setEvent: ignore,
        rename: ignore,
        remove: ignore,
        removeSeries: (e, i) => {
          removed.push([e, i])
        },
      }}
      locked={false}
      onShowInCode={ignore}
    />,
  )
  return { set, removed }
}

describe('PropertiesCard series', () => {
  it('shows one row per series with its variable and colour, the first one without a remove button', () => {
    const { set, removed } = trend('T : HmiTrend := (Pens := 2);')
    expect(screen.getByTestId('hmi-series-1')).toBeTruthy()
    expect(screen.getByTestId('hmi-series-2')).toBeTruthy()
    expect(screen.queryByTestId('hmi-series-3')).toBeNull()
    expect(screen.queryByTestId('hmi-series-1-remove')).toBeNull()
    expect(screen.getByTestId('hmi-main-binding')).toBeTruthy()
    expect(screen.getByTestId('hmi-series-2-binding')).toBeTruthy()
    expect(screen.getByTestId('hmi-series-2-color').querySelector('[data-testid="hmi-prop-Color2"]')).not.toBeNull()
    expect(screen.queryByTestId('hmi-prop-Value2')).toBeNull()
    expect(screen.queryByTestId('hmi-prop-Pens')).toBeNull()
    expect(screen.getByTestId('hmi-prop-Caption')).toBeTruthy()
    fireEvent.click(screen.getByTestId('hmi-series-2-remove'))
    expect(removed).toEqual([['T', 1]])
    fireEvent.click(screen.getByTestId('hmi-series-add'))
    expect(set).toEqual([['T', 'Pens', '3']])
  })

  it('starts from the default count and disables adding at the maximum', () => {
    trend('T : HmiTrend;')
    expect(screen.getByTestId('hmi-series-1')).toBeTruthy()
    expect(screen.queryByTestId('hmi-series-2')).toBeNull()
    cleanup()
    trend('T : HmiTrend := (Pens := 3);')
    expect(screen.getByTestId('hmi-series-add').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('hmi-prop-tab-style'))
    expect(screen.queryByTestId('hmi-prop-Color2')).toBeNull()
  })

  it('shows a series bound to a multi-dimensional array element', () => {
    trend('T : HmiTrend := (Pens := 2);', '  T.Value2 := instance0.Main.M[2,1];\n', [
      { path: 'instance0.Main.M[2,1]', type: 'REAL' },
    ])
    expect(screen.getByTestId('hmi-series-2-binding').textContent).toContain('instance0.Main.M[2,1]')
  })
})
