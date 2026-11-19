import { HMI_ALARMS_LIBRARY_NAMES } from '../../../../../middleware/shared/utils/hmi/reserved-names'
import { runProgramBuildPipeline } from '../../../library/program-build-pipeline'
import { buildHmiAlarms, clearHmiAlarmsCache, withHmiAlarmsArchive } from '../build-hmi-alarms'
import { HMI_ALARMS_LIBRARY, HMI_ALARMS_NAMES, hmiAlarmsReferenced } from '../hmi-alarms'

const PROGRAM = `PROGRAM Main
  VAR
    Alarms : ARRAY[1..4] OF HMI_ALARM_ROW;
    Events : ARRAY[0..9] OF HMI_EVENT_ROW;
    Sys : HMI_ALARM_SUMMARY;
    High : BOOL;
  END_VAR
  HMI_ALARM(In := High, Id := 1, Message := 'Level high', Table := Alarms);
  HMI_ALARMS(Summary := Sys, Table := Alarms);
  HMI_ALARM_LOGGER(Table := Alarms, Events := Events);
END_PROGRAM
CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 1);
    PROGRAM instance0 WITH task0 : Main;
  END_RESOURCE
END_CONFIGURATION
`

const build = (source: string, libraries: unknown[] = []) =>
  runProgramBuildPipeline({ source, md5: '0', pous: [], libraries, missingLibraries: [], hasCBlocks: false })

describe('HmiAlarms PLC library', () => {
  it('compiles, declaring exactly the names the HMI reserves', () => {
    clearHmiAlarmsCache()
    const built = buildHmiAlarms()
    if (!built.ok) throw new Error(JSON.stringify(built.errors))
    const m = built.archive.manifest
    const declared = [...m.functions, ...m.functionBlocks, ...m.types].map((x) =>
      (x.displayName ?? x.name).toUpperCase(),
    )
    expect(declared.sort()).toEqual([...HMI_ALARMS_NAMES].sort())
    expect([...HMI_ALARMS_LIBRARY_NAMES].sort()).toEqual([...HMI_ALARMS_NAMES].sort())
    expect(buildHmiAlarms()).toBe(built)
  })

  it('is added once to the archives a build compiles against', () => {
    const once = withHmiAlarmsArchive([])
    expect(once.map((a) => a.manifest.name)).toEqual([HMI_ALARMS_LIBRARY.name])
    expect(withHmiAlarmsArchive(once)).toHaveLength(1)
  })

  it('tells a program that names it from one that does not', () => {
    expect(hmiAlarmsReferenced(PROGRAM)).toBe(true)
    expect(hmiAlarmsReferenced('PROGRAM P VAR x : hmi_alarm_row; END_VAR END_PROGRAM')).toBe(true)
    expect(hmiAlarmsReferenced('PROGRAM P VAR HMI_ALARMSX : BOOL; END_VAR END_PROGRAM')).toBe(false)
  })

  it('compiles a program that uses it without being given the library, and leaves it out of one that does not', () => {
    const used = build(PROGRAM)
    expect(used.errors.map((e) => e.formatted)).toEqual([])
    expect(used.success).toBe(true)
    expect(used.files.map((f) => f.content).join('\n')).toContain('HMI_ALARMS')
    const plain = build(
      'PROGRAM Main\n  VAR x : BOOL; END_VAR\n  x := NOT x;\nEND_PROGRAM\n' +
        PROGRAM.slice(PROGRAM.indexOf('CONFIGURATION')),
    )
    expect(plain.success).toBe(true)
    expect(plain.files.map((f) => f.content).join('\n')).not.toContain('HMI_ALARM')
  })
})
