import type { HmiWidgetCatalog, HmiWidgetInfo } from '../../../../ports/hmi-preview-types'
import {
  canvasElements,
  type CanvasElement,
  dropIndicator,
  dropTarget,
  EDGE_BAND_PX,
  elementAt,
  insertionParent,
  isContainerType,
  isSideBySide,
  liveValue,
  OUTSIDE_CONTAINER_NOTICE,
  placementRefusal,
  propertyEnabled,
  propertyText,
  resizeProperties,
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
      widget('HmiVerticalStack', 'HmiStack'),
      widget('HmiHorizontalStack', 'HmiStack'),
      widget('HmiDiagram', 'HmiContainer'),
      widget('Tiles', 'HmiVerticalStack'),
      widget('HmiLamp', 'HmiElement'),
      widget('Loop', 'Loop'),
    ].map((w) => [w.name.toUpperCase(), w]),
  ),
  colors: [],
}

const SCREEN = `FUNCTION_BLOCK S EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack;
    Row : HmiVerticalStack := (Parent := 'Col');
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
    expect(widgetIsA(CATALOG, 'Tiles', 'hmistack')).toBe(true)
    expect(widgetIsA(CATALOG, 'HmiLamp', 'HmiStack')).toBe(false)
    expect(widgetIsA(CATALOG, 'Loop', 'HmiStack')).toBe(false)
  })

  it('knows the containers and which of them lay children side by side', () => {
    for (const type of ['HmiVerticalStack', 'HmiHorizontalStack', 'HmiDiagram', 'Tiles'])
      expect(isContainerType(CATALOG, type)).toBe(true)
    expect(isContainerType(CATALOG, 'HmiLamp')).toBe(false)
    expect(isSideBySide(CATALOG, 'HmiVerticalStack')).toBe(true)
    expect(isSideBySide(CATALOG, 'Tiles')).toBe(true)
    expect(isSideBySide(CATALOG, 'HmiHorizontalStack')).toBe(false)
    expect(isSideBySide(CATALOG, 'HmiDiagram')).toBe(false)
  })

  it('refuses anything but containers on the screen itself', () => {
    expect(placementRefusal(CATALOG, ['HmiLamp'], null)).toBe(OUTSIDE_CONTAINER_NOTICE)
    expect(placementRefusal(CATALOG, ['HmiVerticalStack', 'HmiLamp'], null)).toBe(OUTSIDE_CONTAINER_NOTICE)
    expect(placementRefusal(CATALOG, ['HmiVerticalStack', 'HmiDiagram'], null)).toBeNull()
    expect(placementRefusal(CATALOG, ['HmiLamp'], 'Row')).toBeNull()
  })

  it("adds into the selected container, the selection's container, else the first container on the screen", () => {
    const m = model()
    const element = (name: string) => m.elements.find((e) => e.name === name) ?? null
    expect(insertionParent(m, CATALOG, element('Row'))).toBe('Row')
    expect(insertionParent(m, CATALOG, element('A'))).toBe('Row')
    expect(insertionParent(m, CATALOG, null)).toBe('Col')
    const bare = parseDesignerBlock('FUNCTION_BLOCK S EXTENDS HmiScreen\nEND_FUNCTION_BLOCK\n', (t) =>
      CATALOG.widgets.has(t.toUpperCase()),
    )
    if (!bare.ok) throw new Error('bare screen does not parse')
    expect(insertionParent(bare.model, CATALOG, null)).toBeNull()
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

  it('drops beside a container in its edge bands, along its parent direction', () => {
    const m = model()
    expect(dropTarget(m, CATALOG, ELEMENTS, 100, 2, null, 5)).toEqual({ parent: 'Col', before: 'Row' })
    expect(dropTarget(m, CATALOG, ELEMENTS, 100, 48, null, 5)).toEqual({ parent: 'Col', before: 'C' })
    expect(dropTarget(m, CATALOG, ELEMENTS, 100, 48, 'C', 5)).toEqual({ parent: 'Col', before: null })
    expect(dropTarget(m, CATALOG, ELEMENTS, 2, 25, null, 5)).toEqual({ parent: 'Row', before: 'A' })
    expect(dropTarget(m, CATALOG, ELEMENTS, 100, 198, null, 5)).toEqual({ parent: null, before: null })
    expect(dropTarget(m, CATALOG, ELEMENTS, 100, 2, null, 0)).toEqual({ parent: 'Row', before: 'B' })
    expect(EDGE_BAND_PX).toBeGreaterThan(0)
  })

  it('uses the left and right bands in a side-by-side parent, keeps bands to a quarter, and none in a diagram', () => {
    const parsed = parseDesignerBlock(
      [
        'FUNCTION_BLOCK S EXTENDS HmiScreen',
        '  VAR',
        '    Row : HmiVerticalStack;',
        "    S1 : HmiHorizontalStack := (Parent := 'Row');",
        "    S2 : HmiHorizontalStack := (Parent := 'Row');",
        '    Plant : HmiDiagram;',
        "    Box : HmiHorizontalStack := (Parent := 'Plant');",
        '  END_VAR',
        'END_FUNCTION_BLOCK',
        '',
      ].join('\n'),
      (t) => CATALOG.widgets.has(t.toUpperCase()),
    )
    if (!parsed.ok) throw new Error('fixture does not parse')
    const m = parsed.model
    const elements: CanvasElement[] = [
      { name: 'Row', box: { id: 1, x: 0, y: 0, width: 200, height: 50 } },
      { name: 'S1', box: { id: 2, x: 0, y: 0, width: 100, height: 50 } },
      { name: 'S2', box: { id: 3, x: 100, y: 0, width: 100, height: 50 } },
      { name: 'Plant', box: { id: 4, x: 0, y: 60, width: 200, height: 100 } },
      { name: 'Box', box: { id: 5, x: 10, y: 70, width: 40, height: 40 } },
    ]
    expect(dropTarget(m, CATALOG, elements, 98, 25, null, 5)).toEqual({ parent: 'Row', before: 'S2' })
    expect(dropTarget(m, CATALOG, elements, 102, 25, null, 5)).toEqual({ parent: 'Row', before: 'S2' })
    expect(dropTarget(m, CATALOG, elements, 198, 25, null, 5)).toEqual({ parent: 'Row', before: null })
    expect(dropTarget(m, CATALOG, elements, 50, 2, null, 5)).toEqual({ parent: 'S1', before: null })
    expect(dropTarget(m, CATALOG, elements, 30, 25, null, 40)).toEqual({ parent: 'S1', before: null })
    expect(dropTarget(m, CATALOG, elements, 11, 71, null, 5)).toEqual({ parent: 'Box', before: null })
    expect(dropIndicator(m, CATALOG, elements, { parent: 'Row', before: 'S2' })).toEqual({
      box: elements[0].box,
      line: { x: 96, y: 0, width: 3, height: 50 },
    })
  })

  it('never drops a moving container into itself or its own containers', () => {
    expect(dropTarget(model(), CATALOG, ELEMENTS, 190, 10, 'Row')).toEqual({ parent: 'Col', before: 'C' })
    expect(dropTarget(model(), CATALOG, ELEMENTS, 190, 10, 'Col')).toEqual({ parent: null, before: null })
  })

  it('marks the container and a bar where the drop goes, along its direction', () => {
    const m = model()
    expect(dropIndicator(m, CATALOG, ELEMENTS, { parent: 'Row', before: 'B' })).toEqual({
      box: ELEMENTS[1].box,
      line: { x: 96, y: 0, width: 3, height: 50 },
    })
    expect(dropIndicator(m, CATALOG, ELEMENTS, { parent: 'Col', before: null }).line).toEqual({
      x: 0,
      y: 101,
      width: 200,
      height: 3,
    })
    expect(dropIndicator(m, CATALOG, ELEMENTS, { parent: 'Row', before: null }, 'B').line).toEqual({
      x: 101,
      y: 0,
      width: 3,
      height: 50,
    })
    expect(dropIndicator(m, CATALOG, ELEMENTS, { parent: null, before: null })).toEqual({
      box: null,
      line: { x: 0, y: 201, width: 200, height: 3 },
    })
  })
})

describe('growing in the inspector and on resize', () => {
  const grow = (on: boolean): HmiWidgetInfo['properties'] => [
    {
      name: 'GrowAuto',
      type: 'BOOL',
      kind: 'bool',
      group: 'layout',
      declaredBy: 'HmiElement',
      defaultValue: on ? 'TRUE' : 'FALSE',
    },
    {
      name: 'GrowScale',
      type: 'DINT',
      kind: 'number',
      group: 'layout',
      declaredBy: 'HmiElement',
      defaultValue: '1',
      enabledBy: 'GrowAuto',
    },
  ]
  const typed = (name: string, base: string, on: boolean): HmiWidgetInfo => ({
    ...widget(name, base),
    properties: grow(on),
  })
  const catalog: HmiWidgetCatalog = {
    widgets: new Map(
      [
        typed('HmiVerticalStack', 'HmiStack', true),
        typed('HmiHorizontalStack', 'HmiStack', true),
        typed('HmiDiagram', 'HmiContainer', true),
        typed('HmiLamp', 'HmiElement', false),
      ].map((w) => [w.name.toUpperCase(), w]),
    ),
    colors: [],
  }
  const model = (() => {
    const parsed = parseDesignerBlock(
      `FUNCTION_BLOCK S EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack;
    Row : HmiVerticalStack := (Parent := 'Col');
    A : HmiLamp := (Parent := 'Row', GrowAuto := TRUE);
    B : HmiLamp := (Parent := 'Row');
    Plant : HmiDiagram := (Parent := 'Col');
    P : HmiLamp := (Parent := 'Plant', GrowAuto := TRUE);
  END_VAR
END_FUNCTION_BLOCK
`,
      (t) => catalog.widgets.has(t.toUpperCase()),
    )
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    return parsed.model
  })()
  const el = (name: string) => {
    const found = model.elements.find((e) => e.name === name)
    if (!found) throw new Error(name)
    return found
  }

  it('reads a property as written, else as the type starts it', () => {
    expect(propertyText(el('Row'), catalog, 'GrowAuto')).toBe('TRUE')
    expect(propertyText(el('B'), catalog, 'GrowAuto')).toBe('FALSE')
    expect(propertyText(el('A'), catalog, 'GrowAuto')).toBe('TRUE')
    expect(propertyText(el('A'), catalog, 'Missing')).toBeUndefined()
  })

  it('takes GrowScale into account only while GrowAuto is on', () => {
    expect(propertyEnabled(el('A'), catalog, 'GrowScale')).toBe(true)
    expect(propertyEnabled(el('B'), catalog, 'GrowScale')).toBe(false)
    expect(propertyEnabled(el('Row'), catalog, 'GrowScale')).toBe(true)
    expect(propertyEnabled(el('B'), catalog, 'GrowAuto')).toBe(true)
  })

  it('turns GrowAuto off when a growing element is resized along its stack', () => {
    expect(resizeProperties(model, catalog, 'A', { width: 80 })).toEqual([
      ['PrefWidth', '80'],
      ['GrowAuto', 'FALSE'],
    ])
    expect(resizeProperties(model, catalog, 'Row', { height: 60 })).toEqual([
      ['PrefHeight', '60'],
      ['GrowAuto', 'FALSE'],
    ])
    expect(resizeProperties(model, catalog, 'Col', { width: 200, height: 90 })).toEqual([
      ['PrefWidth', '200'],
      ['PrefHeight', '90'],
      ['GrowAuto', 'FALSE'],
    ])
  })

  it('leaves GrowAuto alone across the stack, when it is already off, and inside a diagram', () => {
    expect(resizeProperties(model, catalog, 'A', { height: 40 })).toEqual([['PrefHeight', '40']])
    expect(resizeProperties(model, catalog, 'B', { width: 80 })).toEqual([['PrefWidth', '80']])
    expect(resizeProperties(model, catalog, 'Col', { width: 200 })).toEqual([['PrefWidth', '200']])
    expect(resizeProperties(model, catalog, 'P', { width: 30, height: 30 })).toEqual([
      ['PrefWidth', '30'],
      ['PrefHeight', '30'],
    ])
  })
})
