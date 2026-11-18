/**
 * The actions a widget's event runs, as the designer offers them, and the ST statement each one is written as. Code
 * that is not one of them is kept as it is and edited as ST.
 */

/** An event's action. */
export type HmiAction =
  | { kind: 'none' }
  | { kind: 'show'; screen: string }
  | { kind: 'back' }
  | { kind: 'signOut' }
  | { kind: 'lock' }
  | { kind: 'calibrate' }
  | { kind: 'set'; variable: string; value: string }
  | { kind: 'toggle'; variable: string }
  | { kind: 'code'; code: string }

export type HmiActionKind = HmiAction['kind']

/** The actions in the order the designer lists them, with their labels. */
export const HMI_ACTIONS: ReadonlyArray<{ kind: HmiActionKind; label: string }> = [
  { kind: 'none', label: 'No action' },
  { kind: 'show', label: 'Show a screen' },
  { kind: 'back', label: 'Go back' },
  { kind: 'signOut', label: 'Sign out' },
  { kind: 'lock', label: 'Lock the panel' },
  { kind: 'calibrate', label: 'Calibrate touch' },
  { kind: 'set', label: 'Set a variable' },
  { kind: 'toggle', label: 'Toggle a variable' },
  { kind: 'code', label: 'ST code' },
]

const VARIABLE = '[A-Za-z_]\\w*\\.[A-Za-z_]\\w*'
const SHOW = /^HMI_Show\s*\(\s*HMI_SCREEN\s*#\s*([A-Za-z_]\w*)\s*\)\s*;?$/i
const BACK = /^HMI_Back\s*\(\s*\)\s*;?$/i
const SIGN_OUT = /^HMI_SignOut\s*\(\s*\)\s*;?$/i
const LOCK = /^HMI_Lock\s*\(\s*\)\s*;?$/i
const CALIBRATE = /^HMI_Calibrate\s*\(\s*\)\s*;?$/i
const TOGGLE = new RegExp(`^(${VARIABLE})\\s*:=\\s*NOT\\s+(${VARIABLE})\\s*;?$`, 'i')
const SET = new RegExp(`^(${VARIABLE})\\s*:=\\s*([^;]+?)\\s*;?$`, 'i')

/** The action an event's code is, or `code` when it is anything else. */
export function actionOf(code: string): HmiAction {
  const text = code.trim()
  if (text === '') return { kind: 'none' }
  const show = SHOW.exec(text)
  if (show) return { kind: 'show', screen: show[1] }
  if (BACK.test(text)) return { kind: 'back' }
  if (SIGN_OUT.test(text)) return { kind: 'signOut' }
  if (LOCK.test(text)) return { kind: 'lock' }
  if (CALIBRATE.test(text)) return { kind: 'calibrate' }
  const toggle = TOGGLE.exec(text)
  if (toggle && toggle[1].toUpperCase() === toggle[2].toUpperCase()) return { kind: 'toggle', variable: toggle[1] }
  const set = SET.exec(text)
  if (set && !/[;\n]/.test(set[2])) return { kind: 'set', variable: set[1], value: set[2] }
  return { kind: 'code', code: text }
}

/** The ST an action is written as; null for no action, or for an action not filled in yet. */
export function actionCode(action: HmiAction): string | null {
  switch (action.kind) {
    case 'none':
      return null
    case 'show':
      return action.screen === '' ? null : `HMI_Show(HMI_SCREEN#${action.screen});`
    case 'back':
      return 'HMI_Back();'
    case 'signOut':
      return 'HMI_SignOut();'
    case 'lock':
      return 'HMI_Lock();'
    case 'calibrate':
      return 'HMI_Calibrate();'
    case 'set':
      return action.variable === '' || action.value.trim() === ''
        ? null
        : `${action.variable} := ${action.value.trim()};`
    case 'toggle':
      return action.variable === '' ? null : `${action.variable} := NOT ${action.variable};`
    case 'code':
      return action.code.trim() === '' ? null : action.code.trim()
    default: {
      const unhandled: never = action
      return unhandled
    }
  }
}

/** A new action of `kind`, keeping what it can of `from`. */
export function actionOfKind(kind: HmiActionKind, from: HmiAction): HmiAction {
  switch (kind) {
    case 'none':
      return { kind }
    case 'show':
      return { kind, screen: from.kind === 'show' ? from.screen : '' }
    case 'back':
    case 'signOut':
    case 'lock':
    case 'calibrate':
      return { kind }
    case 'set':
      return { kind, variable: 'variable' in from ? from.variable : '', value: from.kind === 'set' ? from.value : '' }
    case 'toggle':
      return { kind, variable: 'variable' in from ? from.variable : '' }
    case 'code':
      return { kind, code: actionCode(from) ?? '' }
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}
