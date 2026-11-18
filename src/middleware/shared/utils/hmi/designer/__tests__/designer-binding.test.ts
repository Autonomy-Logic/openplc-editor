import type { HmiWidgetBinding } from '../../../../ports/hmi-preview-types'
import { bindableVariables, bindRefusal, canBind, momentaryCode, momentaryOf, writesMain } from '../designer-binding'

const pressed: HmiWidgetBinding = { name: 'Pressed', direction: 'output', type: 'BOOL' }
const level: HmiWidgetBinding = { name: 'Value', direction: 'input', type: 'REAL' }
const text: HmiWidgetBinding = { name: 'Text', direction: 'input', type: 'STRING' }
const momentary = { value: 'Pressed', changed: 'Changed' }

describe('designer binding', () => {
  it('wires only BOOL variables to a BOOL output', () => {
    expect(canBind(pressed, 'BOOL')).toBe(true)
    expect(canBind(pressed, 'bool')).toBe(true)
    expect(canBind(pressed, 'REAL')).toBe(false)
    expect(canBind(pressed, 'INT')).toBe(false)
    expect(canBind(pressed, 'STRING')).toBe(false)
  })

  it('wires any number to a numeric input, and strings to strings', () => {
    expect(canBind(level, 'INT')).toBe(true)
    expect(canBind(level, 'LREAL')).toBe(true)
    expect(canBind(level, 'BOOL')).toBe(false)
    expect(canBind(level, 'STRING(20)')).toBe(false)
    expect(canBind(text, 'STRING(20)')).toBe(true)
    expect(canBind(text, 'STRING')).toBe(true)
    expect(canBind(text, 'DINT')).toBe(false)
  })

  it('wires time variables by their short or long type names, and no numbers to them', () => {
    const stamp: HmiWidgetBinding = { name: 'Value', direction: 'input', type: 'DT' }
    const shift: HmiWidgetBinding = { name: 'Value', direction: 'input', type: 'TOD' }
    expect(canBind(stamp, 'DT')).toBe(true)
    expect(canBind(stamp, 'DATE_AND_TIME')).toBe(true)
    expect(canBind(shift, 'TIME_OF_DAY')).toBe(true)
    expect(canBind(stamp, 'TOD')).toBe(false)
    expect(canBind(stamp, 'LINT')).toBe(false)
    expect(canBind(level, 'TIME')).toBe(false)
  })

  it('lists the variables that fit', () => {
    const variables = [
      { path: 'Main.Run', type: 'BOOL' },
      { path: 'Main.Speed', type: 'REAL' },
      { path: 'GVL.Count', type: 'DINT' },
    ]
    expect(bindableVariables(pressed, variables, true).map((v) => v.path)).toEqual(['Main.Run'])
    expect(bindableVariables(level, variables, false).map((v) => v.path)).toEqual(['Main.Speed', 'GVL.Count'])
  })

  it('offers a CONSTANT only to a binding that never writes it', () => {
    const variables = [
      { path: 'MaxL', type: 'REAL', constant: true as const },
      { path: 'Main.Speed', type: 'REAL' },
    ]
    expect(bindableVariables(level, variables, false).map((v) => v.path)).toEqual(['MaxL', 'Main.Speed'])
    expect(bindableVariables(level, variables, true).map((v) => v.path)).toEqual(['Main.Speed'])
    expect(writesMain({ main: level })).toBe(false)
    expect(writesMain({ main: level, twoWay: { value: 'Value', changed: 'Changed', newValue: 'NewValue' } })).toBe(true)
    expect(writesMain({ main: pressed })).toBe(true)
    expect(writesMain({ main: level, momentary })).toBe(true)
  })

  it('writes a momentary binding as one statement and reads it back', () => {
    const on = { variable: 'Main.Run', whilePressed: true }
    const off = { variable: 'Main.Stop', whilePressed: false }
    expect(momentaryCode('Start', momentary, on)).toBe('Main.Run := Start.Pressed;')
    expect(momentaryCode('Start', momentary, off)).toBe('Main.Stop := NOT Start.Pressed;')
    expect(momentaryOf(momentaryCode('Start', momentary, on), 'Start', momentary)).toEqual(on)
    expect(momentaryOf(momentaryCode('Start', momentary, off), 'Start', momentary)).toEqual(off)
    expect(momentaryOf(' main . run := not START.pressed ', 'Start', momentary)).toEqual({
      variable: 'main.run',
      whilePressed: false,
    })
    const path = { variable: 'instance0.Main.Run', whilePressed: true }
    expect(momentaryOf(momentaryCode('Start', momentary, path), 'Start', momentary)).toEqual(path)
    expect(momentaryOf('Alarm := Start.Pressed;', 'Start', momentary)).toEqual({
      variable: 'Alarm',
      whilePressed: true,
    })
  })

  it('does not read other code as a momentary binding', () => {
    expect(momentaryOf('Main.Run := Other.Pressed;', 'Start', momentary)).toBeNull()
    expect(momentaryOf('Main.Run := Start.Clicked;', 'Start', momentary)).toBeNull()
    expect(momentaryOf('Main.Run := TRUE;', 'Start', momentary)).toBeNull()
    expect(momentaryOf('Main.Run := Start.Pressed; Main.B := 1;', 'Start', momentary)).toBeNull()
  })

  it('keeps block outputs and constants off bindings that write, and allows them on ones that only show', () => {
    const vars = [
      { path: 'instance0.Main.F.B', type: 'BOOL', blockOutput: true as const },
      { path: 'instance0.Main.F.A', type: 'BOOL' },
      { path: 'Limit', type: 'BOOL', constant: true as const },
    ]
    const sw = { name: 'Value', direction: 'input' as const, type: 'BOOL' }
    expect(bindableVariables(sw, vars, true).map((v) => v.path)).toEqual(['instance0.Main.F.A'])
    expect(bindableVariables(sw, vars, false).map((v) => v.path)).toEqual([
      'instance0.Main.F.B',
      'instance0.Main.F.A',
      'Limit',
    ])
    const toggle = { main: sw, twoWay: { value: 'Value', changed: 'Changed', newValue: 'NewValue' } }
    expect(bindRefusal('S', toggle, 'instance0.Main.F.B', vars[0])).toBe(
      'instance0.Main.F.B is an output of a function block; S would write it',
    )
    expect(bindRefusal('S', toggle, 'Limit', vars[2])).toBe('Limit is a CONSTANT; S would write it')
    expect(bindRefusal('S', toggle, 'instance0.Main.F.A', vars[1])).toBeNull()
    expect(bindRefusal('L', { main: sw }, 'instance0.Main.F.B', vars[0])).toBeNull()
    expect(bindRefusal('B', { main: pressed, momentary }, 'instance0.Main.F.B', vars[0])).toContain(
      'output of a function block',
    )
    expect(bindRefusal('N', { main: level }, 'X', { path: 'X', type: 'STRING' })).toBe(
      'N.Value takes REAL; X is STRING',
    )
    expect(bindRefusal('N', { main: level }, 'instance0.Main.M[2,1]', undefined)).toBeNull()
    expect(bindRefusal('N', {}, 'X', undefined)).toBe('N has no input a variable can show')
  })

  it('reads a momentary binding to an array element, multi-dimensional included', () => {
    const code = momentaryCode('B', momentary, { variable: 'instance0.Main.M[2,1]', whilePressed: true })
    expect(momentaryOf(code, 'B', momentary)).toEqual({ variable: 'instance0.Main.M[2,1]', whilePressed: true })
    expect(momentaryOf('instance0.Main.Arr[ 3 ] := NOT B.Pressed;', 'B', momentary)).toEqual({
      variable: 'instance0.Main.Arr[3]',
      whilePressed: false,
    })
  })
})
