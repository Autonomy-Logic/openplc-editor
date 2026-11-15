/** The sample project the HMI unit tests build (Jest and tests/hmi-unit): two screens, a widget block, PLC variables and settings. */
import { hmiSettingsSchema } from '../../../../../../middleware/shared/utils/hmi/settings'
import type { HmiUnitInput } from '../../generate-hmi-unit'

export const OVERVIEW = `{attribute 'hmi_theme' := 'Brand'}
FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Col : HmiStack := (Direction := HMI_DIRECTION#Row, Gap := 8);
    Level : HmiTank := (Caption := 'Level', Parent := 'Col', MaxValue := 10.0);
    Run : HmiSwitch := (Caption := 'Run', Parent := 'Col');
    Speed : HmiSlider := (Caption := 'Speed', MaxValue := 100.0, Step := 5.0);
    Name : HmiTextInput := (Caption := 'Name', MaxLength := 20);
    Alarm : Badge := (Caption := 'Alarm');
    Next : HmiButton := (Text := 'Details');
    Setpoint : HmiNumericInput := (Caption := 'Speed setpoint', Decimals := 0);
  END_VAR
  Level.Value := instance0.Main.Level;
  Run.Value := instance0.Main.Running;
  Speed.Value := instance0.Main.Speed;
  Setpoint.Value := instance0.Main.Speed;
  Name.Value := instance0.Main.Tag;
  Alarm.Value := AlarmOn;
  IF Next.Clicked THEN HMI_Show(HMI_SCREEN#Details); END_IF;
END_FUNCTION_BLOCK
`

export const DETAILS = `FUNCTION_BLOCK Details EXTENDS HmiScreen
  VAR
    Back : HmiButton := (Text := 'Back');
    Shown : HmiLabel;
  END_VAR
  IF Back.Clicked THEN HMI_Back(); END_IF;
  Shown.Text := instance0.Main.Tag;
END_FUNCTION_BLOCK
`

export const BADGE = `FUNCTION_BLOCK Badge EXTENDS HmiLamp
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillRect(Left, Top, Width, Height, 4, SEL(Value, COLOR.Border, COLOR.Danger));
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`

/** The sample PLC program as screens compile against it: Main's declarations and the configuration. */
export const PLC_DECLARATIONS = `PROGRAM Main
  VAR
    Level : REAL;
    Running : BOOL;
    Speed : INT;
    Tag : STRING(12);
    Unused : DINT;
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

/** Debug-table addresses of the sample PLC program; the global AlarmOn is missing, as after a rename. */
const DEBUG_MAP = new Map([
  ['CONFIG0.RES0.INSTANCE0.MAIN.LEVEL', { arr: 0, elem: 3 }],
  ['CONFIG0.RES0.INSTANCE0.MAIN.RUNNING', { arr: 0, elem: 4 }],
  ['CONFIG0.RES0.INSTANCE0.MAIN.SPEED', { arr: 0, elem: 5 }],
  ['CONFIG0.RES0.INSTANCE0.MAIN.TAG', { arr: 1, elem: 0 }],
  ['CONFIG0.RES0.INSTANCE0.MAIN.UNUSED', { arr: 0, elem: 6 }],
])

export function sampleProject(): HmiUnitInput {
  return {
    screens: [
      { name: 'Overview', source: OVERVIEW },
      { name: 'Details', source: DETAILS },
    ],
    widgets: [{ name: 'Badge', source: BADGE }],
    settings: hmiSettingsSchema.parse({
      startScreen: 'Overview',
      framePeriodMs: 50,
      roles: {
        Overview: { engineer: true, operator: true, viewer: true },
        Details: { engineer: true, operator: false, viewer: false },
      },
      pin: { enabled: true, value: '2468' },
      relock: { mode: 'idle', minutes: 5 },
      themes: [{ name: 'Brand', base: 'Light', colors: { Accent: '#7C3AED' } }],
    }),
    plcVariables: [
      { path: 'instance0.Main.Level', type: 'REAL' },
      { path: 'instance0.Main.Running', type: 'BOOL' },
      { path: 'instance0.Main.Speed', type: 'INT' },
      { path: 'instance0.Main.Tag', type: 'STRING(12)' },
      { path: 'instance0.Main.Unused', type: 'DINT' },
      { path: 'AlarmOn', type: 'BOOL' },
    ],
    plcDeclarations: PLC_DECLARATIONS,
    projectNames: ['Main'],
    resolve: (path) => DEBUG_MAP.get(path.toUpperCase()) ?? null,
    plcMd5: '0123456789abcdef0123456789abcdef',
  }
}
