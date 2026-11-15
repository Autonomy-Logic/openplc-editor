import type { HmiWidgetBinding } from '../../../../ports/hmi-preview-types'
import { bindableVariables, canBind, momentaryCode, momentaryOf } from '../designer-binding'

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

  it('lists the variables that fit', () => {
    const variables = [
      { path: 'Main.Run', type: 'BOOL' },
      { path: 'Main.Speed', type: 'REAL' },
      { path: 'GVL.Count', type: 'DINT' },
    ]
    expect(bindableVariables(pressed, variables).map((v) => v.path)).toEqual(['Main.Run'])
    expect(bindableVariables(level, variables).map((v) => v.path)).toEqual(['Main.Speed', 'GVL.Count'])
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
})
