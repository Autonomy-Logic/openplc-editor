import { getNextName } from '../next-name'

describe('getNextName', () => {
  it('returns the next number after the highest existing suffix', () => {
    expect(getNextName('Task0', ['Task0', 'Task1'])).toBe('Task2')
  })

  it('returns base + 0 when no existing names match', () => {
    expect(getNextName('Item0', [])).toBe('Item0')
  })

  it('strips trailing digits from the base name', () => {
    expect(getNextName('Var123', ['Var0', 'Var5'])).toBe('Var6')
  })

  it('handles base name with no trailing digits', () => {
    expect(getNextName('Task', ['Task0', 'Task3'])).toBe('Task4')
  })

  it('ignores names that do not start with the base prefix', () => {
    expect(getNextName('Task0', ['Other0', 'Other1'])).toBe('Task0')
  })

  it('is case-insensitive when matching prefixes', () => {
    expect(getNextName('task0', ['Task0', 'TASK2'])).toBe('task3')
  })

  it('ignores entries whose suffix is not purely numeric', () => {
    expect(getNextName('Var0', ['Var0', 'Var1abc', 'Var2'])).toBe('Var3')
  })

  it('handles a single existing entry', () => {
    expect(getNextName('X0', ['X0'])).toBe('X1')
  })

  it('handles gaps in numbering', () => {
    expect(getNextName('Item0', ['Item0', 'Item5', 'Item10'])).toBe('Item11')
  })
})
