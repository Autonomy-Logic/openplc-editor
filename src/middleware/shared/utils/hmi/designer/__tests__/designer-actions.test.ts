import { actionCode, actionOf, actionOfKind } from '../designer-actions'

describe('designer actions', () => {
  it('reads an event code back as the action it is', () => {
    expect(actionOf('')).toEqual({ kind: 'none' })
    expect(actionOf('  HMI_Show(HMI_SCREEN#Plant);  ')).toEqual({ kind: 'show', screen: 'Plant' })
    expect(actionOf('HMI_Show( HMI_SCREEN # Plant )')).toEqual({ kind: 'show', screen: 'Plant' })
    expect(actionOf('HMI_Back();')).toEqual({ kind: 'back' })
    expect(actionOf('Main.Run := NOT main.run;')).toEqual({ kind: 'toggle', variable: 'Main.Run' })
    expect(actionOf('GVL.Speed := 42;')).toEqual({ kind: 'set', variable: 'GVL.Speed', value: '42' })
    expect(actionOf('Main.Run := NOT Main.Stop;')).toEqual({
      kind: 'set',
      variable: 'Main.Run',
      value: 'NOT Main.Stop',
    })
    expect(actionOf('Main.A := 1; Main.B := 2;')).toEqual({ kind: 'code', code: 'Main.A := 1; Main.B := 2;' })
    expect(actionOf('IF Main.A THEN HMI_Back(); END_IF;').kind).toBe('code')
  })

  it('writes each action as one ST statement, and nothing until it is filled in', () => {
    expect(actionCode({ kind: 'none' })).toBeNull()
    expect(actionCode({ kind: 'show', screen: 'Plant' })).toBe('HMI_Show(HMI_SCREEN#Plant);')
    expect(actionCode({ kind: 'show', screen: '' })).toBeNull()
    expect(actionCode({ kind: 'back' })).toBe('HMI_Back();')
    expect(actionCode({ kind: 'set', variable: 'Main.Speed', value: ' 10 ' })).toBe('Main.Speed := 10;')
    expect(actionCode({ kind: 'set', variable: 'Main.Speed', value: '' })).toBeNull()
    expect(actionCode({ kind: 'toggle', variable: 'Main.Run' })).toBe('Main.Run := NOT Main.Run;')
    expect(actionCode({ kind: 'code', code: '  x := 1;  ' })).toBe('x := 1;')
    expect(actionCode({ kind: 'code', code: ' ' })).toBeNull()
  })

  it('round-trips every action through its code', () => {
    for (const action of [
      { kind: 'show', screen: 'Plant' } as const,
      { kind: 'back' } as const,
      { kind: 'set', variable: 'Main.Speed', value: '10' } as const,
      { kind: 'toggle', variable: 'Main.Run' } as const,
    ])
      expect(actionOf(actionCode(action) ?? '')).toEqual(action)
  })

  it('keeps what it can when the kind changes', () => {
    expect(actionOfKind('toggle', { kind: 'set', variable: 'Main.Run', value: 'TRUE' })).toEqual({
      kind: 'toggle',
      variable: 'Main.Run',
    })
    expect(actionOfKind('code', { kind: 'show', screen: 'Plant' })).toEqual({
      kind: 'code',
      code: 'HMI_Show(HMI_SCREEN#Plant);',
    })
    expect(actionOfKind('show', { kind: 'back' })).toEqual({ kind: 'show', screen: '' })
    expect(actionOfKind('none', { kind: 'back' })).toEqual({ kind: 'none' })
    expect(actionOfKind('back', { kind: 'none' })).toEqual({ kind: 'back' })
    expect(actionOfKind('set', { kind: 'none' })).toEqual({ kind: 'set', variable: '', value: '' })
  })
})
