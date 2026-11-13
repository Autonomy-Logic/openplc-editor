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
  Level.Value := Main.Level;
  Run.Value := Main.Running;
  Speed.Value := Main.Speed;
  Setpoint.Value := Main.Speed;
  Name.Value := Main.Tag;
  Alarm.Value := GVL.Alarm;
  IF Next.Clicked THEN HMI_Show(HMI_SCREEN#Details); END_IF;
END_FUNCTION_BLOCK
`

export const DETAILS = `FUNCTION_BLOCK Details EXTENDS HmiScreen
  VAR
    Back : HmiButton := (Text := 'Back');
    Shown : HmiLabel;
  END_VAR
  IF Back.Clicked THEN HMI_Back(); END_IF;
  Shown.Text := Main.Tag;
END_FUNCTION_BLOCK
`

export const BADGE = `FUNCTION_BLOCK Badge EXTENDS HmiLamp
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillRect(Left, Top, Width, Height, 4, SEL(Value, COLOR.Border, COLOR.Danger));
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`

/** Debug-table addresses of the sample PLC program; GVL.Alarm is missing, as after a rename. */
const DEBUG_MAP = new Map([
  ['MAIN.LEVEL', { arr: 0, elem: 3 }],
  ['MAIN.RUNNING', { arr: 0, elem: 4 }],
  ['MAIN.SPEED', { arr: 0, elem: 5 }],
  ['MAIN.TAG', { arr: 1, elem: 0 }],
  ['MAIN.UNUSED', { arr: 0, elem: 6 }],
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
      { path: 'Main.Level', type: 'REAL' },
      { path: 'Main.Running', type: 'BOOL' },
      { path: 'Main.Speed', type: 'INT' },
      { path: 'Main.Tag', type: 'STRING(12)' },
      { path: 'Main.Unused', type: 'DINT' },
      { path: 'GVL.Alarm', type: 'BOOL' },
    ],
    projectNames: ['Main'],
    resolve: (path) => DEBUG_MAP.get(path.toUpperCase()) ?? null,
    plcMd5: '0123456789abcdef0123456789abcdef',
  }
}
