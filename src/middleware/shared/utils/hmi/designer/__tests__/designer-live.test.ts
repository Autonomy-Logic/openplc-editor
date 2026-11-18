import type {
  HmiPreviewFactory,
  HmiWidgetCatalog,
  HmiWidgetInfo,
  HmiWidgetProperty,
} from '../../../../ports/hmi-preview-types'
import { planLiveElements } from '../designer-live'
import { parseDesignerBlock } from '../designer-model'

const property = (name: string, kind: HmiWidgetProperty['kind'], declaredBy: string): HmiWidgetProperty => ({
  name,
  type: kind === 'string' ? 'STRING' : 'DINT',
  kind,
  group: 'display',
  declaredBy,
})
const BASE = [
  property('Parent', 'elementRef', 'HmiElement'),
  property('X', 'number', 'HmiElement'),
  property('Y', 'number', 'HmiElement'),
  property('GrowAuto', 'bool', 'HmiElement'),
]
const widget = (name: string, base: string, own: HmiWidgetProperty[] = [], defaults = false): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties: [...BASE, ...own],
  outputs: [],
  events: [],
  ...(defaults ? { typeDefaults: [{ name: 'GrowAuto', value: 'TRUE' }] } : {}),
})
const WIDGETS = [
  widget('HmiVerticalStack', 'HmiStack', [], true),
  widget('HmiHorizontalStack', 'HmiStack', [], true),
  widget('HmiDiagram', 'HmiContainer', [], true),
  widget('HmiLabel', 'HmiElement', [
    property('Text', 'string', 'HmiLabel'),
    property('Align', 'enum', 'HmiLabel'),
    property('Fill', 'color', 'HmiLabel'),
  ]),
  widget('HmiPipe', 'HmiElement', [property('Source', 'elementRef', 'HmiPipe')]),
]
const catalog: HmiWidgetCatalog = { widgets: new Map(WIDGETS.map((w) => [w.name.toUpperCase(), w])), colors: [] }
const SETTER = { X: 0, Y: 1, GROWAUTO: 2, TEXT: 0, FILL: 3 }
const factory: HmiPreviewFactory = {
  types: Object.fromEntries(
    WIDGETS.map((w, type) => [
      w.name.toUpperCase(),
      {
        type,
        setters: Object.fromEntries(
          w.properties
            .filter((p) => p.kind !== 'elementRef' && p.kind !== 'enum')
            .map((p) => {
              const key = p.name.toUpperCase()
              const index = key in SETTER ? SETTER[key as keyof typeof SETTER] : 9
              return [key, { index, kind: p.kind === 'string' ? ('str' as const) : ('num' as const) }]
            }),
        ),
      },
    ]),
  ),
}
const LABEL = factory.types.HMILABEL.type
const VSTACK = factory.types.HMIVERTICALSTACK.type

const screen = (declarations: string, body = '') => {
  const parsed = parseDesignerBlock(
    `FUNCTION_BLOCK Main EXTENDS HmiScreen\n  VAR\n${declarations}\n  END_VAR\n${body}END_FUNCTION_BLOCK\n`,
    (t) => catalog.widgets.has(t.toUpperCase()),
  )
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('\n'))
  return parsed.model
}
const BASE_SCREEN = [
  '    Body : HmiHorizontalStack;',
  "    Title : HmiLabel := (Parent := 'Body', Text := 'Title');",
  "    Plant : HmiDiagram := (Parent := 'Body');",
  "    Tank : HmiLabel := (Parent := 'Plant', X := 10, Y := 20);",
  "    Footer : HmiLabel := (Parent := 'Body');",
  '    Side : HmiVerticalStack;',
]
const IDS: Record<string, number> = { BODY: 1, TITLE: 2, PLANT: 3, TANK: 4, FOOTER: 5, SIDE: 6 }
const idOf = (name: string): number | undefined => IDS[name.toUpperCase()]
const plan = (declarations: string[], added: string[], body = '') =>
  planLiveElements({ model: screen(declarations.join('\n'), body), added, catalog, factory, idOf })
const insert = (after: string, ...lines: string[]): string[] => {
  const at = BASE_SCREEN.findIndex((l) => l.includes(`${after} :`))
  return [...BASE_SCREEN.slice(0, at + 1), ...lines, ...BASE_SCREEN.slice(at + 1)]
}

describe('planLiveElements', () => {
  it('places a new element before its next sibling and drawn before the next element the build attaches', () => {
    expect(plan(insert('Tank', "    Note : HmiLabel := (Parent := 'Body', Text := 'Note');"), ['Note'])).toEqual({
      names: ['Note'],
      elements: [
        {
          type: LABEL,
          parent: { id: 1 },
          parentKind: 'stack',
          before: 5,
          drawBefore: 5,
          numbers: [],
          texts: [{ setter: SETTER.TEXT, value: 'Note' }],
        },
      ],
    })
  })

  it('places an element dropped on a diagram at its X and Y, drawn after the parts already there', () => {
    const result = plan(insert('Tank', "    Pump : HmiLabel := (Parent := 'Plant', X := 120, Y := 40);"), ['Pump'])
    expect(result?.elements).toEqual([
      {
        type: LABEL,
        parent: { id: 3 },
        parentKind: 'diagram',
        before: 0,
        drawBefore: 5,
        numbers: [
          { setter: SETTER.X, value: 120 },
          { setter: SETTER.Y, value: 40 },
        ],
        texts: [],
      },
    ])
  })

  it('adds a container on the screen with its type defaults, then what it holds inside it', () => {
    const result = plan(
      [...BASE_SCREEN, '    Extra : HmiVerticalStack;', "    Inner : HmiLabel := (Parent := 'Extra', Text := 'In');"],
      ['Inner', 'Extra'],
    )
    expect(result?.names).toEqual(['Extra', 'Inner'])
    expect(result?.elements).toEqual([
      {
        type: VSTACK,
        parent: { id: 0 },
        parentKind: 'stack',
        before: 0,
        drawBefore: 0,
        numbers: [{ setter: SETTER.GROWAUTO, value: 1 }],
        texts: [],
      },
      {
        type: LABEL,
        parent: { added: 0 },
        parentKind: 'stack',
        before: 0,
        drawBefore: 0,
        numbers: [],
        texts: [{ setter: SETTER.TEXT, value: 'In' }],
      },
    ])
  })

  it('puts a pasted container before the screen container that follows it', () => {
    expect(plan(insert('Footer', '    Copy : HmiVerticalStack := (GrowAuto := FALSE);'), ['Copy'])?.elements).toEqual([
      {
        type: VSTACK,
        parent: { id: 0 },
        parentKind: 'stack',
        before: 6,
        drawBefore: 6,
        numbers: [{ setter: SETTER.GROWAUTO, value: 0 }],
        texts: [],
      },
    ])
  })

  it('refuses what it cannot show exactly as the build will', () => {
    const note = (props: string) => insert('Footer', `    Note : HmiLabel := (Parent := 'Body'${props});`)
    expect(plan(note(', Align := HMI_ALIGN#Left'), ['Note'])).toBeNull()
    expect(plan(note(', Fill := COLOR.Red'), ['Note'])).toBeNull()
    expect(plan(note(''), ['Note'], '  Note.Text := Main.Name;\n')).toBeNull()
    expect(plan(note(''), ['Note'], "  IF Note.Visible THEN Note.Text := 'x'; END_IF;\n")).toBeNull()
    expect(plan(insert('Tank', "    P1 : HmiPipe := (Parent := 'Plant', Source := 'Tank');"), ['P1'])).toBeNull()
    expect(
      plan(
        insert(
          'Footer',
          "    Note : HmiLabel := (Parent := 'Body');",
          "    Q : HmiPipe := (Parent := 'Plant', Source := 'Note');",
        ),
        ['Note'],
      ),
    ).toBeNull()
    expect(plan(insert('Footer', "    Lost : HmiLabel := (Parent := 'Missing');"), ['Lost'])).toBeNull()
    expect(plan(note(''), ['Other'])).toBeNull()
    expect(
      planLiveElements({
        model: screen(note('').join('\n')),
        added: ['Note'],
        catalog,
        factory,
        idOf: () => undefined,
      }),
    ).toBeNull()
    expect(
      planLiveElements({ model: screen(note('').join('\n')), added: ['Note'], catalog, factory: { types: {} }, idOf }),
    ).toBeNull()
  })
})
