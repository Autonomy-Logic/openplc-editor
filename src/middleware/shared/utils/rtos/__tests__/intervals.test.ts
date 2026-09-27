/**
 * Task periods RTOS mode can honour.
 *
 * Tasks are released on the RTOS tick, so a period must be a whole, non-zero
 * number of ticks. The check refuses anything else rather than letting the
 * firmware round a period the user wrote.
 */

import { findIntervalsOffTick } from '../intervals'

const MS = 1_000_000

describe('findIntervalsOffTick', () => {
  it('accepts whole-millisecond periods on a 1 ms tick', () => {
    const tasks = [
      { name: 'main', triggering: 'Cyclic', interval: 'T#10ms' },
      { name: 'net', triggering: 'Cyclic', interval: 'T#1ms' },
      { name: 'slow', triggering: 'Cyclic', interval: 'T#1s' },
      { name: 'unit', interval: 'T#1.5s' },
    ]
    expect(findIntervalsOffTick(tasks, MS)).toEqual([])
  })

  it('refuses a period that is not a whole number of ticks', () => {
    const problems = findIntervalsOffTick(
      [
        { name: 'fast', triggering: 'Cyclic', interval: 'T#500us' },
        { name: 'odd', triggering: 'Cyclic', interval: 'T#1.5ms' },
      ],
      MS,
    )
    expect(problems.map((problem) => problem.task)).toEqual(['fast', 'odd'])
    expect(problems[0].reason).toContain('1 ms')
  })

  it('refuses a zero period on a cyclic task', () => {
    const [problem] = findIntervalsOffTick([{ name: 'zero', triggering: 'Cyclic', interval: 'T#0ms' }], MS)
    expect(problem.reason).toContain('above zero')
  })

  it('reports an interval it cannot parse instead of throwing', () => {
    const [problem] = findIntervalsOffTick([{ name: 'bad', triggering: 'Cyclic', interval: 'soon' }], MS)
    expect(problem.task).toBe('bad')
    expect(problem.reason).toContain('Invalid TIME value')
  })

  it('skips Interrupt (SINGLE) tasks, which are not periodic', () => {
    expect(findIntervalsOffTick([{ name: 'isr', triggering: 'Interrupt', interval: '' }], MS)).toEqual([])
  })

  it('names the tick in the unit it divides into', () => {
    const [micro] = findIntervalsOffTick([{ name: 'a', interval: 'T#300us' }], 250_000)
    expect(micro.reason).toContain('250 µs')
    const [nano] = findIntervalsOffTick([{ name: 'b', interval: 'T#1us' }], 333)
    expect(nano.reason).toContain('333 ns')
  })
})
