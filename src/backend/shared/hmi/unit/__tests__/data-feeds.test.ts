import type { HmiPlcVariable } from '../../../../../middleware/shared/ports/hmi-preview-types'
import { generateHmiUnit, type HmiUnitInput, type HmiUnitResult } from '../generate-hmi-unit'
import { sampleProject } from './fixtures/sample-project'

const DECLARATIONS = `PROGRAM Main
  VAR
    Level : REAL;
    Running : BOOL;
    Speed : INT;
    Tag : STRING(12);
    Unused : DINT;
    Alarms : ARRAY[1..3] OF HMI_ALARM_ROW;
    Events : ARRAY[0..1] OF HMI_EVENT_ROW;
    Sys : HMI_ALARM_SUMMARY;
    Flow : ARRAY[0..2] OF INT;
    Head : ARRAY[0..2] OF REAL;
  END_VAR
  ;
END_PROGRAM
CONFIGURATION Config0
  VAR_GLOBAL
    AlarmOn : BOOL;
  END_VAR
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 1);
    PROGRAM instance0 WITH task0 : Main;
  END_RESOURCE
END_CONFIGURATION
`

const SOURCES: HmiPlcVariable[] = [
  {
    path: 'instance0.Main.Alarms',
    type: 'ARRAY[1..3] OF HMI_ALARM_ROW',
    source: { kind: 'alarms', lower: 1, upper: 3 },
  },
  {
    path: 'instance0.Main.Events',
    type: 'ARRAY[0..1] OF HMI_EVENT_ROW',
    source: { kind: 'events', lower: 0, upper: 1 },
  },
  { path: 'instance0.Main.Sys', type: 'HMI_ALARM_SUMMARY', source: { kind: 'summary' } },
  {
    path: 'instance0.Main.Flow',
    type: 'ARRAY[0..2] OF INT',
    source: { kind: 'numbers', lower: 0, upper: 2, element: 'INT' },
  },
  {
    path: 'instance0.Main.Head',
    type: 'ARRAY[0..2] OF REAL',
    source: { kind: 'numbers', lower: 0, upper: 2, element: 'REAL' },
  },
]

const DATA_SCREEN = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack;
    Ban : HmiAlarmBanner := (Parent := 'Body', Source := 'instance0.Main.Sys');
    List : HmiAlarmList := (Parent := 'Body', Source := 'instance0.Main.Alarms', Service := 'instance0.Main.Sys');
    Log : HmiEventLog := (Parent := 'Body', Source := 'instance0.Main.Events');
    Plot : HmiXYPlot := (Parent := 'Body', XSource := 'instance0.Main.Flow', YSource := 'instance0.Main.Head');
  END_VAR
END_FUNCTION_BLOCK
`

/** The sample project with a data screen in place of Overview, and the data variables listed. */
function dataProject(screen = DATA_SCREEN, extra: Partial<HmiUnitInput> = {}): HmiUnitInput {
  const project = sampleProject()
  let next = 100
  return {
    ...project,
    screens: [{ name: 'Overview', source: screen }, project.screens[1]],
    plcDeclarations: DECLARATIONS,
    plcVariables: [...project.plcVariables, ...SOURCES],
    resolve: () => ({ arr: 0, elem: next++ }),
    ...extra,
  }
}

const messages = (r: HmiUnitResult): string[] => r.errors.map((e) => `${e.file}: ${e.message}`)

describe('HMI data feeds', () => {
  let result: HmiUnitResult
  beforeAll(() => {
    result = generateHmiUnit(dataProject())
  })

  it('compiles a screen whose data widgets are fed from an alarm table, log, summary and arrays', () => {
    expect(messages(result)).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('generates one feed block per bound source with a constant-index read per row and field', () => {
    const feeds = result.sources['hmi_feed_Overview.st']
    expect(feeds).toContain('FUNCTION_BLOCK HMI__Feed_Overview_List_0 EXTENDS HmiFeed')
    expect(feeds).toContain('Count := 3;')
    expect(feeds).toContain('0: Message := instance0.Main.Alarms[1].Message;')
    expect(feeds).toContain('2: Stamp := instance0.Main.Alarms[3].Raised;')
    expect(feeds).toContain('1: Seq := instance0.Main.Events[1].Seq;')
    expect(feeds).toContain('Message := instance0.Main.Sys.TopMessage;')
    expect(feeds).toContain('2: Number := INT_TO_REAL(instance0.Main.Flow[2]);')
    expect(feeds).toContain('1: Number := instance0.Main.Head[1];')
    expect(feeds).not.toContain('FOR ')
    const screen = result.sources['Overview.st']
    expect(screen).toContain('HMI__F_List_0 : HMI__Feed_Overview_List_0;')
    expect(screen).toContain('List.SetFeed(0, ADR(HMI__F_List_0));')
    expect(screen).toContain('List.SetFeed(1, ADR(HMI__F_List_1));')
    expect(screen).toContain('Plot.SetFeed(1, ADR(HMI__F_Plot_1));')
  })

  it('writes acknowledgements back with the occurrence shown, to the row, the top alarm or every alarm', () => {
    const screen = result.sources['Overview.st']
    expect(screen).toContain(
      'CASE List.AckRow OF ' +
        '0: instance0.Main.Alarms[1].AckSeq := List.AckRowSeq; instance0.Main.Alarms[1].AckReq := TRUE; ' +
        '1: instance0.Main.Alarms[2].AckSeq := List.AckRowSeq; instance0.Main.Alarms[2].AckReq := TRUE; ' +
        '2: instance0.Main.Alarms[3].AckSeq := List.AckRowSeq; instance0.Main.Alarms[3].AckReq := TRUE; END_CASE;',
    )
    expect(screen).toContain(
      'IF Ban.AckTop THEN instance0.Main.Sys.AckTopSeq := Ban.AckTopSeq; instance0.Main.Sys.AckTop := TRUE; END_IF;',
    )
    expect(screen).toContain('IF List.AckAll THEN instance0.Main.Sys.AckAll := TRUE; END_IF;')
  })

  it('counts every row the feeds read for the screen, and limits the acknowledgement writes to TRUE', () => {
    const tag = (path: string) => result.tags.findIndex((t) => t.path.toUpperCase().endsWith(path))
    const page = result.pages[0]
    const details = result.pages[1]
    const message3 = tag('ALARMS[3].MESSAGE')
    expect(message3).toBeGreaterThanOrEqual(0)
    expect(page.reads).toContain(message3)
    expect(details.reads).not.toContain(message3)
    for (const path of ['ALARMS[1].ACKREQ', 'ALARMS[3].ACKREQ', 'SYS.ACKTOP', 'SYS.ACKALL'])
      expect(page.writes.find((w) => w.tag === tag(path))).toEqual({
        tag: tag(path),
        whole: true,
        bits: [],
        limit: { min: 1, max: 1 },
      })
    expect(details.writes).toEqual([])
  })

  it('refuses a source of another kind, one that is not a source, and a widget the target cannot show', () => {
    const wrong = generateHmiUnit(
      dataProject(
        DATA_SCREEN.replace(
          "List : HmiAlarmList := (Parent := 'Body', Source := 'instance0.Main.Alarms'",
          "List : HmiAlarmList := (Parent := 'Body', Source := 'instance0.Main.Events'",
        ),
      ),
    )
    expect(messages(wrong)).toEqual([
      "Overview: List.Source takes ARRAY OF HMI_ALARM_ROW; 'instance0.Main.Events' is ARRAY[0..1] OF HMI_EVENT_ROW",
    ])
    const missing = generateHmiUnit(
      dataProject(DATA_SCREEN.replace("'instance0.Main.Sys');", "'instance0.Main.Level');")),
    )
    expect(messages(missing)).toEqual([
      "Overview: Ban.Source: 'instance0.Main.Level' is not a table, log, summary or array of the PLC program; it takes HMI_ALARM_SUMMARY",
    ])
    const refused = generateHmiUnit(dataProject(DATA_SCREEN, { capabilities: { hmiDataWidgets: false } }))
    expect(messages(refused)).toEqual([
      'Overview: List: HmiAlarmList needs a target with hmiDataWidgets, and the selected board does not have it',
      'Overview: Log: HmiEventLog needs a target with hmiDataWidgets, and the selected board does not have it',
    ])
    expect(generateHmiUnit(dataProject(DATA_SCREEN, { capabilities: { hmiDataWidgets: true } })).ok).toBe(true)
  })

  it('feeds the occurrence of every alarm row and of the top alarm', () => {
    const feeds = result.sources['hmi_feed_Overview.st']
    expect(feeds).toContain('0: Seq := instance0.Main.Alarms[1].Seq;')
    expect(feeds).toContain('Seq := instance0.Main.Sys.TopSeq;')
  })

  it('refuses a data source set in code, which the build cannot feed', () => {
    const coded = generateHmiUnit(
      dataProject(DATA_SCREEN.replace('END_VAR\n', "END_VAR\n  Log.Source := 'instance0.Main.Events';\n")),
    )
    expect(messages(coded)).toContain(
      'Overview: Log.Source is set in code; a data source is set in the declaration, as a literal',
    )
  })

  it('refuses a source past the eighth a widget block declares, which no feed slot can hold', () => {
    const inputs = Array.from(
      { length: 9 },
      (_, i) => `    {attribute 'hmi_source' := 'ARRAY OF REAL'}\n    S${i + 1} : STRING(96);\n`,
    )
    const nine = `FUNCTION_BLOCK Nine EXTENDS HmiDataElement\n  VAR_INPUT\n${inputs.join('')}  END_VAR\nEND_FUNCTION_BLOCK\n`
    const project = dataProject(
      "FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Body : HmiHorizontalStack;\n    N : Nine := (Parent := 'Body', S8 := 'instance0.Main.Head', S9 := 'instance0.Main.Head');\n  END_VAR\nEND_FUNCTION_BLOCK\n",
    )
    const result = generateHmiUnit({ ...project, widgets: [...project.widgets, { name: 'Nine', source: nine }] })
    expect(messages(result)).toEqual(['Overview: N.S9: Nine has more than 8 data sources; only the first 8 can be fed'])
  })

  it('leaves a data widget without a source unfed', () => {
    const plain = generateHmiUnit(
      dataProject(
        "FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Body : HmiHorizontalStack;\n    List : HmiAlarmList := (Parent := 'Body');\n  END_VAR\nEND_FUNCTION_BLOCK\n",
      ),
    )
    expect(messages(plain)).toEqual([])
    expect(plain.sources['hmi_feed_Overview.st']).toBeUndefined()
  })

  it('feeds a widget from a table and a summary nested in a struct array element, with their write-backs', () => {
    const declarations = DECLARATIONS.replace(
      'PROGRAM Main',
      'TYPE Line : STRUCT Alarms : ARRAY[1..2] OF HMI_ALARM_ROW; Sys : HMI_ALARM_SUMMARY; END_STRUCT; END_TYPE\nPROGRAM Main',
    ).replace('    Level : REAL;', '    Level : REAL;\n    Lines : ARRAY[1..2] OF Line;')
    const nested = generateHmiUnit(
      dataProject(
        `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack;
    List : HmiAlarmList := (Parent := 'Body', Source := 'instance0.Main.Lines[2].Alarms', Service := 'instance0.Main.Lines[2].Sys');
  END_VAR
END_FUNCTION_BLOCK
`,
        {
          plcDeclarations: declarations,
          plcVariables: [
            ...sampleProject().plcVariables,
            {
              path: 'instance0.Main.Lines[2].Alarms',
              type: 'ARRAY[1..2] OF HMI_ALARM_ROW',
              source: { kind: 'alarms', lower: 1, upper: 2 },
            },
            { path: 'instance0.Main.Lines[2].Sys', type: 'HMI_ALARM_SUMMARY', source: { kind: 'summary' } },
          ],
        },
      ),
    )
    expect(messages(nested)).toEqual([])
    expect(nested.sources['hmi_feed_Overview.st']).toContain('1: Message := instance0.Main.Lines[2].Alarms[2].Message;')
    expect(nested.sources['Overview.st']).toContain(
      '1: instance0.Main.Lines[2].Alarms[2].AckSeq := List.AckRowSeq; instance0.Main.Lines[2].Alarms[2].AckReq := TRUE;',
    )
    expect(nested.sources['Overview.st']).toContain(
      'IF List.AckAll THEN instance0.Main.Lines[2].Sys.AckAll := TRUE; END_IF;',
    )
    const ack = nested.tags.findIndex((t) => t.path.toUpperCase().endsWith('LINES[2].ALARMS[2].ACKREQ'))
    expect(ack).toBeGreaterThanOrEqual(0)
    expect(nested.pages[0].writes.find((w) => w.tag === ack)?.limit).toEqual({ min: 1, max: 1 })
  })
})
