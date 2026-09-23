/**
 * Repairing aliases saved before the identifier rule existed (DOPE-650).
 *
 * Projects carrying `Motor Start` or `relay-1` are real — the editor accepted
 * them — and they have to keep working. The repair renames rather than drops,
 * because dropping would leave every variable bound to the alias unlocated,
 * which is a silent wrong answer at compile time.
 */
import { describeAliasRename, normalizeAliasName, planAliasNormalization } from '../normalize-aliases'

describe('normalizeAliasName', () => {
  it('replaces a space', () => {
    expect(normalizeAliasName('Motor Start', new Set())).toBe('Motor_Start')
  })

  it('replaces a hyphen', () => {
    expect(normalizeAliasName('relay-1', new Set())).toBe('relay_1')
  })

  it('prefixes a leading digit, which cannot start an identifier', () => {
    expect(normalizeAliasName('1st_relay', new Set())).toBe('_1st_relay')
  })

  it('escapes a reserved word, which is legal-looking but not accepted', () => {
    expect(normalizeAliasName('VAR', new Set())).toBe('VAR_alias')
  })

  it('numbers around a name already taken', () => {
    expect(normalizeAliasName('Motor Start', new Set(['motor_start']))).toBe('Motor_Start2')
  })

  it('keeps numbering until it finds a free name', () => {
    const taken = new Set(['motor_start', 'motor_start2', 'motor_start3'])
    expect(normalizeAliasName('Motor Start', taken)).toBe('Motor_Start4')
  })
})

describe('planAliasNormalization', () => {
  it('leaves a project whose aliases are already legal completely alone', () => {
    expect(planAliasNormalization(['Motor_Start', 'relay_1', '_spare'])).toEqual([])
  })

  it('plans only the aliases that have to change', () => {
    const plan = planAliasNormalization(['Motor Start', 'Already_Fine', 'relay-1'])
    expect(plan.map((rename) => [rename.from, rename.to])).toEqual([
      ['Motor Start', 'Motor_Start'],
      ['relay-1', 'relay_1'],
    ])
  })

  it('does not rename onto a legal alias that is staying put', () => {
    // `Motor_Start` is already claimed by another channel, so the repaired one
    // has to land somewhere else or the two would collide.
    const plan = planAliasNormalization(['Motor_Start', 'Motor Start'])
    expect(plan).toHaveLength(1)
    expect(plan[0].to).toBe('Motor_Start2')
  })

  it('does not collide two repaired aliases with each other', () => {
    const plan = planAliasNormalization(['Motor Start', 'Motor-Start'])
    expect(plan.map((rename) => rename.to)).toEqual(['Motor_Start', 'Motor_Start2'])
  })

  it('ignores a blank alias, which just means the channel is unnamed', () => {
    expect(planAliasNormalization(['', '   '])).toEqual([])
  })

  it('explains the repair in terms the console can show', () => {
    const [rename] = planAliasNormalization(['Motor Start'])
    expect(describeAliasRename(rename)).toContain('"Motor Start"')
    expect(describeAliasRename(rename)).toContain('"Motor_Start"')
    expect(describeAliasRename(rename)).toContain('Variables bound to it were updated')
  })
})

/**
 * What the repair leaves alone.
 *
 * It renames what the parser cannot read back, and nothing else. It used to
 * consult the editor's identifier list, which also holds every standard
 * function name, so opening a project silently renamed pins called `Max`,
 * `Step` or `Limit` — names STruC++ reads as an `AT` operand without complaint.
 */
describe('a project whose aliases the parser accepts is not touched', () => {
  it.each(['Max', 'Min', 'Step', 'TP', 'Left', 'Time', 'Limit', 'Move', 'Sel'])('leaves %s alone', (alias) => {
    expect(planAliasNormalization([alias])).toEqual([])
  })

  it('still repairs the ones it cannot read', () => {
    expect(planAliasNormalization(['Max', 'Motor Start', 'relay-1', 'Set'])).toEqual([
      { from: 'Motor Start', to: 'Motor_Start', reason: 'contains illegal characters' },
      { from: 'relay-1', to: 'relay_1', reason: 'contains illegal characters' },
      { from: 'Set', to: 'Set_alias', reason: 'is a reserved word' },
    ])
  })
})
