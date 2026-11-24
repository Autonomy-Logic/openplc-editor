import type { HmiWidgetCatalog, HmiWidgetInfo, HmiWidgetProperty } from '../../../../ports/hmi-preview-types'
import type { CanvasElement } from '../designer-canvas'
import { parseDesignerBlock } from '../designer-model'
import {
  moveProperties,
  placementProperties,
  propertyIgnored,
  resizeProperties,
  shownSpan,
  type StackView,
} from '../designer-span'

const layout = (autoSize: boolean): HmiWidgetProperty[] => [
  {
    name: 'AutoSize',
    type: 'BOOL',
    kind: 'bool',
    group: 'layout',
    declaredBy: 'HmiElement',
    defaultValue: `${autoSize}`.toUpperCase(),
  },
  {
    name: 'Span',
    type: 'DINT',
    kind: 'number',
    group: 'layout',
    declaredBy: 'HmiElement',
    defaultValue: '100',
    enabledBy: 'AutoSize',
  },
  { name: 'PrefWidth', type: 'DINT', kind: 'number', group: 'layout', declaredBy: 'HmiElement' },
]
const widget = (name: string, base: string, autoSize: boolean): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties: layout(autoSize),
  outputs: [],
  events: [],
})
const catalog: HmiWidgetCatalog = {
  widgets: new Map(
    [
      widget('HmiElement', '', false),
      widget('HmiStack', 'HmiContainer', true),
      widget('HmiContainer', 'HmiElement', true),
      widget('HmiVerticalStack', 'HmiStack', true),
      widget('HmiHorizontalStack', 'HmiStack', true),
      widget('HmiDiagram', 'HmiContainer', true),
      widget('HmiLamp', 'HmiElement', false),
    ].map((w) => [w.name.toUpperCase(), w]),
  ),
  colors: [],
}

/** A screen whose row (side by side, 400 lu wide) holds A and B at 25 and F, 100 lu wide, that keeps its size. */
const view = (row: string): StackView => {
  const parsed = parseDesignerBlock(
    `FUNCTION_BLOCK S EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (AutoSize := TRUE, Span := 100);
    Row : HmiVerticalStack := (Parent := 'Col', Gap := 0, AutoSize := TRUE, Span := 100);
${row}
    Plant : HmiDiagram := (Parent := 'Col');
    P : HmiLamp := (Parent := 'Plant', AutoSize := TRUE);
  END_VAR
END_FUNCTION_BLOCK
`,
    (t) => catalog.widgets.has(t.toUpperCase()),
  )
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  const box = (name: string, x: number, y: number, width: number, height: number): CanvasElement => ({
    name,
    box: { id: 0, x, y, width, height },
  })
  return {
    model: parsed.model,
    catalog,
    boxes: [
      box('Col', 0, 0, 400, 480),
      box('Row', 0, 0, 400, 100),
      box('A', 0, 0, 75, 100),
      box('B', 75, 0, 75, 100),
      box('F', 150, 0, 100, 100),
      box('Plant', 0, 100, 400, 380),
    ],
    screen: { width: 400, height: 480 },
  }
}
const ROW = [
  "    A : HmiLamp := (Parent := 'Row', AutoSize := TRUE, Span := 25);",
  "    B : HmiLamp := (Parent := 'Row', AutoSize := TRUE, Span := 25);",
  "    F : HmiLamp := (Parent := 'Row');",
].join('\n')
const shown = view(ROW)
const el = (v: StackView, name: string) => {
  const found = v.model.elements.find((e) => e.name === name)
  if (!found) throw new Error(name)
  return found
}

describe('sizing by Span', () => {
  it('starts a dropped widget at its natural share of the room, a container at the room its siblings leave', () => {
    expect(placementProperties(shown, 'Row', 'HmiLamp', { width: 60, height: 30 })).toEqual([
      ['AutoSize', 'TRUE'],
      ['Span', '20'],
    ])
    expect(placementProperties(shown, 'Row', 'HmiLamp', undefined)).toEqual([
      ['AutoSize', 'TRUE'],
      ['Span', '25'],
    ])
    expect(placementProperties(shown, 'Row', 'HmiVerticalStack', undefined)).toEqual([
      ['AutoSize', 'TRUE'],
      ['Span', '50'],
    ])
    const full = view(
      "    A : HmiLamp := (Parent := 'Row', AutoSize := TRUE, Span := 60);\n    B : HmiLamp := (Parent := 'Row', AutoSize := TRUE, Span := 40);",
    )
    expect(placementProperties(full, 'Row', 'HmiVerticalStack', undefined)).toEqual([
      ['AutoSize', 'TRUE'],
      ['Span', '33'],
    ])
    expect(placementProperties(shown, 'Plant', 'HmiLamp', { width: 60, height: 30 })).toEqual([])
  })

  it('resizes an element sized by Span by its Span alone, exactly also past 100, and others by pixel sizes', () => {
    expect(resizeProperties(shown, 'A', { width: 150 })).toEqual([['Span', '50']])
    expect(resizeProperties(shown, 'A', { width: 270 })).toEqual([['Span', '225']])
    expect(resizeProperties(shown, 'A', { height: 60 })).toEqual([])
    expect(resizeProperties(shown, 'F', { width: 80, height: 60 })).toEqual([
      ['PrefWidth', '80'],
      ['PrefHeight', '60'],
    ])
  })

  it('keeps the length of an element moved to another stack, and its Span within its stack', () => {
    expect(moveProperties(shown, 'A', 'Col')).toEqual([['Span', '53']])
    expect(moveProperties(shown, 'A', 'Row')).toEqual([])
    expect(moveProperties(shown, 'A', 'Plant')).toEqual([])
  })

  it('says pixel sizes are ignored while sized by Span, and Span while AutoSize is off', () => {
    expect(propertyIgnored(shown.model, catalog, el(shown, 'A'), 'PrefWidth')).toMatch(/AutoSize/)
    expect(propertyIgnored(shown.model, catalog, el(shown, 'P'), 'PrefWidth')).toBeNull()
    expect(propertyIgnored(shown.model, catalog, el(shown, 'F'), 'Span')).toBe('Takes effect when AutoSize is on')
    expect(propertyIgnored(shown.model, catalog, el(shown, 'F'), 'PrefWidth')).toBeNull()
  })

  it('shows the span an element is drawn at once the stack is scaled to fit', () => {
    const over = view(
      "    A : HmiLamp := (Parent := 'Row', AutoSize := TRUE, Span := 150);\n    B : HmiLamp := (Parent := 'Row', AutoSize := TRUE, Span := 50);",
    )
    expect(shownSpan(over.model, catalog, el(over, 'A'))).toBe(75)
    expect(shownSpan(shown.model, catalog, el(shown, 'B'))).toBe(25)
  })
})
