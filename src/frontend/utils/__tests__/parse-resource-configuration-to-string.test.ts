import type { PLCInstance, PLCTask } from '../../../middleware/shared/ports/types'
import { parseResourceConfigurationToString } from '../parse-resource-configuration-to-string'

describe('parseResourceConfigurationToString', () => {
  it('returns a comment when both lists are empty', () => {
    expect(parseResourceConfigurationToString([], [])).toBe('(* No tasks or program instances declared. *)')
  })

  it('generates a single task with explicit interval and priority', () => {
    const tasks: PLCTask[] = [{ name: 'Task0', triggering: 'Cyclic', interval: 'T#50ms', priority: 3 }]
    const result = parseResourceConfigurationToString(tasks, [])

    expect(result).toContain('CONFIGURATION Config0')
    expect(result).toContain('RESOURCE Res0 ON PLC')
    expect(result).toContain('TASK Task0(INTERVAL := T#50ms, PRIORITY := 3);')
    expect(result).toContain('END_RESOURCE')
    expect(result).toContain('END_CONFIGURATION')
  })

  it('uses default interval when task interval is empty', () => {
    const tasks: PLCTask[] = [{ name: 'Task0', triggering: 'Cyclic', interval: '', priority: 2 }]
    const result = parseResourceConfigurationToString(tasks, [])

    expect(result).toContain('INTERVAL := T#20ms')
  })

  it('uses default interval when task interval is undefined', () => {
    const tasks: PLCTask[] = [
      { name: 'Task0', triggering: 'Cyclic', interval: undefined as unknown as string, priority: 2 },
    ]
    const result = parseResourceConfigurationToString(tasks, [])

    expect(result).toContain('INTERVAL := T#20ms')
  })

  it('uses default interval when task interval is whitespace', () => {
    const tasks: PLCTask[] = [{ name: 'Task0', triggering: 'Cyclic', interval: '   ', priority: 2 }]
    const result = parseResourceConfigurationToString(tasks, [])

    expect(result).toContain('INTERVAL := T#20ms')
  })

  it('uses default priority when priority is undefined', () => {
    const tasks: PLCTask[] = [
      { name: 'Task0', triggering: 'Cyclic', interval: 'T#10ms', priority: undefined as unknown as number },
    ]
    const result = parseResourceConfigurationToString(tasks, [])

    expect(result).toContain('PRIORITY := 1')
  })

  it('generates instances', () => {
    const tasks: PLCTask[] = []
    const instances: PLCInstance[] = [{ name: 'Inst0', task: 'Task0', program: 'Main' }]
    const result = parseResourceConfigurationToString(tasks, instances)

    expect(result).toContain('PROGRAM Inst0 WITH Task0 : Main;')
  })

  it('generates both tasks and instances with a blank line separator', () => {
    const tasks: PLCTask[] = [{ name: 'Task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }]
    const instances: PLCInstance[] = [{ name: 'Inst0', task: 'Task0', program: 'Main' }]
    const result = parseResourceConfigurationToString(tasks, instances)

    const lines = result.split('\n')
    const taskLineIdx = lines.findIndex((l) => l.includes('TASK Task0'))
    // There should be a blank line between the task and the instance
    expect(lines[taskLineIdx + 1]).toBe('')
    expect(result).toContain('PROGRAM Inst0 WITH Task0 : Main;')
  })

  it('generates multiple tasks and multiple instances', () => {
    const tasks: PLCTask[] = [
      { name: 'Task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 },
      { name: 'Task1', triggering: 'Interrupt', interval: 'T#100ms', priority: 5 },
    ]
    const instances: PLCInstance[] = [
      { name: 'Inst0', task: 'Task0', program: 'Main' },
      { name: 'Inst1', task: 'Task1', program: 'Secondary' },
    ]
    const result = parseResourceConfigurationToString(tasks, instances)

    expect(result).toContain('TASK Task0(INTERVAL := T#10ms, PRIORITY := 1);')
    expect(result).toContain('TASK Task1(INTERVAL := T#100ms, PRIORITY := 5);')
    expect(result).toContain('PROGRAM Inst0 WITH Task0 : Main;')
    expect(result).toContain('PROGRAM Inst1 WITH Task1 : Secondary;')
  })
})
