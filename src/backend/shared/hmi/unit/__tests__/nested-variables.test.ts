import { readFileSync } from 'fs'
import { join } from 'path'

import type { PLCDataType, PLCPou, PLCVariable, PLCVariableType } from '../../../../../middleware/shared/ports/types'
import {
  hmiLibraryBlocks,
  hmiLibraryBlocksOfArchives,
  hmiPlcVariables,
} from '../../../../../middleware/shared/utils/hmi/plc-variables'
import { hmiSettingsSchema } from '../../../../../middleware/shared/utils/hmi/settings'
import { loadStrucpp } from '../../../library/strucpp-runtime'
import { hmiTagResolver } from '../../artefact/tag-resolver'
import { generateHmiUnit } from '../generate-hmi-unit'
import { installedWidgetArchives } from './fixtures/widget-libraries'

const base = (value: string): PLCVariableType => ({ definition: 'base-type', value })
const named = (value: string): PLCVariableType => ({ definition: 'derived', value })
const v = (name: string, type: PLCVariableType, extra: Partial<PLCVariable> = {}): PLCVariable => ({
  name,
  type,
  location: '',
  documentation: '',
  ...extra,
})
const array = (value: string, dims: string[], definition: 'base-type' | 'user-data-type' = 'base-type') => ({
  definition: 'array' as const,
  value: 'ARRAY',
  data: { baseType: { definition, value }, dimensions: dims.map((dimension) => ({ dimension })) },
})

const DATA_TYPES: PLCDataType[] = [
  {
    name: 'Pt',
    derivation: 'structure',
    variable: [
      { name: 'X', type: base('REAL') },
      { name: 'Inner', type: { definition: 'user-data-type', value: 'Sub' } },
    ],
  },
  { name: 'Sub', derivation: 'structure', variable: [{ name: 'Z', type: base('BOOL') }] },
]
const POUS: PLCPou[] = [
  {
    name: 'MyFb',
    pouType: 'function-block',
    body: { language: 'st', value: '' },
    interface: {
      variables: [
        v('A', base('INT'), { class: 'input' }),
        v('B', base('BOOL'), { class: 'output' }),
        v('C', base('INT'), { class: 'inOut' }),
        v('Hidden', base('INT'), { class: 'local' }),
      ],
    },
  },
  {
    name: 'Main',
    pouType: 'program',
    body: { language: 'st', value: '' },
    interface: {
      variables: [
        v('T1', named('TON')),
        v('P', { definition: 'user-data-type', value: 'Pt' }),
        v('Arr', array('INT', ['0..3'])),
        v('Big', array('INT', ['0..99'])),
        v('Flags', array('BOOL', ['0..99'])),
        v('M', array('REAL', ['1..2', '0..1'])),
        v('Ps', array('Pt', ['0..1'], 'user-data-type')),
        v('F', named('MyFb')),
        v('Limit', base('INT'), { flag: 'constant', initialValue: '5' }),
      ],
    },
  },
]
const PROJECT = {
  pous: POUS,
  dataTypes: DATA_TYPES,
  configurations: {
    resource: {
      tasks: [],
      instances: [{ name: 'instance0', program: 'Main', task: 't' }],
      globalVariables: [v('G', { definition: 'user-data-type', value: 'Pt' }, { flag: 'constant' })],
    },
  },
}
const DECLARATIONS = `TYPE Sub : STRUCT Z : BOOL; END_STRUCT; END_TYPE
TYPE Pt : STRUCT X : REAL; Inner : Sub; END_STRUCT; END_TYPE
FUNCTION_BLOCK MyFb
  VAR_INPUT A : INT; END_VAR
  VAR_OUTPUT B : BOOL; END_VAR
  VAR_IN_OUT C : INT; END_VAR
  VAR Hidden : INT; END_VAR
  B := A > 0;
END_FUNCTION_BLOCK
PROGRAM Main
  VAR
    T1 : TON; P : Pt; Arr : ARRAY[0..3] OF INT; Big : ARRAY[0..99] OF INT; Flags : ARRAY[0..99] OF BOOL; M : ARRAY[1..2, 0..1] OF REAL;
    Ps : ARRAY[0..1] OF Pt; F : MyFb;
  END_VAR
  VAR CONSTANT Limit : INT := 5; END_VAR
  ;
END_PROGRAM
CONFIGURATION Config0
  VAR_GLOBAL CONSTANT G : Pt; END_VAR
  RESOURCE Res0 ON PLC
    TASK t(INTERVAL := T#20ms, PRIORITY := 1);
    PROGRAM instance0 WITH t : Main;
  END_RESOURCE
END_CONFIGURATION
`
const ARCHIVE_JSON = readFileSync(
  join(process.cwd(), 'node_modules', 'strucpp', 'libs', 'iec-standard-fb.stlib'),
  'utf-8',
)
const LIBRARY = hmiLibraryBlocks([{ name: 'iec-standard-fb', archiveJson: ARCHIVE_JSON }])

describe('nested HMI variables', () => {
  const variables = hmiPlcVariables(PROJECT, LIBRARY)
  const paths = variables.map((x) => x.path)

  it('lists block pins, struct fields and array elements', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        'instance0.Main.T1.IN',
        'instance0.Main.T1.PT',
        'instance0.Main.T1.Q',
        'instance0.Main.T1.ET',
        'instance0.Main.P.X',
        'instance0.Main.P.Inner.Z',
        'instance0.Main.Arr[0]',
        'instance0.Main.Arr[3]',
        'instance0.Main.Ps[1].X',
        'instance0.Main.Ps[1].Inner.Z',
        'instance0.Main.F.A',
        'instance0.Main.F.B',
        'G.X',
        'G.Inner.Z',
        'instance0.Main.M[1,0]',
        'instance0.Main.M[2,1]',
      ]),
    )
    expect(paths.filter((p) => p.startsWith('instance0.Main.M['))).toEqual([
      'instance0.Main.M[1,0]',
      'instance0.Main.M[1,1]',
      'instance0.Main.M[2,0]',
      'instance0.Main.M[2,1]',
    ])
    expect(variables.find((x) => x.path === 'instance0.Main.T1.Q')?.type).toBe('BOOL')
    expect(variables.find((x) => x.path === 'instance0.Main.Arr[3]')?.type).toBe('INT')
  })

  it('leaves out in-outs, internals and elements past the cap, and keeps constants read-only', () => {
    expect(paths.filter((p) => /\.F\.(C|Hidden)$/.test(p))).toEqual([])
    expect(paths.filter((p) => p.startsWith('instance0.Main.Big['))).toHaveLength(32)
    expect(paths).not.toContain('instance0.Main.Big[32]')
    expect(variables.find((x) => x.path === 'G.X')?.constant).toBe(true)
    expect(variables.find((x) => x.path === 'instance0.Main.Limit')).toMatchObject({
      constant: true,
      initialValue: '5',
    })
  })

  it('lists nothing below a library block without its library, and skips archives that do not read', () => {
    expect(hmiPlcVariables(PROJECT).some((x) => x.path.startsWith('instance0.Main.T1.'))).toBe(false)
    expect(hmiLibraryBlocks([{ name: 'bad', archiveJson: 'not json' }]).size).toBe(0)
  })

  it('reads library pins from loaded archives as the device build has them', () => {
    const loaded: unknown = JSON.parse(ARCHIVE_JSON)
    const blocks = hmiLibraryBlocksOfArchives([loaded, null, { manifest: 'none' }, { manifest: { functionBlocks: 3 } }])
    expect(blocks.get('TON')).toEqual(LIBRARY.get('TON'))
    expect(hmiPlcVariables(PROJECT, blocks).map((x) => x.path)).toContain('instance0.Main.T1.PT')
  })

  it('builds a screen bound to each kind and resolves every tag in the compiled program debug map', () => {
    const strucpp = loadStrucpp()
    const library = strucpp.loadStlibFromString(ARCHIVE_JSON, 'iec-standard-fb')
    const plc = strucpp.compile(DECLARATIONS, { libraries: [library], debug: true })
    expect(plc.errors).toEqual([])
    const resolve = hmiTagResolver(JSON.stringify(plc.debugMap), [{ name: 'instance0', program: 'Main' }])
    const screen = [
      'FUNCTION_BLOCK Overview EXTENDS HmiScreen',
      '  VAR',
      '    Body : HmiHorizontalStack;',
      "    Done : HmiLamp := (Parent := 'Body');",
      "    Deep : HmiLamp := (Parent := 'Body');",
      "    Gx : HmiValue := (Parent := 'Body');",
      "    Item : HmiSlider := (Parent := 'Body');",
      "    Pin : HmiSlider := (Parent := 'Body');",
      "    Cell : HmiSlider := (Parent := 'Body');",
      '  END_VAR',
      '  Done.Value := instance0.Main.T1.Q;',
      '  Deep.Value := instance0.Main.P.Inner.Z;',
      '  Gx.Value := G.X;',
      '  Item.Value := instance0.Main.Arr[3];',
      '  Pin.Value := instance0.Main.F.A;',
      '  Cell.Value := instance0.Main.M[2,1];',
      'END_FUNCTION_BLOCK',
      '',
    ].join('\n')
    const result = generateHmiUnit({
      screens: [{ name: 'Overview', source: screen }],
      widgets: [],
      widgetLibraries: installedWidgetArchives(),
      settings: hmiSettingsSchema.parse({}),
      plcVariables: variables,
      plcDeclarations: DECLARATIONS,
      plcLibraries: [{ name: 'iec-standard-fb', archiveJson: ARCHIVE_JSON }],
      projectNames: ['Main', 'MyFb', 'Pt', 'Sub'],
      resolve,
    })
    expect(result.errors).toEqual([])
    expect(result.tags.map((t) => t.path).sort()).toEqual([
      'CONFIG0.G.X',
      'CONFIG0.RES0.INSTANCE0.MAIN.ARR[3]',
      'CONFIG0.RES0.INSTANCE0.MAIN.F.A',
      'CONFIG0.RES0.INSTANCE0.MAIN.M[2,1]',
      'CONFIG0.RES0.INSTANCE0.MAIN.P.INNER.Z',
      'CONFIG0.RES0.INSTANCE0.MAIN.T1.Q',
    ])
    for (const tag of result.tags) expect(tag.address).not.toBeNull()
    const overview = result.sources['Overview.st'] ?? ''
    expect(overview).toContain('IF Item.Changed AND Item.NewValue = Item.NewValue THEN instance0.Main.Arr[3] :=')
    expect(overview).toContain('IF Pin.Changed AND Pin.NewValue = Pin.NewValue THEN instance0.Main.F.A :=')
    expect(overview).toContain('IF Cell.Changed THEN instance0.Main.M[2,1] := Cell.NewValue; END_IF;')
  })

  it('refuses a write-back to a constant struct field', () => {
    const result = generateHmiUnit({
      screens: [
        {
          name: 'Overview',
          source:
            "FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Body : HmiHorizontalStack;\n    S : HmiSlider := (Parent := 'Body');\n  END_VAR\n  S.Value := G.X;\nEND_FUNCTION_BLOCK\n",
        },
      ],
      widgets: [],
      widgetLibraries: installedWidgetArchives(),
      settings: hmiSettingsSchema.parse({}),
      plcVariables: variables,
      plcDeclarations: DECLARATIONS,
      plcLibraries: [{ name: 'iec-standard-fb', archiveJson: ARCHIVE_JSON }],
      projectNames: ['Main', 'MyFb', 'Pt', 'Sub'],
      preview: true,
    })
    expect(result.errors.map((e) => e.message)).toEqual(['S.Value: G.X is a CONSTANT; the operator cannot change it'])
  })

  /** The preview build of a screen whose body binds `body`, its elements in a stack. */
  const preview = (elements: string[], body: string[]) =>
    generateHmiUnit({
      screens: [
        {
          name: 'Overview',
          source: [
            'FUNCTION_BLOCK Overview EXTENDS HmiScreen',
            '  VAR',
            '    Body : HmiHorizontalStack;',
            ...elements.map((e) => `    ${e} := (Parent := 'Body');`),
            '  END_VAR',
            ...body.map((b) => `  ${b}`),
            'END_FUNCTION_BLOCK',
            '',
          ].join('\n'),
        },
      ],
      widgets: [],
      widgetLibraries: installedWidgetArchives(),
      settings: hmiSettingsSchema.parse({}),
      plcVariables: variables,
      plcDeclarations: DECLARATIONS,
      plcLibraries: [{ name: 'iec-standard-fb', archiveJson: ARCHIVE_JSON }],
      projectNames: ['Main', 'MyFb', 'Pt', 'Sub'],
      preview: true,
    })
  const messages = (result: ReturnType<typeof generateHmiUnit>) => result.errors.map((e) => e.message)

  it('refuses a two-way widget on a variable past the listed elements, and builds a one-way one', () => {
    expect(messages(preview(['S : HmiSlider'], ['S.Value := instance0.Main.Big[40];']))).toEqual([
      "S.Value: instance0.Main.Big[40] is not in the HMI's variable list (arrays list their first 32 elements, and only arrays with literal bounds); a two-way widget cannot write it",
    ])
    expect(messages(preview(['L : HmiLamp'], ['L.Value := instance0.Main.Flags[40];']))).toEqual([])
  })

  it('refuses a two-way widget on a function block output, and writes a block input', () => {
    expect(
      messages(
        preview(
          ['A : HmiSwitch', 'Q : HmiSwitch', 'In : HmiSwitch'],
          ['A.Value := instance0.Main.F.B;', 'Q.Value := instance0.Main.T1.Q;', 'In.Value := instance0.Main.T1.IN;'],
        ),
      ),
    ).toEqual([
      'A.Value: instance0.Main.F.B is an output of a function block; a two-way widget cannot write it',
      'Q.Value: instance0.Main.T1.Q is an output of a function block; a two-way widget cannot write it',
    ])
    expect(messages(preview(['L : HmiLamp'], ['L.Value := instance0.Main.F.B;']))).toEqual([])
  })

  it('marks block outputs and what is below them, and configuration globals', () => {
    const of = (path: string) => variables.find((x) => x.path === path)
    expect(of('instance0.Main.F.B')?.blockOutput).toBe(true)
    expect(of('instance0.Main.T1.ET')?.blockOutput).toBe(true)
    expect(of('instance0.Main.T1.IN')?.blockOutput).toBeUndefined()
    expect(of('instance0.Main.F.A')?.blockOutput).toBeUndefined()
    expect(of('G.Inner.Z')?.scope).toBe('global')
    expect(of('instance0.Main.P.X')?.scope).toBeUndefined()
  })

  it('names the two stacks in place of an HmiStack declared in a widget block', () => {
    const result = generateHmiUnit({
      ...sampleBase(),
      widgets: [
        {
          name: 'Panel',
          source:
            'FUNCTION_BLOCK Panel EXTENDS HmiElement\n  VAR\n    Box : HmiStack;\n  END_VAR\nEND_FUNCTION_BLOCK\n',
        },
      ],
    })
    expect(result.errors.map((e) => `${e.file}: ${e.message}`)).toEqual([
      'Panel: Box: HmiStack is the base of the stacks; declare Box as HmiVerticalStack (children side by side) or HmiHorizontalStack (children top to bottom), without Direction',
    ])
  })
})

/** A buildable project with one stacked screen and no PLC program, for widget block checks. */
function sampleBase() {
  return {
    screens: [
      {
        name: 'Overview',
        source:
          'FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Body : HmiHorizontalStack;\n  END_VAR\nEND_FUNCTION_BLOCK\n',
      },
    ],
    widgets: [],
    widgetLibraries: installedWidgetArchives(),
    settings: hmiSettingsSchema.parse({}),
    plcVariables: [],
    projectNames: [],
    preview: true,
  }
}
