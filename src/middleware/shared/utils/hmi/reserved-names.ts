/**
 * Names screens and widget blocks may not take: what the StandardWidgets library declares (kept equal to its
 * manifest by a test) and what the HMI build generates.
 */

/** Functions, function blocks, types, globals and interfaces of StandardWidgets. */
export const HMI_LIBRARY_NAMES: readonly string[] = [
  'COLOR',
  'HMI_ALIGN',
  'HMI_Alpha',
  'HMI_Arc',
  'HMI_Back',
  'HMI_Clear',
  'HMI_Clip',
  'HMI_COLORS',
  'HMI_Cos',
  'HMI_DIRECTION',
  'HMI_FillCircle',
  'HMI_FillEllipse',
  'HMI_FillRect',
  'HMI_FONT',
  'HMI_FormatInt',
  'HMI_FormatReal',
  'HMI_FormatValue',
  'HMI_Hit',
  'HMI_Line',
  'HMI_ParseReal',
  'HMI_PerMille',
  'HMI_PolyBegin',
  'HMI_PolyFill',
  'HMI_PolyPoint',
  'HMI_PolyStroke',
  'HMI_PORT',
  'HMI_PtrConsume',
  'HMI_PtrDown',
  'HMI_PtrPressed',
  'HMI_PtrReleased',
  'HMI_PtrX',
  'HMI_PtrY',
  'HMI_ScreenH',
  'HMI_ScreenW',
  'HMI_Sin',
  'HMI_StrokeCircle',
  'HMI_StrokeEllipse',
  'HMI_StrokeRect',
  'HMI_Text',
  'HMI_TextBox',
  'HMI_TextWidth',
  'HMI_TimeMs',
  'HMI_Truncate',
  'HMI_Unclip',
  'HMI_VALIGN',
  'HmiButton',
  'HmiDiagram',
  'HmiElement',
  'HmiGauge',
  'HmiKeyboard',
  'HmiLabel',
  'HmiLamp',
  'HmiNumericInput',
  'HmiPipe',
  'HmiPump',
  'HmiReadout',
  'HmiRect',
  'HmiRuntime',
  'HmiScreen',
  'HmiSlider',
  'HmiStack',
  'HmiSwitch',
  'HmiTank',
  'HmiTextInput',
  'HmiTrend',
  'HmiValue',
  'HmiValve',
  'HmiVessel',
  'IHmiElement',
]

/** Declarations and file names of the glue the HMI build generates. */
export const HMI_GENERATED_NAMES: readonly string[] = [
  'HMI_SCREEN',
  'HMI_Show',
  'HMI_CurrentScreen',
  'HmiMain',
  'HmiConfig',
  'HmiResource',
  'HmiTask',
  'HmiInstance',
  'GVL',
  'hmi_glue',
  'hmi_tags',
  'hmi_main',
]

/** Prefixes of generated names: internals and theme constants. */
export const HMI_GENERATED_PREFIXES: readonly string[] = ['HMI__', 'HMI_THEME_']

/** Why a screen or widget block may not be called `name`, or null when it may. */
export function hmiReservedName(name: string): string | null {
  const key = name.toUpperCase()
  const taken = (list: readonly string[]): boolean => list.some((n) => n.toUpperCase() === key)
  if (taken(HMI_LIBRARY_NAMES) || taken(HMI_GENERATED_NAMES) || HMI_GENERATED_PREFIXES.some((p) => key.startsWith(p)))
    return `"${name}" is taken by the HMI library`
  return null
}
