import type { HmiWidgetCatalog, HmiWidgetInfo } from '../../../../ports/hmi-preview-types'
import {
  bendsOf,
  designRecords,
  diagramOf,
  formatPath,
  gridOf,
  insertBend,
  MAX_BENDS,
  numberProp,
  parsePath,
  pipeProps,
  portAt,
  snap,
  toCanvas,
  toDesign,
  withTheirPipes,
} from '../designer-diagram'
import { setProperties } from '../designer-edits'
import { parseDesignerBlock } from '../designer-model'

const widget = (name: string, base: string, properties: HmiWidgetInfo['properties'] = []): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties,
  outputs: [],
  events: [],
})
const CATALOG: HmiWidgetCatalog = {
  widgets: new Map(
    [
      widget('HmiElement', ''),
      widget('HmiStack', 'HmiElement'),
      widget('HmiDiagram', 'HmiStack', [
        { name: 'Grid', type: 'DINT', kind: 'number', group: 'display', defaultValue: '10', declaredBy: 'HmiDiagram' },
      ]),
      widget('HmiVessel', 'HmiElement'),
      widget('HmiPipe', 'HmiElement'),
    ].map((w) => [w.name.toUpperCase(), w]),
  ),
  colors: [],
}

const SCREEN = `FUNCTION_BLOCK S EXTENDS HmiScreen
  VAR
    Col : HmiStack;
    Plant : HmiDiagram := (Grid := 20);
    Free : HmiDiagram;
    A : HmiVessel := (Parent := 'Plant', X := 40, Y := 30);
    B : HmiVessel := (Parent := 'Plant');
    C : HmiVessel := (Parent := 'Col');
    P1 : HmiPipe := (Parent := 'Plant', Source := 'A', Target := 'B', Path := '100,30; 100,200;bad;7');
    P2 : HmiPipe := (Parent := 'Plant', Source := 'B', Target := 'C');
    P3 : HmiPipe := (Parent := 'Plant', Source := Main.Name, Target := 'C');
  END_VAR
END_FUNCTION_BLOCK
`
function model() {
  const parsed = parseDesignerBlock(SCREEN, (t) => CATALOG.widgets.has(t.toUpperCase()))
  if (!parsed.ok) throw new Error('fixture does not parse')
  return parsed.model
}
const element = (name: string) => {
  const found = model().elements.find((e) => e.name === name)
  if (!found) throw new Error(`no ${name}`)
  return found
}

describe('designer diagrams', () => {
  it('reads ports, diagram frames and pipe routes out of design-mode bounds', () => {
    const records = designRecords(
      [
        { id: 2, x: 0, y: 0, width: 100, height: 100 },
        { id: -(2 * 8 + 7) - 1, x: 10, y: 20, width: 32768, height: 0 },
        { id: -(4 * 8 + 1) - 1, x: 50, y: 60, width: 0, height: 0 },
        { id: -(4 * 8 + 3) - 1, x: 30, y: 60, width: 0, height: 0 },
        { id: -(1000000 + 7 * 32 + 1), x: 5, y: 6, width: 0, height: 0 },
        { id: -(1000000 + 7 * 32 + 0), x: 1, y: 2, width: 0, height: 0 },
        { id: -(9 * 8 + 1) - 1, x: 0, y: 0, width: 0, height: 0 },
        { id: -(4 * 8 + 5) - 1, x: 0, y: 0, width: 0, height: 0 },
      ],
      [
        { id: 2, screen: 'S', element: 'Plant' },
        { id: 4, screen: 's', element: 'A' },
        { id: 7, screen: 'S', element: 'P1' },
        { id: 9, screen: 'Other', element: 'X' },
      ],
      'S',
    )
    expect(records.frames.get('PLANT')).toEqual({ x: 10, y: 20, scale: 0.5 })
    expect(records.ports).toEqual([
      { element: 'A', port: 1, x: 50, y: 60 },
      { element: 'A', port: 3, x: 30, y: 60 },
    ])
    expect(records.routes.get('P1')).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 6 },
    ])
  })

  it('converts between the canvas and design units, and snaps to the grid', () => {
    const frame = { x: 10, y: 20, scale: 0.5 }
    expect(toDesign(frame, { x: 30, y: 70 })).toEqual({ x: 40, y: 100 })
    expect(toCanvas(frame, { x: 40, y: 100 })).toEqual({ x: 30, y: 70 })
    expect(snap(14, 10)).toBe(10)
    expect(snap(16, 10)).toBe(20)
    expect(snap(16.4, 0)).toBe(16)
  })

  it('finds the diagram an element is placed in, its grid and its numbers', () => {
    const m = model()
    expect(diagramOf(m, CATALOG, 'A')?.name).toBe('Plant')
    expect(diagramOf(m, CATALOG, 'C')).toBeNull()
    expect(diagramOf(m, CATALOG, 'Col')).toBeNull()
    expect(gridOf(CATALOG, element('Plant'))).toBe(20)
    expect(gridOf(CATALOG, element('Free'))).toBe(10)
    expect(numberProp(CATALOG, element('A'), 'X', 0)).toBe(40)
    expect(numberProp(CATALOG, element('B'), 'X', 0)).toBe(0)
  })

  it('reads and writes Path as HmiPipe does', () => {
    expect(bendsOf(element('P1'))).toEqual([
      { x: 100, y: 30 },
      { x: 100, y: 200 },
    ])
    expect(bendsOf(element('P2'))).toEqual([])
    expect(parsePath('1,2,3;-4.6,5;x,1;;8 , 9')).toEqual([
      { x: -5, y: 5 },
      { x: 8, y: 9 },
    ])
    const many = Array.from({ length: 12 }, (_, i) => ({ x: i, y: i }))
    expect(parsePath(formatPath(many))).toHaveLength(MAX_BENDS)
    expect(formatPath([{ x: 1.4, y: 2.6 }])).toBe('1,3')
  })

  it('adds a bend on the nearest segment, starting from the automatic route', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ]
    expect(insertBend([], route, { x: 50, y: 60 })).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 60 },
      { x: 100, y: 50 },
    ])
    expect(insertBend([{ x: 0, y: 50 }], [route[0], { x: 0, y: 50 }, route[3]], { x: 2, y: 20 })).toEqual([
      { x: 2, y: 20 },
      { x: 0, y: 50 },
    ])
    const withElbows = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 80 },
      { x: 160, y: 80 },
      { x: 160, y: 0 },
      { x: 200, y: 0 },
    ]
    const two = [
      { x: 40, y: 80 },
      { x: 160, y: 80 },
    ]
    expect(insertBend(two, withElbows, { x: 100, y: 80 })).toEqual([two[0], { x: 100, y: 80 }, two[1]])
    expect(insertBend(two, withElbows, { x: 180, y: 0 })).toEqual([...two, { x: 180, y: 0 }])
    expect(insertBend(two, withElbows, { x: 20, y: 0 })).toEqual([{ x: 20, y: 0 }, ...two])
    expect(insertBend([], [], { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }])
    const straight = [
      { x: 0, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 10 },
      { x: 100, y: 10 },
    ]
    expect(insertBend([], straight, { x: 30, y: 10 })).toEqual([{ x: 30, y: 10 }])
    const ends = [
      { x: 120, y: 120 },
      { x: 460, y: 120 },
    ]
    expect(insertBend([{ x: 230, y: 120 }], ends, { x: 370, y: 120 })).toEqual([
      { x: 230, y: 120 },
      { x: 370, y: 120 },
    ])
  })

  it('describes a new pipe between ports, and the pipes that go with a deleted element', () => {
    expect(pipeProps({ element: 'A', port: 1, x: 0, y: 0 }, { element: 'B', port: 3, x: 0, y: 0 })).toEqual([
      ['Source', "'A'"],
      ['SourcePort', 'HMI_PORT#Right'],
      ['Target', "'B'"],
      ['TargetPort', 'HMI_PORT#Left'],
    ])
    expect(withTheirPipes(model(), CATALOG, ['B'])).toEqual(['B', 'P1', 'P2'])
    expect(withTheirPipes(model(), CATALOG, ['P1', 'A'])).toEqual(['P1', 'A'])
  })

  it('picks the nearest accepted port within the radius', () => {
    const ports = [
      { element: 'A', port: 0, x: 0, y: 0 },
      { element: 'B', port: 2, x: 4, y: 0 },
    ]
    expect(portAt(ports, { x: 3, y: 0 }, 5)?.element).toBe('B')
    expect(portAt(ports, { x: 3, y: 0 }, 5, (p) => p.element === 'A')?.element).toBe('A')
    expect(portAt(ports, { x: 30, y: 0 }, 5)).toBeNull()
  })

  it('sets several properties in one edit', () => {
    const isWidget = (t: string) => CATALOG.widgets.has(t.toUpperCase())
    const result = setProperties(
      SCREEN,
      model(),
      'B',
      [
        ['X', '60'],
        ['Y', '80'],
      ],
      isWidget,
    )
    if (!result.ok) throw new Error(result.message)
    expect(result.source).toContain("B : HmiVessel := (Parent := 'Plant', X := 60, Y := 80);")
    expect(setProperties(SCREEN, model(), 'Nope', [['X', '1']], isWidget).ok).toBe(false)
  })
})
