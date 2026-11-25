import type { HmiWidgetCatalog, HmiWidgetInfo, HmiWidgetProperty } from '../../../ports/hmi-preview-types'
import { checkHmiBlock, checkHmiBlockElements, checkHmiBlockHeader, type HmiCheckContext } from '../block-checks'
import { parseDesignerBlock } from '../designer/designer-model'
import { defaultHmiSettings, hmiSettingsSchema } from '../settings'

const prop = (name: string): HmiWidgetProperty => ({
  name,
  type: 'STRING',
  kind: 'string',
  group: 'layout',
  declaredBy: 'HmiElement',
})
const widget = (name: string, base: string, props: string[] = []): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties: ['Parent', 'PrefWidth', ...props].map(prop),
  outputs: [],
  events: [],
})
const CATALOG: HmiWidgetCatalog = {
  widgets: new Map(
    [
      widget('HmiElement', ''),
      widget('HmiVerticalStack', 'HmiStack', ['Gap']),
      widget('HmiHorizontalStack', 'HmiStack', ['Gap']),
      widget('HmiDiagram', 'HmiContainer'),
      widget('HmiLabel', 'HmiElement', ['Text']),
      widget('HmiPipe', 'HmiElement', ['Source', 'Target']),
    ].map((w) => [w.name.toUpperCase(), w]),
  ),
  colors: [],
}
const CTX: HmiCheckContext = {
  kind: 'screen',
  fileName: 'Overview',
  catalog: CATALOG,
  settings: defaultHmiSettings(),
  screenMembers: new Set(['LAYOUT', 'ROOT']),
}

function blockOf(source: string) {
  const parsed = parseDesignerBlock(source, (t) => CATALOG.widgets.has(t.toUpperCase()))
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('; '))
  const { model } = parsed
  return {
    source,
    block: {
      name: model.name,
      extends: model.extends,
      theme: model.theme,
      methods: model.methods,
      elements: model.elements,
      nameSpan: model.nameSpan,
      ...(model.themeLines ? { themeSpan: model.themeLines } : {}),
    },
  }
}
const screen = (decls: string, head = 'FUNCTION_BLOCK Overview EXTENDS HmiScreen') =>
  blockOf(`${head}\n  VAR\n${decls}\n  END_VAR\nEND_FUNCTION_BLOCK\n`)
const at = (source: string, span: { start: number; end: number } | undefined) =>
  span ? source.slice(span.start, span.end) : undefined

describe('HMI block checks', () => {
  it('accepts a well-formed screen', () => {
    const { block } = screen(
      "    Col : HmiHorizontalStack;\n    Row : HmiVerticalStack := (Parent := 'Col');\n    L : HmiLabel := (Parent := 'Row', Text := 'Hi');",
    )
    expect(checkHmiBlock(block, CTX)).toEqual([])
  })

  it('checks the name, the base, the generated methods and the theme, at the block name or the pragma', () => {
    const wrong = screen('    L : HmiLabel;', 'FUNCTION_BLOCK Details')
    expect(checkHmiBlockHeader(wrong.block, CTX).map((f) => [f.message, at(wrong.source, f.span)])).toEqual([
      ['the file declares Details; it must declare FUNCTION_BLOCK Overview', 'Details'],
      ['Overview must extend HmiScreen', 'Details'],
    ])
    const build = blockOf(
      'FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  METHOD PROTECTED OVERRIDE Build : BOOL Build := TRUE; END_METHOD\nEND_FUNCTION_BLOCK\n',
    )
    expect(checkHmiBlockHeader(build.block, CTX).map((f) => f.message)).toEqual([
      'the HMI build generates Build; remove it',
    ])
    const theme = blockOf(
      `{attribute 'hmi_theme' := 'Nope'}\nFUNCTION_BLOCK Overview EXTENDS HmiScreen\nEND_FUNCTION_BLOCK\n`,
    )
    const [finding] = checkHmiBlockHeader(theme.block, CTX)
    expect(finding.message).toBe("unknown theme 'Nope'")
    expect(at(theme.source, finding.span)).toContain("'hmi_theme'")
    const brand = hmiSettingsSchema.parse({
      ...defaultHmiSettings(),
      themes: [{ name: 'Nope', base: 'Autonomy', colors: {} }],
    })
    expect(checkHmiBlockHeader(theme.block, { ...CTX, settings: brand })).toEqual([])
  })

  it('checks a widget block for its name only', () => {
    const { block } = blockOf('FUNCTION_BLOCK Badge EXTENDS HmiElement\nEND_FUNCTION_BLOCK\n')
    expect(checkHmiBlock(block, { ...CTX, kind: 'widget', fileName: 'Badge' })).toEqual([])
    expect(checkHmiBlock(block, { ...CTX, kind: 'widget', fileName: 'Other' }).map((f) => f.message)).toEqual([
      'the file declares Badge; it must declare FUNCTION_BLOCK Other',
    ])
  })

  it('marks an unknown property at its name', () => {
    const { block, source } = screen(
      "    S : HmiVerticalStack;\n    L : HmiLabel := (Parent := 'S', Text := 'Hi', Bogus := 3);",
    )
    const findings = checkHmiBlockElements(block, CTX)
    expect(findings.map((f) => [f.message, at(source, f.span)])).toEqual([
      ['L: Bogus is not a property of HmiLabel', 'Bogus'],
    ])
  })

  it('checks parents, cycles and pipe ends at the values that are wrong', () => {
    const { block, source } = screen(
      [
        "    A : HmiLabel := (Parent := 'Missing');",
        "    B : HmiLabel := (Parent := 'A');",
        '    C : HmiLabel := (Parent := Main.Tag);',
        "    S1 : HmiVerticalStack := (Parent := 'S2');",
        "    S2 : HmiHorizontalStack := (Parent := 'S1');",
        "    In : HmiLabel := (Parent := 'S1');",
        "    P : HmiPipe := (Source := 'A', Target := 'Nowhere');",
        '    Root : HmiLabel;',
      ].join('\n'),
    )
    expect(checkHmiBlockElements(block, CTX).map((f) => [f.message, at(source, f.span)])).toEqual([
      ['Root: an element may not be named like a member of HmiScreen', 'Root'],
      ["A: Parent 'Missing' is not an element of this screen", "'Missing'"],
      ["B: Parent 'A' is not a container", "'A'"],
      ['C: Parent must be a text literal naming a container', 'Main.Tag'],
      [
        "P: only containers may sit directly on screen Overview; put P in a vertical stack, horizontal stack or diagram with Parent := '<container name>'",
        'P',
      ],
      [
        "Root: only containers may sit directly on screen Overview; put Root in a vertical stack, horizontal stack or diagram with Parent := '<container name>'",
        'Root',
      ],
      ['S1: its Parent chain is a cycle', 'S1'],
      ['S2: its Parent chain is a cycle', 'S2'],
      ['In: its Parent chain is a cycle', 'In'],
      ['P: Target must name an element of this screen', "'Nowhere'"],
    ])
  })

  it('keeps every element but containers off the screen root, naming the element and the screen', () => {
    const { block, source } = screen(
      [
        '    Main : HmiHorizontalStack;',
        '    Side : HmiVerticalStack;',
        '    Plant : HmiDiagram;',
        "    Inside : HmiLabel := (Parent := 'Main');",
        '    Loose : HmiLabel;',
        "    Empty : HmiLabel := (Parent := '');",
      ].join('\n'),
    )
    expect(checkHmiBlockElements(block, CTX).map((f) => [f.message, at(source, f.span)])).toEqual([
      [
        "Loose: only containers may sit directly on screen Overview; put Loose in a vertical stack, horizontal stack or diagram with Parent := '<container name>'",
        'Loose',
      ],
      [
        "Empty: only containers may sit directly on screen Overview; put Empty in a vertical stack, horizontal stack or diagram with Parent := '<container name>'",
        'Empty',
      ],
    ])
  })

  it('lets a widget block hold elements without a container', () => {
    const { block } = blockOf(
      'FUNCTION_BLOCK Badge EXTENDS HmiElement\n  VAR\n    L : HmiLabel;\n  END_VAR\nEND_FUNCTION_BLOCK\n',
    )
    expect(checkHmiBlockElements(block, { ...CTX, kind: 'widget', fileName: 'Badge' })).toEqual([])
  })

  it('checks how many elements a container holds', () => {
    const labels = Array.from({ length: 65 }, (_, i) => `    L${i} : HmiLabel := (Parent := 'Col');`).join('\n')
    const { block, source } = screen(`    Col : HmiVerticalStack;\n${labels}`)
    expect(checkHmiBlockElements(block, CTX).map((f) => [f.message, at(source, f.span)])).toEqual([
      ['Col holds 65 elements; at most 64', 'Col'],
    ])
    const many = Array.from({ length: 65 }, (_, i) => `    L${i} : HmiLabel := (Parent := 'D');`).join('\n')
    expect(checkHmiBlockElements(screen(`    D : HmiDiagram;\n${many}`).block, CTX)).toEqual([])
  })
})
