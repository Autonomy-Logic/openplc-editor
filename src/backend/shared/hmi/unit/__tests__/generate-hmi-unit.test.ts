import { hmiSettingsSchema } from '../../../../../middleware/shared/utils/hmi/settings'
import { generateHmiUnit, type HmiUnitInput, type HmiUnitResult } from '../generate-hmi-unit'
import { DETAILS, OVERVIEW, sampleProject } from './fixtures/sample-project'

function messages(result: HmiUnitResult): string[] {
  return result.errors.map((e) => `${e.file}${e.line === undefined ? '' : `:${e.line}`}: ${e.message}`)
}

/** The sample project with one screen replaced. */
function withScreen(source: string, extra: Partial<HmiUnitInput> = {}): HmiUnitInput {
  const project = sampleProject()
  return { ...project, screens: [{ name: 'Overview', source }, project.screens[1]], ...extra }
}

const screen = (vars: string, body = ''): string =>
  `FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n${vars}\n  END_VAR\n${body}\nEND_FUNCTION_BLOCK\n`

describe('HMI unit generator', () => {
  let sample: HmiUnitResult
  beforeAll(() => {
    sample = generateHmiUnit(sampleProject())
  })

  it('compiles the sample project into a unit with its glue', () => {
    expect(messages(sample)).toEqual([])
    expect(sample.ok).toBe(true)
    expect(Object.keys(sample.files)).toEqual(
      expect.arrayContaining(['hmi_unit.hpp', 'hmi_unit_libraries.hpp', 'hmi_unit_glue.cpp', 'pou_OVERVIEW.cpp']),
    )
    expect(sample.files['hmi_unit.hpp']).toContain('namespace hmi {')
    expect(sample.fonts).toEqual({ variant: 'compact', faces: [0, 1] })
  })

  it('mirrors the PLC variables screens use, with their debug addresses, and warns about unresolved ones', () => {
    expect(sample.tags).toEqual([
      { path: 'Main.Level', type: 14, maxLength: 0, address: { arr: 0, elem: 3 } },
      { path: 'Main.Running', type: 1, maxLength: 0, address: { arr: 0, elem: 4 } },
      { path: 'Main.Speed', type: 3, maxLength: 0, address: { arr: 0, elem: 5 } },
      { path: 'Main.Tag', type: 16, maxLength: 12, address: { arr: 1, elem: 0 } },
    ])
    expect(sample.warnings).toEqual([
      { file: 'HMI', message: "GVL.Alarm is not in the PLC program's debug map; the HMI will not sync it" },
    ])
    expect(sample.sources['hmi_tags.st']).toContain('TYPE HMI__PLC_GVL :')
    expect(sample.files['hmi_unit_glue.cpp']).toContain('{1u, 0u, 16, 12, "Main.Tag"},')
    expect(sample.files['hmi_unit_glue.cpp']).not.toContain('GVL.Alarm')
    expect(sample.files['hmi_unit_glue.cpp']).toContain('const char hmi_panel_pin[] = "2468";')
  })

  it('keeps every tag without a PLC program, for previews', () => {
    const preview = generateHmiUnit({ ...sampleProject(), resolve: undefined, plcMd5: undefined })
    expect(preview.warnings).toEqual([])
    expect(preview.tags.map((t) => [t.path, t.address])).toEqual([
      ['Main.Level', null],
      ['Main.Running', null],
      ['Main.Speed', null],
      ['Main.Tag', null],
      ['GVL.Alarm', null],
    ])
    expect(preview.files['hmi_unit_glue.cpp']).toContain('const char hmi_plc_md5[] = "";')
  })

  it('adds Build and WriteBack on the line where the declarations end, so lines keep their numbers', () => {
    const overview = sample.sources['Overview.st']
    expect(overview.split('\n')).toHaveLength(OVERVIEW.split('\n').length)
    const line = overview.split('\n').find((l) => l.includes('METHOD PROTECTED OVERRIDE Build'))
    expect(line?.trimStart().startsWith('END_VAR')).toBe(true)
    expect(line).toContain(
      'UseTheme(5); Attach(ADR(Col), 0); Attach(ADR(Level), ADR(Col)); Attach(ADR(Run), ADR(Col)); Attach(ADR(Speed), 0);',
    )
    expect(line).toContain('IF Run.Changed THEN Main.Running := Run.NewValue; END_IF;')
    expect(line).toContain('IF Speed.Changed THEN Main.Speed := REAL_TO_INT(Speed.NewValue); END_IF;')
    expect(line).toContain('IF Name.Changed THEN Main.Tag := Name.NewValue; END_IF;')
    expect(sample.elementIds.slice(0, 3)).toEqual([
      { id: 1, screen: 'Overview', element: 'Col' },
      { id: 2, screen: 'Overview', element: 'Level' },
      { id: 3, screen: 'Overview', element: 'Run' },
    ])
    expect(sample.elementIds.at(-1)).toEqual({ id: 9, screen: 'Details', element: 'Shown' })
  })

  it('generates navigation by name, theme ids and the role grid', () => {
    expect(sample.sources['hmi_glue.st']).toContain('TYPE HMI_SCREEN : (Overview := 0, Details := 1); END_TYPE')
    expect(sample.sources['hmi_glue.st']).toContain('HMI_THEME_Brand : DINT := 5;')
    const main = sample.sources['hmi_main.st']
    expect(main).toContain('Rt.CopyTheme(5, 1);')
    expect(main).toContain('Rt.SetThemeColor(5, 7, 16#7C3AED);')
    expect(main).toContain('Rt.SetStart(0);')
    expect(main).toContain('TASK HmiTask(INTERVAL := T#50ms, PRIORITY := 1);')
    const operator = main.slice(main.indexOf('      2:'), main.indexOf('      3:'))
    expect(operator).toContain('Rt.SetAccess(0, TRUE);')
    expect(operator).toContain('Rt.SetAccess(1, FALSE);')
    const unknown = main.slice(main.indexOf('    ELSE'), main.indexOf('    END_CASE;'))
    expect(unknown).toContain('Rt.SetAccess(0, FALSE);')
  })

  it('gives the preview its translation units and the live setters of literal properties', () => {
    expect(sample.preview.units).toEqual({
      library: ['lib_standard_widgets.cpp'],
      widgets: ['lib_project_widgets.cpp'],
      screens: { Overview: ['pou_OVERVIEW.cpp'], Details: ['pou_DETAILS.cpp'] },
      glue: expect.arrayContaining(['configuration.cpp', 'pou_HMIMAIN.cpp', 'hmi_unit_glue.cpp']),
    })
    const { setters } = sample.preview
    expect(setters['Overview.Level.MaxValue']).toEqual({ screen: 0, index: expect.any(Number), kind: 'num' })
    expect(setters['Overview.Next.Text']).toMatchObject({ screen: 0, kind: 'str' })
    expect(setters['Overview.Run.OnColor']).toMatchObject({ kind: 'num' })
    expect(setters['Details.Shown.Visible']).toMatchObject({ screen: 1, kind: 'num' })
    expect(setters['Overview.Level.Parent']).toBeUndefined()
    expect(setters['Overview.Level.Floating']).toBeUndefined()
    expect(setters['Overview.Col.Direction']).toBeUndefined()
    const indices = Object.values(setters)
      .filter((x) => x.screen === 0 && x.kind === 'num')
      .map((x) => x.index)
    expect(new Set(indices).size).toBe(indices.length)
    expect(Object.keys(sample.preview.files)).toEqual(['hmi_preview_0.cpp', 'hmi_preview_1.cpp', 'hmi_preview.cpp'])
    expect(sample.preview.files['hmi_preview.cpp']).toContain(
      'case 1: return hmi_preview_set_str_1(unit, setter, value);',
    )
  })

  it('refuses element names that are members of HmiScreen', () => {
    expect(messages(generateHmiUnit(withScreen(screen('    Layout : HmiLabel;\n    Root : HmiStack;'))))).toEqual([
      'Overview: Layout: an element may not be named like a member of HmiScreen',
      'Overview: Root: an element may not be named like a member of HmiScreen',
    ])
  })

  it('refuses names already taken, reused or not identifiers', () => {
    const project = sampleProject()
    const named = (name: string, kind: 'screens' | 'widgets' = 'screens'): string[] =>
      messages(generateHmiUnit({ ...project, [kind]: [...project[kind], { name, source: DETAILS }] }))
    expect(named('HmiButton')).toEqual(["HmiButton: Screen name 'HmiButton' is taken by the HMI library"])
    expect(named('HMI_SCREEN')).toEqual(["HMI_SCREEN: Screen name 'HMI_SCREEN' is taken by the HMI library"])
    expect(named('main')).toEqual(["main: Screen name 'main' is taken by a POU or data type"])
    expect(named('DETAILS')).toEqual(["DETAILS: Screen name 'DETAILS' is used twice"])
    expect(named('badge', 'widgets')).toEqual(["badge: Widget block name 'badge' is used twice"])
    expect(named('2nd')).toEqual(["2nd: Screen name '2nd' is not an identifier"])
    expect(messages(generateHmiUnit({ ...project, screens: [] }))).toEqual(['HMI: the project has no HMI screens'])
  })

  it('checks what each screen declares', () => {
    const wrongName = generateHmiUnit(withScreen(DETAILS))
    expect(messages(wrongName)).toEqual(
      expect.arrayContaining(['Overview: the file declares Details; it must declare FUNCTION_BLOCK Overview']),
    )
    expect(messages(generateHmiUnit(withScreen(OVERVIEW.replace('EXTENDS HmiScreen', ''))))).toEqual(
      expect.arrayContaining(['Overview: Overview must extend HmiScreen']),
    )
    expect(
      messages(
        generateHmiUnit(
          withScreen(screen('    L : HmiLabel;', '  METHOD PROTECTED OVERRIDE Build : BOOL Build := TRUE; END_METHOD')),
        ),
      ),
    ).toEqual(['Overview: the HMI build generates Build; remove it'])
    expect(
      messages(generateHmiUnit(withScreen(`{attribute 'hmi_theme' := 'Nope'}\n${screen('    L : HmiLabel;')}`))),
    ).toEqual(["Overview: unknown theme 'Nope'"])
    const settings = hmiSettingsSchema.parse({ ...sampleProject().settings, startScreen: 'Missing' })
    expect(messages(generateHmiUnit({ ...sampleProject(), settings }))).toEqual([
      "HMI: start screen 'Missing' is not a screen",
    ])
  })

  it('refuses PLC variables that do not exist or cannot be mirrored', () => {
    expect(messages(generateHmiUnit(withScreen(screen('    L : HmiLabel;', '  L.Visible := Main.Nope;'))))).toEqual([
      'Overview: MAIN.NOPE is not a PLC variable',
    ])
    const project = sampleProject()
    const odd = {
      ...project,
      plcVariables: [
        ...project.plcVariables,
        { path: 'Main.Buf', type: 'ARRAY[0..3] OF INT' },
        { path: 'Main.W', type: 'WSTRING' },
      ],
    }
    expect(
      messages(
        generateHmiUnit({
          ...odd,
          screens: withScreen(screen('    L : HmiLabel;', '  L.Visible := Main.Buf[0] > 0 OR Main.W = "";')).screens,
        }),
      ),
    ).toEqual([
      'Overview: Main.Buf: ARRAY[0..3] OF INT variables cannot be used on screens',
      'Overview: Main.W: WSTRING variables cannot be used on screens',
    ])
  })

  it('checks containers, parents and pipe ends', () => {
    expect(
      messages(
        generateHmiUnit(
          withScreen(
            screen(
              [
                "    A : HmiLabel := (Parent := 'Missing');",
                "    B : HmiLabel := (Parent := 'A');",
                '    C : HmiLabel := (Parent := Main.Tag);',
                "    S1 : HmiStack := (Parent := 'S2');",
                "    S2 : HmiStack := (Parent := 'S1');",
                "    P : HmiPipe := (Source := 'A', Target := 'Nowhere');",
              ].join('\n'),
            ),
          ),
        ),
      ),
    ).toEqual([
      "Overview: A: Parent 'Missing' is not an element of this screen",
      "Overview: B: Parent 'A' is not a container",
      'Overview: C: Parent must be a text literal naming a container',
      'Overview: S1: its Parent chain is a cycle',
      'Overview: S2: its Parent chain is a cycle',
      'Overview: P: Target must name an element of this screen',
    ])
    const labels = Array.from({ length: 65 }, (_, i) => `    L${i} : HmiLabel := (Parent := 'Col');`).join('\n')
    expect(messages(generateHmiUnit(withScreen(screen(`    Col : HmiStack;\n${labels}`))))).toEqual([
      'Overview: Col holds 65 elements; at most 64',
    ])
  })

  it('refuses a write-back the variable cannot take', () => {
    expect(messages(generateHmiUnit(withScreen(screen('    T : HmiTextInput;', '  T.Value := Main.Speed;'))))).toEqual([
      'Overview: T.Value: a STRING widget value cannot be written to Main.Speed (INT)',
    ])
  })

  it('reports compile errors in a screen at its own line, and widget blocks that are not widgets', () => {
    const broken = generateHmiUnit(withScreen(screen('    L : HmiLabel;', '  L.Size := Undeclared;')))
    expect(messages(broken)).toEqual(["Overview:5: Undeclared variable 'UNDECLARED'"])
    const project = sampleProject()
    const helper = generateHmiUnit({
      ...project,
      widgets: [
        ...project.widgets,
        { name: 'Helper', source: 'FUNCTION_BLOCK Helper VAR_INPUT X : INT; END_VAR END_FUNCTION_BLOCK' },
      ],
    })
    expect(messages(helper)).toEqual([
      'Helper: Helper must be a FUNCTION_BLOCK that extends HmiElement or another widget',
    ])
    const bad = generateHmiUnit({
      ...project,
      widgets: [
        { name: 'Badge', source: 'FUNCTION_BLOCK Badge EXTENDS HmiLamp\n  VAR x : Nope; END_VAR\nEND_FUNCTION_BLOCK' },
      ],
    })
    expect(messages(bad)).toEqual([expect.stringMatching(/^Badge:2: /)])
  })
})
