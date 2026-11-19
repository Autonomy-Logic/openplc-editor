import type {
  HmiPreviewFactory,
  HmiWidgetCatalog,
  HmiWidgetInfo,
  HmiWidgetProperty,
} from '../../../../ports/hmi-preview-types'
import { type LiveModule, planLiveSync } from '../designer-live'
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
const MODULE: LiveModule = { attached: idOf, detached: () => undefined, created: () => false }
const text = (declarations: string, body = '') =>
  `FUNCTION_BLOCK Main EXTENDS HmiScreen\n  VAR\n${declarations}\n  END_VAR\n${body}END_FUNCTION_BLOCK\n`
const sync = (shown: string[], next: string[], body = '', module: LiveModule = MODULE, shownBody = '') =>
  planLiveSync({
    shown: screen(shown.join('\n'), shownBody),
    shownSource: text(shown.join('\n'), shownBody),
    next: screen(next.join('\n'), body),
    nextSource: text(next.join('\n'), body),
    catalog,
    factory,
    module,
  })
const plan = (declarations: string[], body = '') => sync(BASE_SCREEN, declarations, body)
const without = (...names: string[]): string[] => BASE_SCREEN.filter((l) => !names.some((n) => l.includes(`${n} :`)))
const insert = (after: string, ...lines: string[]): string[] => {
  const at = BASE_SCREEN.findIndex((l) => l.includes(`${after} :`))
  return [...BASE_SCREEN.slice(0, at + 1), ...lines, ...BASE_SCREEN.slice(at + 1)]
}

describe('planLiveSync: new elements', () => {
  it('places a new element before its next sibling and drawn before the next element the build attaches', () => {
    expect(plan(insert('Tank', "    Note : HmiLabel := (Parent := 'Body', Text := 'Note');"))).toEqual({
      detach: [],
      detached: [],
      values: [],
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
    const result = plan(insert('Tank', "    Pump : HmiLabel := (Parent := 'Plant', X := 120, Y := 40);"))
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
    const result = plan([
      ...BASE_SCREEN,
      '    Extra : HmiVerticalStack;',
      "    Inner : HmiLabel := (Parent := 'Extra', Text := 'In');",
    ])
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
    expect(plan(insert('Footer', '    Copy : HmiVerticalStack := (GrowAuto := FALSE);'))?.elements).toEqual([
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
    expect(plan(note(', Align := HMI_ALIGN#Left'))).toBeNull()
    expect(plan(note(', Fill := COLOR.Red'))).toBeNull()
    expect(plan(note(''), '  Note.Text := Main.Name;\n')).toBeNull()
    expect(plan(note(''), "  IF Note.Visible THEN Note.Text := 'x'; END_IF;\n")).toBeNull()
    expect(plan(insert('Tank', "    P1 : HmiPipe := (Parent := 'Plant', Source := 'Tank');"))).toBeNull()
    expect(
      plan(
        insert(
          'Footer',
          "    Note : HmiLabel := (Parent := 'Body');",
          "    Q : HmiPipe := (Parent := 'Plant', Source := 'Note');",
        ),
      ),
    ).toBeNull()
    expect(plan(insert('Footer', "    Lost : HmiLabel := (Parent := 'Missing');"))).toBeNull()
    expect(
      sync(BASE_SCREEN, note(''), '', { attached: () => undefined, detached: () => undefined, created: () => false }),
    ).toBeNull()
    const next = screen(note('').join('\n'))
    expect(
      planLiveSync({
        shown: screen(BASE_SCREEN.join('\n')),
        shownSource: text(BASE_SCREEN.join('\n')),
        next,
        nextSource: text(note('').join('\n')),
        catalog,
        factory: { types: {} },
        module: MODULE,
      }),
    ).toBeNull()
  })
})

const stack = (element: number, parent: number) => ({ element, parent, parentKind: 'stack' as const })
const back = (element: number, parent: { id: number } | { added: number }, before: number, drawBefore: number) => ({
  type: 0,
  element,
  parent,
  parentKind: 'stack' as const,
  before,
  drawBefore,
  numbers: [],
  texts: [],
})
const FOOTER = "Footer : HmiLabel := (Parent := 'Body');"
const EMPTY = { detach: [], detached: [], elements: [], names: [], values: [] }

describe('planLiveSync: removing, moving and values', () => {
  it('lists changed values of kept elements, a removed value going back to its start value', () => {
    expect(
      sync(
        BASE_SCREEN,
        BASE_SCREEN.map((l) => l.replace("'Title')", "'Other')")),
      ),
    ).toEqual({
      ...EMPTY,
      values: [{ element: 'Title', property: 'Text', value: "'Other'" }],
    })
    expect(
      sync(
        BASE_SCREEN,
        BASE_SCREEN.map((l) => l.replace('X := 10, ', '')),
      ),
    ).toBeNull()
    expect(sync(BASE_SCREEN, BASE_SCREEN)).toEqual(EMPTY)
  })

  it('takes a removed element off, and a removed container with what it holds, children first', () => {
    expect(sync(BASE_SCREEN, without('Footer'))).toEqual({ ...EMPTY, detach: [stack(5, 1)], detached: ['Footer'] })
    expect(sync(BASE_SCREEN, without('Plant', 'Tank'))?.detach).toEqual([
      { element: 4, parent: 3, parentKind: 'diagram' },
      stack(3, 1),
    ])
  })

  it('removes an element that code still names, and with it its wiring: the build reports the code', () => {
    const code = '  w := Footer.Width;\n'
    expect(sync(BASE_SCREEN, without('Footer'), code, MODULE, code)?.detached).toEqual(['Footer'])
    expect(sync(BASE_SCREEN, without('Footer'), '', MODULE, '  Footer.Text := Main.Name;\n')?.detached).toEqual([
      'Footer',
    ])
  })

  it('leaves any other change of code or theme to the build', () => {
    expect(sync(BASE_SCREEN, BASE_SCREEN, '  Title.Visible := FALSE;\n')).toBeNull()
    expect(sync(BASE_SCREEN, BASE_SCREEN, '  x := 6;\n', MODULE, '  x := 5;\n')).toBeNull()
    expect(sync(without('Footer'), BASE_SCREEN, '', MODULE, '  Title.Text := Main.Name;\n')).toBeNull()
  })

  it('moves an element to an earlier or a later place among its siblings', () => {
    const earlier = [BASE_SCREEN[0], BASE_SCREEN[4], ...BASE_SCREEN.slice(1, 4), BASE_SCREEN[5]]
    expect(sync(BASE_SCREEN, earlier)).toEqual({
      ...EMPTY,
      detach: [stack(5, 1)],
      detached: ['Footer'],
      elements: [back(5, { id: 1 }, 2, 2)],
      names: ['Footer'],
    })
    const later = [BASE_SCREEN[0], ...BASE_SCREEN.slice(2, 5), BASE_SCREEN[1], BASE_SCREEN[5]]
    expect(sync(BASE_SCREEN, later)).toEqual({
      ...EMPTY,
      detach: [stack(2, 1)],
      detached: ['Title'],
      elements: [back(2, { id: 1 }, 0, 6)],
      names: ['Title'],
    })
  })

  it('moves an element into another container, and a container with what it holds', () => {
    const moved = [...without('Footer'), "    Footer : HmiLabel := (Parent := 'Side');"]
    expect(sync(BASE_SCREEN, moved)).toEqual({
      ...EMPTY,
      detach: [stack(5, 1)],
      detached: ['Footer'],
      elements: [back(5, { id: 6 }, 0, 0)],
      names: ['Footer'],
    })
    const plantLast = [...without('Plant', 'Tank', 'Side'), BASE_SCREEN[2], BASE_SCREEN[3], BASE_SCREEN[5]]
    const result = sync(BASE_SCREEN, plantLast)
    expect(result?.detached).toEqual(['Tank', 'Plant'])
    expect(result?.elements).toEqual([
      back(3, { id: 1 }, 0, 6),
      { ...back(4, { added: 0 }, 0, 6), parentKind: 'diagram' },
    ])
  })

  it('puts back an element the module took off when an undo declares it again', () => {
    const module: LiveModule = {
      attached: (name) => (name.toUpperCase() === 'FOOTER' ? undefined : idOf(name)),
      detached: (name) => (name.toUpperCase() === 'FOOTER' ? { id: 5, declaration: FOOTER } : undefined),
      created: () => false,
    }
    expect(sync(without('Footer'), BASE_SCREEN, '', module)).toEqual({
      ...EMPTY,
      elements: [back(5, { id: 1 }, 0, 6)],
      names: ['Footer'],
    })
  })

  it('makes a new element rather than put back one whose declaration changed, and refuses to for a compiled one', () => {
    const held = (created: boolean): LiveModule => ({
      attached: (name) => (name.toUpperCase() === 'FOOTER' ? undefined : idOf(name)),
      detached: (name) => (name.toUpperCase() === 'FOOTER' ? { id: 5, declaration: FOOTER } : undefined),
      created: () => created,
    })
    const changed = BASE_SCREEN.map((l) =>
      l.replace("Footer : HmiLabel := (Parent := 'Body');", "Footer : HmiLabel := (Parent := 'Body', Text := 'New');"),
    )
    expect(sync(without('Footer'), changed, '', held(true))?.elements[0]).toMatchObject({
      type: LABEL,
      texts: [{ value: 'New' }],
    })
    expect(sync(without('Footer'), changed, '', held(false))).toBeNull()
  })

  it('puts back a compiled element with its wiring, which the build compiled, but not a made one', () => {
    const footer = (created: boolean): LiveModule => ({
      attached: (name) => (name.toUpperCase() === 'FOOTER' ? undefined : idOf(name)),
      detached: (name) => (name.toUpperCase() === 'FOOTER' ? { id: 5, declaration: FOOTER } : undefined),
      created: () => created,
    })
    const wiring = '  Footer.Text := Main.Name;\n'
    expect(sync(without('Footer'), BASE_SCREEN, wiring, footer(false))?.names).toEqual(['Footer'])
    expect(sync(without('Footer'), BASE_SCREEN, wiring, footer(true))).toBeNull()
  })

  it('refuses a type change, an element the module lacks, a pipe chained anew or put back, and a dangling reference', () => {
    expect(
      sync(
        BASE_SCREEN,
        BASE_SCREEN.map((l) => l.replace('Footer : HmiLabel', 'Footer : HmiDiagram')),
      ),
    ).toBeNull()
    const lacking: LiveModule = {
      attached: (n) => (n === 'Footer' ? undefined : idOf(n)),
      detached: () => undefined,
      created: () => false,
    }
    expect(sync(BASE_SCREEN, without('Footer'), '', lacking)).toBeNull()
    const pipes = insert('Tank', "    P1 : HmiPipe := (Parent := 'Plant');", "    P2 : HmiPipe := (Parent := 'Plant');")
    const withPipes: LiveModule = {
      attached: (n) => ({ P1: 7, P2: 8 })[n.toUpperCase()] ?? idOf(n),
      detached: () => undefined,
      created: () => false,
    }
    expect(
      sync(
        pipes,
        pipes.filter((l) => !l.includes('P1 :')),
        '',
        withPipes,
      ),
    ).toBeNull()
    expect(
      sync(
        pipes,
        pipes.filter((l) => !l.includes('P2 :')),
        '',
        withPipes,
      )?.detached,
    ).toEqual(['P2'])
    const swapped = pipes.map((l) => (l.includes('P1 :') ? pipes[5] : l.includes('P2 :') ? pipes[4] : l))
    expect(sync(pipes, swapped, '', withPipes)).toBeNull()
    const referring = insert('Tank', "    P1 : HmiPipe := (Parent := 'Plant', Source := 'Footer');")
    const refModule: LiveModule = {
      attached: (n) => (n.toUpperCase() === 'P1' ? 7 : idOf(n)),
      detached: () => undefined,
      created: () => false,
    }
    expect(
      sync(
        referring,
        referring.filter((l) => !l.includes('Footer :')),
        '',
        refModule,
      ),
    ).toBeNull()
  })
})
