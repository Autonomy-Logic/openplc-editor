import { readFileSync } from 'fs'
import { join } from 'path'

import { NEW_SCREEN_STACK, newHmiScreenSource } from '../../../../../middleware/shared/utils/hmi/project-files'
import { hmiSettingsSchema } from '../../../../../middleware/shared/utils/hmi/settings'
import { hmiDebugPath } from '../../artefact/tag-resolver'
import {
  generateHmiUnit,
  HMI_GALLERY_SCREEN,
  HMI_THEME_PREVIEW_SCREEN,
  hmiGalleryWidget,
  type HmiUnitInput,
  type HmiUnitResult,
  numericWriteBack,
  WIDGET_PREVIEW_SCREEN,
} from '../generate-hmi-unit'
import { DETAILS, OVERVIEW, PLC_DECLARATIONS, sampleProject } from './fixtures/sample-project'

function messages(result: HmiUnitResult): string[] {
  return result.errors.map((e) => `${e.file}${e.line === undefined ? '' : `:${e.line}`}: ${e.message}`)
}

/** The sample project with one screen replaced. */
function withScreen(source: string, extra: Partial<HmiUnitInput> = {}): HmiUnitInput {
  const project = sampleProject()
  return { ...project, screens: [{ name: 'Overview', source }, project.screens[1]], ...extra }
}

/** Puts each declaration without a Parent in the screen's stack `Body`, containers excepted. */
const inBody = (vars: string): string =>
  vars
    .split('\n')
    .map((line) => {
      const m = /^(\s+\w+ : (\w+))(?: := \((.*)\))?;$/.exec(line)
      if (!m || /(Stack|Diagram)$/.test(m[2]) || /\bParent :=/.test(line)) return line
      return m[3] === undefined ? `${m[1]} := (Parent := 'Body');` : `${m[1]} := (Parent := 'Body', ${m[3]});`
    })
    .join('\n')

/** A screen Overview with a horizontal stack `Body` holding the declarations that have no Parent. */
const screen = (vars: string, body = ''): string =>
  `FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Body : HmiHorizontalStack;\n${inBody(vars)}\n  END_VAR\n${body}\nEND_FUNCTION_BLOCK\n`

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

  it('reads TIME, DATE, TOD and DT variables as 8-byte tags, by their long names too', () => {
    const project = sampleProject()
    project.plcDeclarations = PLC_DECLARATIONS.replace(
      '    Unused : DINT;',
      '    Unused : DINT;\n    Stamp : DATE_AND_TIME;\n    Shift : TIME_OF_DAY;\n    Cycle : TIME;\n    Day : DATE;',
    )
    project.plcVariables = [
      ...(project.plcVariables ?? []),
      { path: 'instance0.Main.Stamp', type: 'DATE_AND_TIME' },
      { path: 'instance0.Main.Shift', type: 'TIME_OF_DAY' },
      { path: 'instance0.Main.Cycle', type: 'TIME' },
      { path: 'instance0.Main.Day', type: 'DATE' },
    ]
    const addresses: Record<string, { arr: number; elem: number }> = {
      'INSTANCE0.STAMP': { arr: 3, elem: 0 },
      'INSTANCE0.SHIFT': { arr: 3, elem: 1 },
      'INSTANCE0.CYCLE': { arr: 3, elem: 2 },
      'INSTANCE0.DAY': { arr: 3, elem: 3 },
    }
    project.resolve = (path) => addresses[hmiDebugPath(path, [{ name: 'instance0', program: 'Main' }])] ?? null
    project.screens = [
      {
        name: 'Overview',
        source: screen(
          '    Face : HmiClock;\n    Stamp : HmiDateTime;\n    T : TOD;\n    C : TIME;\n    D : DATE;',
          '  Face.Value := instance0.Main.Stamp;\n  Stamp.Value := instance0.Main.Stamp;\n  T := instance0.Main.Shift;\n' +
            '  C := instance0.Main.Cycle;\n  D := instance0.Main.Day;',
        ),
      },
    ]
    project.settings = hmiSettingsSchema.parse({ startScreen: 'Overview' })

    const result = generateHmiUnit(project)

    expect(messages(result)).toEqual([])
    expect(result.tags.map(({ path, type, maxLength }) => [path, type, maxLength])).toEqual([
      ['CONFIG0.RES0.INSTANCE0.MAIN.STAMP', 21, 0],
      ['CONFIG0.RES0.INSTANCE0.MAIN.SHIFT', 20, 0],
      ['CONFIG0.RES0.INSTANCE0.MAIN.CYCLE', 17, 0],
      ['CONFIG0.RES0.INSTANCE0.MAIN.DAY', 19, 0],
    ])
    const glue = result.files['hmi_unit_glue.cpp']
    expect(glue).toContain('strucpp::IEC_DT g_own_0{};')
    expect(glue).toContain('strucpp::IEC_TOD g_own_1{};')
    expect(glue).toContain('    case 0: return 8;')
    expect(glue).toContain('constexpr size_t kTagBufferSize = 8;')
  })

  it('reads the PLC variables screens use through the host, listed with their debug addresses', () => {
    expect(sample.tags).toEqual([
      { path: 'CONFIG0.RES0.INSTANCE0.MAIN.LEVEL', type: 14, maxLength: 0, address: { arr: 0, elem: 3 } },
      { path: 'CONFIG0.RES0.INSTANCE0.MAIN.RUNNING', type: 1, maxLength: 0, address: { arr: 0, elem: 4 } },
      { path: 'CONFIG0.RES0.INSTANCE0.MAIN.SPEED', type: 3, maxLength: 0, address: { arr: 0, elem: 5 } },
      { path: 'CONFIG0.RES0.INSTANCE0.MAIN.TAG', type: 16, maxLength: 12, address: { arr: 1, elem: 0 } },
      { path: 'CONFIG0.ALARMON', type: 1, maxLength: 0, address: { arr: 2, elem: 0 } },
    ])
    expect(sample.warnings).toEqual([])
    const glue = sample.files['hmi_unit_glue.cpp']
    expect(glue).toContain('{1u, 0u, 16, 12, "CONFIG0.RES0.INSTANCE0.MAIN.TAG"},')
    expect(glue).toContain('void *external_variable(uint32_t id) { return tag_variable(id); }')
    expect(glue).toContain('constexpr size_t kTagBufferSize = 13;')
    expect(glue).toContain(
      '    if (g_access->read(g_access->ctx, static_cast<int>(id), buf)) hmi_tag_write(static_cast<int>(id), g_read[id], buf);',
    )
    expect(glue).toContain('    if (!g_access) return g_own[id];')
    expect(glue).toContain('    g_access = access && access->read && access->write ? access : nullptr;')
    expect(glue).toContain('    return g_read[id];')
    expect(glue).toContain(
      '        if (hmi_tag_read(static_cast<int>(id), value, buf) == 0) g_access->write(g_access->ctx, static_cast<int>(id), buf);',
    )
    expect(glue).not.toContain('g_access->variable')
    expect(glue).toContain('bool hmi_unit_frame(void *unit) {')
    expect(glue).toContain('#if STRUCPP_HAS_EXCEPTIONS')
    expect(glue).toContain('#include "iec_fault.hpp"')
    expect(glue).toMatch(
      /try \{\s+static_cast<HmiUnit \*>\(unit\)->program\.run\(\);\s+\} catch \(\.\.\.\) \{\s+return false;/,
    )
    expect(glue).toContain(
      '    case 0: *static_cast<strucpp::IEC_REAL *>(g_own[0]) = *static_cast<const strucpp::IEC_REAL *>(value); return;',
    )
    expect(glue).not.toMatch(/hmi_panel_pin|hmi_relock_minutes|hmi_touch_cal_mode|hmi_build_id|2468/)
    expect(glue).toContain('while (n < 12 && b[n] != 0) n++;')
    expect(Object.keys(sample.sources)).not.toContain('hmi_tags.st')
    expect(sample.files['pou_OVERVIEW.cpp']).toContain('strucpp::external_read<IEC_REAL>(0)')
  })

  it('carries the panel PIN, relock time, calibration mode and build id only in a build for a local panel', () => {
    const panel = generateHmiUnit({ ...sampleProject(), panel: true })
    const glue = panel.files['hmi_unit_glue.cpp']
    expect(glue).toContain('const char hmi_panel_pin[] = "2468";')
    expect(glue).toContain('const uint32_t hmi_relock_minutes = 5;')
    expect(glue).toContain('const uint8_t hmi_touch_cal_mode = ')
    expect(glue).toMatch(/const char hmi_build_id\[\] = "[0-9a-f]{16}";/)
    const project = sampleProject()
    const browser = generateHmiUnit(project)
    const everything = [...Object.values(browser.files), ...Object.values(browser.sources)].join('\n')
    expect(everything).not.toMatch(/hmi_panel_pin|hmi_relock_minutes|hmi_touch_cal_mode|hmi_build_id/)
    expect(everything).not.toContain(project.settings.pin.value)
  })

  it('starts the variables from their literal initial values in a preview, and never in a product build', () => {
    const project = sampleProject()
    const initial: Record<string, string> = {
      'instance0.Main.Level': '12.5',
      'instance0.Main.Running': 'TRUE',
      'instance0.Main.Speed': 'INT#7',
      'instance0.Main.Tag': "'Pump $'A$''",
      AlarmOn: 'Limit > 3',
    }
    const plcVariables = project.plcVariables.map((v) => ({ ...v, initialValue: initial[v.path] }))
    const preview = generateHmiUnit({ ...project, plcVariables, preview: true, resolve: undefined })
    expect(messages(preview)).toEqual([])
    const main = preview.sources['hmi_main.st']
    expect(main).toContain('    instance0.Main.Level := 12.5;')
    expect(main).toContain('    instance0.Main.Running := TRUE;')
    expect(main).toContain('    instance0.Main.Speed := INT#7;')
    expect(main).toContain("    instance0.Main.Tag := 'Pump $'A$'';")
    expect(main).not.toContain('AlarmOn :=')
    expect(generateHmiUnit({ ...project, plcVariables }).sources['hmi_main.st']).not.toContain(
      'instance0.Main.Level :=',
    )
  })

  it('never lets an initial value break out of its start statement', () => {
    const project = sampleProject()
    for (const initialValue of ['0; END_IF; HMI_Show(0)', "'a'; b := 1", "'open", 'MAX_LEVEL', '1 + 2']) {
      const result = generateHmiUnit({
        ...project,
        preview: true,
        resolve: undefined,
        plcVariables: project.plcVariables.map((v) => (v.path === 'instance0.Main.Speed' ? { ...v, initialValue } : v)),
      })
      expect(result.sources['hmi_main.st']).not.toContain('instance0.Main.Speed :=')
    }
  })

  it("sets a type's own default on elements that leave it out, before attaching them", () => {
    const result = generateHmiUnit(sampleProject())
    expect(messages(result)).toEqual([])
    const overview = result.sources['Overview.st']
    const build = /METHOD PROTECTED OVERRIDE Build : BOOL(.*?)END_METHOD/s.exec(overview)?.[1] ?? ''
    expect(build).toContain('Body.GrowAuto := TRUE;')
    expect(build).toContain('Col.GrowAuto := TRUE;')
    expect(build).not.toContain('Level.GrowAuto')
    expect(build.indexOf('Col.GrowAuto')).toBeLessThan(build.indexOf('Attach('))
    const gallery = generateHmiUnit({ ...sampleProject(), gallery: true, resolve: undefined })
    const source = Object.values(gallery.sources).find((t) => t.includes(`FUNCTION_BLOCK ${HMI_GALLERY_SCREEN}`))
    expect(source).not.toContain('HMI__Column.GrowAuto')
  })

  it('previews a widget block on an extra screen, at natural size and stretched, with a test value', () => {
    const project = sampleProject()
    const result = generateHmiUnit({ ...project, screens: [], widgetPreview: 'badge', resolve: undefined })
    expect(messages(result)).toEqual([])
    const source =
      result.sources[`${WIDGET_PREVIEW_SCREEN}.st`] ??
      Object.values(result.sources).find((t) => t.includes(WIDGET_PREVIEW_SCREEN))
    expect(source).toContain("Natural : Badge := (Parent := 'HMI__Row', GrowAuto := FALSE);")
    expect(source).toContain("Stretched : Badge := (Parent := 'HMI__Column', GrowAuto := TRUE);")
    expect(source).toContain('Natural.Value := TRUE;')
    expect(result.preview.units.screens[WIDGET_PREVIEW_SCREEN]).toBeDefined()
    expect(generateHmiUnit(project).sources).not.toHaveProperty([`${WIDGET_PREVIEW_SCREEN}.st`])
  })

  it('draws every palette widget and widget block alone on the gallery screen, in place of the project screens', () => {
    const project = sampleProject()
    const result = generateHmiUnit({ ...project, gallery: true, resolve: undefined })
    expect(messages(result)).toEqual([])
    const shown = result.elementIds.flatMap((e) => {
      const widget = hmiGalleryWidget(e.element)
      return widget === null ? [] : [widget]
    })
    expect(shown).toEqual(expect.arrayContaining(['HmiLamp', 'HmiTank', 'HmiButton', 'Badge']))
    expect(shown.some((w) => /^Hmi(Stack|Diagram|Pipe)$/.test(w))).toBe(false)
    expect(new Set(result.elementIds.map((e) => e.screen))).toEqual(new Set([HMI_GALLERY_SCREEN]))
    const source = Object.values(result.sources).find((t) => t.includes(`FUNCTION_BLOCK ${HMI_GALLERY_SCREEN}`))
    expect(source).toContain("W_HmiLamp : HmiLamp := (Parent := 'HMI__R_HmiLamp', GrowAuto := FALSE);")
    expect(source).toContain('W_HmiLamp.Value := TRUE;')
    expect(source).toContain('W_HmiGauge.Value := 60.0;')
    expect(source).toContain('W_HmiSelector.Value := 1;')
    expect(hmiGalleryWidget('HMI__Column')).toBeNull()
  })

  it('draws a sample screen in a theme, in place of the project screens, and refuses an unknown theme', () => {
    const project = sampleProject()
    const settings = {
      ...project.settings,
      themes: [{ name: 'Brand', base: 'Autonomy' as const, colors: { Accent: '#E91E63' } }],
    }
    const result = generateHmiUnit({ ...project, settings, themePreview: 'Brand', resolve: undefined })
    expect(messages(result)).toEqual([])
    expect(new Set(result.elementIds.map((e) => e.screen))).toEqual(new Set([HMI_THEME_PREVIEW_SCREEN]))
    const source = Object.values(result.sources).find((t) => t.includes(`FUNCTION_BLOCK ${HMI_THEME_PREVIEW_SCREEN}`))
    expect(source).toContain('HMI__Red : HmiRect')
    const unknown = generateHmiUnit({ ...project, themePreview: 'Nope', resolve: undefined })
    expect(messages(unknown).join('\n')).toMatch(/unknown theme 'Nope'/)
  })

  it('lists the tags each screen reads and writes, and the roles that may open it, for the runtime host', () => {
    expect(sample.pages).toEqual([
      { name: 'Overview', reads: [0, 1, 2, 3, 4], writes: [1, 2, 3], roles: 0b1111 },
      { name: 'Details', reads: [3], writes: [], roles: 0b0011 },
    ])
    expect(sample.tags.map((t) => t.path)).toEqual([
      'CONFIG0.RES0.INSTANCE0.MAIN.LEVEL',
      'CONFIG0.RES0.INSTANCE0.MAIN.RUNNING',
      'CONFIG0.RES0.INSTANCE0.MAIN.SPEED',
      'CONFIG0.RES0.INSTANCE0.MAIN.TAG',
      'CONFIG0.ALARMON',
    ])
  })

  it('counts a plain assignment as a write, a bit assignment as a read and a write, and conditions as reads', () => {
    const result = generateHmiUnit(
      withScreen(
        screen(
          '    Go : HmiButton;',
          [
            '  IF Go.Clicked AND instance0.Main.Running THEN',
            '    instance0.Main.Speed := 3;',
            '    instance0.Main.Unused.2 := TRUE;',
            '  END_IF;',
          ].join('\n'),
        ),
      ),
    )
    expect(messages(result)).toEqual([])
    const index = (name: string) => result.tags.findIndex((t) => t.path.endsWith(`.${name}`))
    const [overview] = result.pages
    expect(overview.writes).toEqual([index('SPEED'), index('UNUSED')].sort((a, b) => a - b))
    expect(overview.reads).toEqual([index('RUNNING'), index('UNUSED')].sort((a, b) => a - b))
    expect(result.pages[1].writes).toEqual([])
  })

  it('keeps an operator change on a two-way widget that nothing else sets', () => {
    const result = generateHmiUnit(
      withScreen(
        screen(
          ['    Free : HmiSlider;', '    Wired : HmiSlider;', '    Scaled : HmiSlider;', '    Note : HmiSwitch;'].join(
            '\n',
          ),
          '  Wired.Value := instance0.Main.Level;\n  Scaled.Value := instance0.Main.Level * 2.0;\n  (* Note.Value := TRUE; *)',
        ),
      ),
    )
    expect(messages(result)).toEqual([])
    const overview = Object.values(result.sources).find((t) => t.includes('FUNCTION_BLOCK Overview')) ?? ''
    expect(overview).toContain('IF Free.Changed THEN Free.Value := Free.NewValue; END_IF;')
    expect(overview).toContain('IF Note.Changed THEN Note.Value := Note.NewValue; END_IF;')
    expect(overview).not.toContain('Wired.Value := Wired.NewValue')
    expect(overview).not.toContain('Scaled.Value := Scaled.NewValue')
  })

  it('refuses to preview a widget block the project does not have', () => {
    const result = generateHmiUnit({ ...sampleProject(), widgetPreview: 'HmiLamp' })
    expect(messages(result)).toEqual(['HMI: HmiLamp is not a widget block of the project'])
  })

  it('refuses a tag the PLC program does not have, so the host never serves it from another address', () => {
    const project = sampleProject()
    const result = generateHmiUnit({
      ...project,
      resolve: (path) => (path.toUpperCase() === 'CONFIG0.ALARMON' ? null : (project.resolve?.(path) ?? null)),
    })
    expect(result.ok).toBe(false)
    expect(messages(result)).toEqual([
      'HMI: AlarmOn has no debug address in the compiled PLC program, so the HMI cannot reach it',
    ])
    expect(result.files['hmi_unit_glue.cpp']).toBeUndefined()
  })

  it('keeps every tag without a PLC program, for previews', () => {
    const preview = generateHmiUnit({ ...sampleProject(), resolve: undefined, plcMd5: undefined })
    expect(preview.warnings).toEqual([])
    expect(preview.tags.map((t) => [t.path, t.address])).toEqual([
      ['CONFIG0.RES0.INSTANCE0.MAIN.LEVEL', null],
      ['CONFIG0.RES0.INSTANCE0.MAIN.RUNNING', null],
      ['CONFIG0.RES0.INSTANCE0.MAIN.SPEED', null],
      ['CONFIG0.RES0.INSTANCE0.MAIN.TAG', null],
      ['CONFIG0.ALARMON', null],
    ])
    expect(preview.files['hmi_unit_glue.cpp']).toContain('const char hmi_plc_md5[] = "";')
  })

  it('adds Build and WriteBack on the line where the declarations end, so lines keep their numbers', () => {
    const overview = sample.sources['Overview.st']
    expect(overview.split('\n')).toHaveLength(OVERVIEW.split('\n').length)
    const line = overview.split('\n').find((l) => l.includes('METHOD PROTECTED OVERRIDE Build'))
    expect(line?.trimStart().startsWith('END_VAR')).toBe(true)
    expect(line).toContain(
      'UseTheme(5); Body.GrowAuto := TRUE; Col.GrowAuto := TRUE; Attach(ADR(Body), 0); Attach(ADR(Col), ADR(Body)); Attach(ADR(Level), ADR(Col)); ' +
        'Attach(ADR(Run), ADR(Col)); Attach(ADR(Speed), ADR(Body));',
    )
    expect(line).toContain('IF Run.Changed THEN instance0.Main.Running := Run.NewValue; END_IF;')
    expect(line).toContain(
      'IF Speed.Changed AND Speed.NewValue = Speed.NewValue THEN instance0.Main.Speed := REAL_TO_INT(LIMIT(-32768.0, Speed.NewValue, 32767.0)); END_IF;',
    )
    expect(line).toContain('IF Name.Changed THEN instance0.Main.Tag := Name.NewValue; END_IF;')
    expect(sample.elementIds.slice(0, 3)).toEqual([
      { id: 1, screen: 'Overview', element: 'Body' },
      { id: 2, screen: 'Overview', element: 'Col' },
      { id: 3, screen: 'Overview', element: 'Level' },
    ])
    expect(sample.elementIds.at(-1)).toEqual({ id: 12, screen: 'Details', element: 'Shown' })
  })

  it('generates navigation by name, theme ids and the role grid', () => {
    expect(sample.sources['hmi_glue.st']).toContain('TYPE HMI_SCREEN : (Overview := 0, Details := 1); END_TYPE')
    expect(sample.sources['hmi_glue.st']).toContain('HMI_THEME_Brand : DINT := 5;')
    const main = sample.sources['hmi_main.st']
    expect(main).toContain('Rt.CopyTheme(5, 1);')
    expect(main).toContain('Rt.SetThemeColor(5, 7, 16#7C3AED);')
    expect(main).toContain('Rt.SetStart(0);')
    expect(main).toContain('TASK HmiTask(INTERVAL := T#50ms, PRIORITY := 1);')
    expect(main).toContain('  HMI__Page := Rt.CurrentPage();\n  Want := Rt.Wanted();')
    expect(main).toContain('    Rt.Mount(Want, HMI__ScreenOpen(Slot, Want, Was));')
    expect(main).toContain(
      '  HMI__Page := Rt.BeginFrame();\n  IF HMI__Page >= 0 THEN\n    HMI__ScreenBody(Slot, HMI__Page);',
    )
    const operator = main.slice(main.indexOf('      2:'), main.indexOf('      3:'))
    expect(operator).toContain('Rt.SetAccess(0, TRUE);')
    expect(operator).toContain('Rt.SetAccess(1, FALSE);')
    const unknown = main.slice(main.indexOf('    ELSE'), main.indexOf('    END_CASE;'))
    expect(unknown).toContain('Rt.SetAccess(0, FALSE);')
  })

  it('builds only the shown screen, in a slot of each program instance, with the ids it would have had', () => {
    const main = sample.sources['hmi_main.st']
    const firstOf = (screen: string) =>
      Math.min(...sample.elementIds.filter((e) => e.screen === screen).map((e) => e.id))
    expect(main).toContain(`    Rt.AddPage(${firstOf('Overview')});\n    Rt.AddPage(${firstOf('Details')});`)
    expect(main).not.toMatch(/Scr\d+ :/)
    const slot = sample.files['hmi_unit_slot.hpp']
    expect(slot).toContain('std::max<std::size_t>({1, sizeof(hmi::OVERVIEW), sizeof(hmi::DETAILS)})')
    expect(slot).toMatch(
      /struct HmiUnit \{\s+hmi::Program_HMIMAIN program;\s+alignas\(kHmiSlotAlign\) unsigned char slot\[kHmiSlotSize\];/,
    )
    const glue = sample.files['hmi_unit_glue.cpp']
    expect(glue).toContain('case 0: static_cast<OVERVIEW *>(at)->~OVERVIEW(); break;')
    expect(glue).toContain('case 1: return new (at) DETAILS();')
    expect(glue).toContain('size_t hmi_unit_size(void) { return sizeof(HmiUnit); }')
    expect(glue).toContain('u->program.SLOT.set(static_cast<uint64_t>(reinterpret_cast<std::uintptr_t>(u->slot)));')
    expect(sample.preview.files['hmi_preview_1.cpp']).toContain(
      'if (u->program.RT.MOUNTED().get() != 1) return nullptr;',
    )
  })

  it('gives the preview its translation units and the live setters of literal properties', () => {
    expect(sample.preview.units).toEqual({
      library: ['lib_standard_widgets.cpp'],
      widgets: ['lib_project_widgets.cpp'],
      screens: {
        Overview: ['pou_OVERVIEW.cpp', 'hmi_preview_0.cpp'],
        Details: ['pou_DETAILS.cpp', 'hmi_preview_1.cpp'],
      },
      glue: expect.arrayContaining(['configuration.cpp', 'pou_HMIMAIN.cpp', 'hmi_unit_glue.cpp', 'hmi_preview.cpp']),
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
    expect(
      messages(generateHmiUnit(withScreen(screen('    Layout : HmiLabel;\n    Root : HmiVerticalStack;')))),
    ).toEqual([
      'Overview: Layout: an element may not be named like a member of HmiScreen',
      'Overview: Root: an element may not be named like a member of HmiScreen',
    ])
  })

  it('keeps a numeric write-back within the tag type, writing the nearest value instead of wrapping', () => {
    expect(numericWriteBack('REAL', 'REAL', 'v')).toEqual({ expr: 'v' })
    expect(numericWriteBack('REAL', 'INT', 'v')).toEqual({
      expr: 'REAL_TO_INT(LIMIT(-32768.0, v, 32767.0))',
      guard: 'v = v',
    })
    expect(numericWriteBack('REAL', 'DINT', 'v').expr).toBe('REAL_TO_DINT(LIMIT(-2147483648.0, v, 2147483520.0))')
    expect(numericWriteBack('LREAL', 'DINT', 'v').expr).toBe('LREAL_TO_DINT(LIMIT(-2147483648.0, v, 2147483647.0))')
    expect(numericWriteBack('REAL', 'WORD', 'v').expr).toBe('REAL_TO_WORD(LIMIT(0.0, v, 65535.0))')
    expect(numericWriteBack('REAL', 'ULINT', 'v').expr).toBe('REAL_TO_ULINT(LIMIT(0.0, v, 18446742974197923840.0))')
    expect(numericWriteBack('LREAL', 'REAL', 'v')).toEqual({
      expr: 'LREAL_TO_REAL(LIMIT(-3.4028234663852886E38, v, 3.4028234663852886E38))',
      guard: 'v = v',
    })
    expect(numericWriteBack('REAL', 'LREAL', 'v')).toEqual({ expr: 'REAL_TO_LREAL(v)' })
    expect(numericWriteBack('INT', 'DINT', 'v')).toEqual({ expr: 'INT_TO_DINT(v)' })
    expect(numericWriteBack('DINT', 'INT', 'v')).toEqual({ expr: 'DINT_TO_INT(LIMIT(-32768, v, 32767))' })
    expect(numericWriteBack('DINT', 'UDINT', 'v')).toEqual({ expr: 'DINT_TO_UDINT(LIMIT(0, v, 2147483647))' })
    expect(numericWriteBack('ULINT', 'LINT', 'v')).toEqual({ expr: 'ULINT_TO_LINT(LIMIT(0, v, 9223372036854775807))' })
    expect(numericWriteBack('DINT', 'REAL', 'v')).toEqual({ expr: 'DINT_TO_REAL(v)' })
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
    for (const name of [
      'HMI_Show',
      'HMI_CurrentScreen',
      'hmi_glue',
      'Hmi_Tags',
      'HMI_MAIN',
      'HMI__Request',
      'HMI_THEME_Light',
    ])
      expect(named(name)).toEqual([`${name}: Screen name '${name}' is taken by the HMI library`])
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

  it('refuses PLC variables that do not exist, are not named by instance or cannot be shown', () => {
    expect(
      messages(generateHmiUnit(withScreen(screen('    L : HmiLabel;', '  L.Visible := instance0.Main.Nope;')))),
    ).toEqual(["Overview:6: Program 'MAIN' has no variable 'NOPE'."])
    expect(messages(generateHmiUnit(withScreen(screen('    L : HmiLabel;', '  L.Visible := Main.Running;'))))).toEqual([
      "Overview:6: Cannot access members of program 'MAIN' directly — declare a variable of type 'MAIN' first.",
    ])
    const project = sampleProject()
    const odd = {
      ...project,
      plcDeclarations: PLC_DECLARATIONS.replace(
        'Unused : DINT;',
        'Unused : DINT;\n    Buf : ARRAY[0..3] OF INT;\n    W : WSTRING;',
      ),
    }
    const element = generateHmiUnit({
      ...odd,
      screens: withScreen(screen('    L : HmiLabel;', '  L.Visible := instance0.Main.Buf[1] > 0;')).screens,
    })
    expect(messages(element)).toEqual([])
    expect(element.tags.map((t) => t.path)).toContain('CONFIG0.RES0.INSTANCE0.MAIN.BUF[1]')
    expect(
      messages(
        generateHmiUnit({
          ...odd,
          screens: withScreen(screen('    L : HmiLabel;', '  L.Visible := instance0.Main.W = "";')).screens,
        }),
      ),
    ).toEqual(['HMI: INSTANCE0.MAIN.W: WSTRING variables cannot be used on screens'])
  })

  it('connects each pipe to the one declared before it in the same container, for its hops', () => {
    const result = generateHmiUnit(
      withScreen(
        screen(
          [
            '    D1 : HmiDiagram;',
            '    D2 : HmiDiagram;',
            "    A : HmiPump := (Parent := 'D1');",
            "    B : HmiValve := (Parent := 'D1');",
            "    C : HmiPump := (Parent := 'D2');",
            "    E : HmiValve := (Parent := 'D2');",
            "    P1 : HmiPipe := (Parent := 'D1', Source := 'A', Target := 'B');",
            "    Q1 : HmiPipe := (Parent := 'D2', Source := 'C', Target := 'E');",
            "    P2 : HmiPipe := (Parent := 'D1', Source := 'B', Target := 'A', Path := '10,10;10,90');",
          ].join('\n'),
        ),
      ),
    )
    expect(messages(result)).toEqual([])
    const overview = Object.values(result.sources).find((t) => t.includes('FUNCTION_BLOCK Overview')) ?? ''
    expect(overview).toContain('Connect(ADR(P1), ADR(A), ADR(B), 0);')
    expect(overview).toContain('Connect(ADR(Q1), ADR(C), ADR(E), 0);')
    expect(overview).toContain('Connect(ADR(P2), ADR(B), ADR(A), ADR(P1));')
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
                "    S1 : HmiVerticalStack := (Parent := 'S2');",
                "    S2 : HmiHorizontalStack := (Parent := 'S1');",
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
    expect(messages(generateHmiUnit(withScreen(screen(`    Col : HmiVerticalStack;\n${labels}`))))).toEqual([
      'Overview: Col holds 65 elements; at most 64',
    ])
  })

  it('refuses elements outside every container, naming each element and the screen', () => {
    const source = [
      'FUNCTION_BLOCK Overview EXTENDS HmiScreen',
      '  VAR',
      '    Side : HmiVerticalStack;',
      '    Plant : HmiDiagram;',
      "    Pump : HmiPump := (Parent := 'Plant');",
      "    Lamp : HmiLamp := (Caption := 'On');",
      '    Tank : HmiTank;',
      '  END_VAR',
      'END_FUNCTION_BLOCK',
      '',
    ].join('\n')
    const result = generateHmiUnit(withScreen(source))
    expect(result.ok).toBe(false)
    expect(messages(result)).toEqual([
      "Overview: Lamp: only containers may sit directly on screen Overview; put Lamp in a vertical stack, horizontal stack or diagram with Parent := '<container name>'",
      "Overview: Tank: only containers may sit directly on screen Overview; put Tank in a vertical stack, horizontal stack or diagram with Parent := '<container name>'",
    ])
  })

  it('builds a new screen from its template, and a widget dropped into its stack', () => {
    expect(messages(generateHmiUnit(withScreen(newHmiScreenSource('Overview'))))).toEqual([])
    const filled = newHmiScreenSource('Overview').replace(
      '  END_VAR',
      `    Tank1 : HmiTank := (Parent := '${NEW_SCREEN_STACK}');\n  END_VAR`,
    )
    expect(messages(generateHmiUnit(withScreen(filled)))).toEqual([])
  })

  it('reads every trend series bound to a variable, and an older two-pen trend as before', () => {
    const result = generateHmiUnit(
      withScreen(
        screen(
          '    T : HmiTrend := (Pens := 3, Color3 := COLOR.Orange);\n    Old : HmiTrend := (Pens := 2, Color2 := COLOR.Red);',
          '  T.Value := instance0.Main.Level;\n  T.Value2 := instance0.Main.Speed;\n  T.Value3 := instance0.Main.Level;\n  Old.Value2 := instance0.Main.Level;',
        ),
      ),
    )
    expect(messages(result)).toEqual([])
    expect(result.tags.map((t) => t.path)).toEqual(
      expect.arrayContaining(['CONFIG0.RES0.INSTANCE0.MAIN.LEVEL', 'CONFIG0.RES0.INSTANCE0.MAIN.SPEED']),
    )
  })

  it('lays several containers and nested containers out from the screen root', () => {
    const result = generateHmiUnit(
      withScreen(
        [
          'FUNCTION_BLOCK Overview EXTENDS HmiScreen',
          '  VAR',
          '    Top : HmiHorizontalStack;',
          "    Split : HmiVerticalStack := (Parent := 'Top');",
          "    Tank : HmiTank := (Parent := 'Split');",
          "    Side : HmiHorizontalStack := (Parent := 'Split');",
          "    Go : HmiButton := (Parent := 'Side');",
          "    Plant : HmiDiagram := (Parent := 'Side');",
          '    Bottom : HmiVerticalStack;',
          '  END_VAR',
          'END_FUNCTION_BLOCK',
          '',
        ].join('\n'),
      ),
    )
    expect(messages(result)).toEqual([])
    const overview = Object.values(result.sources).find((t) => t.includes('FUNCTION_BLOCK Overview')) ?? ''
    expect(overview).toContain(
      'Attach(ADR(Top), 0); Attach(ADR(Split), ADR(Top)); Attach(ADR(Tank), ADR(Split)); Attach(ADR(Side), ADR(Split)); ' +
        'Attach(ADR(Go), ADR(Side)); Attach(ADR(Plant), ADR(Side)); Attach(ADR(Bottom), 0);',
    )
  })

  it('names the two stacks in place of an HmiStack declaration', () => {
    const source = screen(
      "    Col : HmiStack := (Direction := HMI_DIRECTION#Row);\n    L : HmiLabel := (Parent := 'Col');",
    )
    expect(messages(generateHmiUnit(withScreen(source)))).toEqual(
      expect.arrayContaining([
        'Overview: Col: HmiStack is the base of the stacks; declare Col as HmiVerticalStack (children side by side) or HmiHorizontalStack (children top to bottom), without Direction',
      ]),
    )
  })

  it('compiles PLC declarations that use library blocks, with the PLC libraries passed in', () => {
    const project = sampleProject()
    const plcDeclarations = project.plcDeclarations?.replace(
      '    Unused : DINT;\n',
      '    Unused : DINT;\n    T1 : TON;\n',
    )
    const input = {
      ...withScreen(screen('    Done : HmiLamp;', '  Done.Value := instance0.Main.T1.Q;')),
      plcDeclarations,
      preview: true,
      resolve: undefined,
    }
    expect(messages(generateHmiUnit(input))).toContain("HMI:8: Undefined type 'TON' in PROGRAM 'MAIN'")
    const archiveJson = readFileSync(
      join(process.cwd(), 'node_modules', 'strucpp', 'libs', 'iec-standard-fb.stlib'),
      'utf-8',
    )
    const result = generateHmiUnit({ ...input, plcLibraries: [{ name: 'iec-standard-fb', archiveJson }] })
    expect(messages(result)).toEqual([])
    expect(result.tags.map((t) => t.path)).toContain('CONFIG0.RES0.INSTANCE0.MAIN.T1.Q')
    expect(Object.values(result.files).some((text) => /\bclass TON\b|\bTON::/.test(text))).toBe(false)
  })

  it('shows a CONSTANT, never starts it in a preview, and refuses a widget that would write it', () => {
    const project = sampleProject()
    const constant = {
      ...project,
      plcDeclarations: project.plcDeclarations?.replace(
        'CONFIGURATION Config0\n',
        'CONFIGURATION Config0\n  VAR_GLOBAL CONSTANT\n    MaxL : INT := 10;\n  END_VAR\n',
      ),
      plcVariables: [
        ...project.plcVariables,
        { path: 'MaxL', type: 'INT', initialValue: '10', constant: true as const },
      ],
      preview: true,
      resolve: undefined,
    }
    const shown = generateHmiUnit({
      ...constant,
      screens: withScreen(screen('    Max : HmiLabel;', '  Max.Text := INT_TO_STRING(MaxL);')).screens,
    })
    expect(messages(shown)).toEqual([])
    expect(shown.sources['hmi_main.st']).not.toContain('MaxL :=')
    const written = generateHmiUnit({
      ...constant,
      screens: withScreen(screen('    S : HmiSlider;', '  S.Value := MaxL;')).screens,
    })
    expect(messages(written)).toEqual(['Overview: S.Value: MaxL is a CONSTANT; the operator cannot change it'])
  })

  it('refuses a write-back the variable cannot take', () => {
    expect(
      messages(generateHmiUnit(withScreen(screen('    T : HmiTextInput;', '  T.Value := instance0.Main.Speed;')))),
    ).toEqual(['Overview: T.Value: a STRING widget value cannot be written to instance0.Main.Speed (INT)'])
  })

  it('reports compile errors in a screen at its own line, and widget blocks that are not widgets', () => {
    const broken = generateHmiUnit(withScreen(screen('    L : HmiLabel;', '  L.Size := Undeclared;')))
    expect(messages(broken)).toEqual(["Overview:6: Undeclared variable 'UNDECLARED'"])
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
