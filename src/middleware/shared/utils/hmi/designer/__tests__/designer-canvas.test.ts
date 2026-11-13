import type { HmiWidgetCatalog, HmiWidgetInfo } from '../../../../ports/hmi-preview-types'
import {
  canvasElements,
  type CanvasElement,
  dropTarget,
  elementAt,
  isContainerType,
  liveValue,
  widgetIsA,
} from '../designer-canvas'
import { parseDesignerBlock } from '../designer-model'

const widget = (name: string, base: string): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties: [],
  outputs: [],
  events: [],
})
const CATALOG: HmiWidgetCatalog = {
  widgets: new Map(
    [
      widget('HmiElement', ''),
      widget('HmiStack', 'HmiElement'),
      widget('HmiDiagram', 'HmiStack'),
      widget('HmiLamp', 'HmiElement'),
      widget('Loop', 'Loop'),
    ].map((w) => [w.name.toUpperCase(), w]),
  ),
  colors: [],
}

const SCREEN = `FUNCTION_BLOCK S EXTENDS HmiScreen
  VAR
    Col : HmiStack := (Direction := HMI_DIRECTION#Column);
    Row : HmiStack := (Parent := 'Col', Direction := HMI_DIRECTION#Row);
    A : HmiLamp := (Parent := 'Row');
    B : HmiLamp := (Parent := 'Row');
    C : HmiLamp := (Parent := 'Col');
  END_VAR
END_FUNCTION_BLOCK
`
function model() {
  const parsed = parseDesignerBlock(SCREEN, (t) => CATALOG.widgets.has(t.toUpperCase()))
  if (!parsed.ok) throw new Error('fixture does not parse')
  return parsed.model
}
const ELEMENTS: CanvasElement[] = [
  { name: 'Col', box: { id: 1, x: 0, y: 0, width: 200, height: 200 } },
  { name: 'Row', box: { id: 2, x: 0, y: 0, width: 200, height: 50 } },
  { name: 'A', box: { id: 3, x: 0, y: 0, width: 100, height: 50 } },
  { name: 'B', box: { id: 4, x: 100, y: 0, width: 100, height: 50 } },
  { name: 'C', box: { id: 5, x: 0, y: 50, width: 200, height: 50 } },
]

describe('designer canvas', () => {
  it('follows the EXTENDS chain, cycles included', () => {
    expect(widgetIsA(CATALOG, 'HmiDiagram', 'hmistack')).toBe(true)
    expect(widgetIsA(CATALOG, 'HmiLamp', 'HmiStack')).toBe(false)
    expect(widgetIsA(CATALOG, 'Loop', 'HmiStack')).toBe(false)
    expect(isContainerType(CATALOG, 'HmiDiagram')).toBe(true)
    expect(isContainerType(CATALOG, 'HmiLamp')).toBe(false)
  })

  it('applies literals live and leaves anything else to a build', () => {
    expect(liveValue(' TRUE ')).toEqual({ number: 1 })
    expect(liveValue('false')).toEqual({ number: 0 })
    expect(liveValue('-2.5e1')).toEqual({ number: -25 })
    expect(liveValue("'it$'s'")).toEqual({ text: "it's" })
    expect(liveValue('HMI_DIRECTION#Row')).toBeNull()
    expect(liveValue('A + 1')).toBeNull()
  })

  it("keeps the screen's declared elements once, in frame order", () => {
    const elements = canvasElements(
      [
        { id: 1, x: 0, y: 0, width: 10, height: 10 },
        { id: 7, x: 0, y: 0, width: 10, height: 10 },
        { id: 3, x: 1, y: 1, width: 5, height: 5 },
        { id: 1, x: 2, y: 2, width: 3, height: 3 },
        { id: 9, x: 0, y: 0, width: 1, height: 1 },
      ],
      [
        { id: 1, screen: 's', element: 'COL' },
        { id: 3, screen: 'S', element: 'A' },
        { id: 7, screen: 'S', element: 'HMI__Port' },
        { id: 9, screen: 'Other', element: 'B' },
      ],
      'S',
      model(),
    )
    expect(elements.map((e) => [e.name, e.box.x])).toEqual([
      ['COL', 0],
      ['A', 1],
    ])
  })

  it('picks the innermost element under a point', () => {
    expect(elementAt(ELEMENTS, 150, 10)).toBe('B')
    expect(elementAt(ELEMENTS, 10, 150)).toBe('Col')
    expect(elementAt(ELEMENTS, 150, 10, (n) => n !== 'B')).toBe('Row')
    expect(elementAt(ELEMENTS, 500, 500)).toBeNull()
  })

  it('drops before the first child past the point, along the container direction', () => {
    const m = model()
    expect(dropTarget(m, CATALOG, ELEMENTS, 40, 10)).toEqual({ parent: 'Row', before: 'A' })
    expect(dropTarget(m, CATALOG, ELEMENTS, 60, 10)).toEqual({ parent: 'Row', before: 'B' })
    expect(dropTarget(m, CATALOG, ELEMENTS, 190, 10)).toEqual({ parent: 'Row', before: null })
    expect(dropTarget(m, CATALOG, ELEMENTS, 10, 60)).toEqual({ parent: 'Col', before: 'C' })
    expect(dropTarget(m, CATALOG, ELEMENTS, 10, 150)).toEqual({ parent: 'Col', before: null })
    expect(dropTarget(m, CATALOG, ELEMENTS, 500, 500)).toEqual({ parent: null, before: null })
  })

  it('never drops a moving container into itself or its own containers', () => {
    expect(dropTarget(model(), CATALOG, ELEMENTS, 190, 10, 'Row')).toEqual({ parent: 'Col', before: 'C' })
    expect(dropTarget(model(), CATALOG, ELEMENTS, 190, 10, 'Col')).toEqual({ parent: null, before: null })
  })
})
