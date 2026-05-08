import type { PLCConfiguration } from '@root/middleware/shared/ports/open-plc-types'

import { getBaseCodeSysXmlStructure } from '../base-xml'
import { codeSysInstanceToXml } from '../instances-xml'

const makeBaseXml = () => getBaseCodeSysXmlStructure()

const makeConfig = (overrides: Partial<PLCConfiguration['resource']> = {}): PLCConfiguration => ({
  resource: {
    tasks: [],
    instances: [],
    globalVariables: [],
    ...overrides,
  },
})

describe('codeSysInstanceToXml', () => {
  describe('tasks', () => {
    it('adds a cyclic task with matching instances', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        tasks: [{ name: 'Task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
        instances: [{ name: 'Inst0', task: 'Task0', program: 'main' }],
      })
      const result = codeSysInstanceToXml(xml, config)
      const task = result.project.instances.configurations.configuration.resource.task[0]
      expect(task['@name']).toBe('Task0')
      expect(task['@priority']).toBe('0')
      expect(task['@interval']).toBe('T#20ms')
      expect(task['@single']).toBeNull()
      expect(task.pouInstance).toEqual([{ '@name': 'Inst0', '@typeName': 'main' }])
    })

    it('adds an interrupt task', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        tasks: [{ name: 'IntTask', triggering: 'Interrupt', interval: '', priority: 5 }],
        instances: [],
      })
      const result = codeSysInstanceToXml(xml, config)
      const task = result.project.instances.configurations.configuration.resource.task[0]
      expect(task['@interval']).toBeNull()
      expect(task['@single']).toBe('')
      expect(task.pouInstance).toEqual([])
    })

    it('initializes task array when undefined', () => {
      const xml = makeBaseXml()
      ;(xml.project.instances.configurations.configuration.resource as unknown as Record<string, unknown>).task =
        undefined
      const config = makeConfig({
        tasks: [{ name: 'T1', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 }],
      })
      const result = codeSysInstanceToXml(xml, config)
      expect(result.project.instances.configurations.configuration.resource.task).toHaveLength(1)
    })

    it('filters instances by task name', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        tasks: [
          { name: 'A', triggering: 'Cyclic', interval: 'T#10ms', priority: 0 },
          { name: 'B', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 },
        ],
        instances: [
          { name: 'I1', task: 'A', program: 'prog1' },
          { name: 'I2', task: 'B', program: 'prog2' },
          { name: 'I3', task: 'A', program: 'prog3' },
        ],
      })
      const result = codeSysInstanceToXml(xml, config)
      const tasks = result.project.instances.configurations.configuration.resource.task
      expect(tasks[0].pouInstance).toHaveLength(2)
      expect(tasks[1].pouInstance).toHaveLength(1)
    })
  })

  describe('globalVariables', () => {
    it('adds a global variable with initial value and documentation', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          {
            name: 'gVar',
            type: { definition: 'base-type', value: 'INT' },
            location: '%MW0',
            initialValue: '42',
            documentation: 'A global var',
          },
        ],
      })
      const result = codeSysInstanceToXml(xml, config)
      const gv = result.project.instances.configurations.configuration.globalVars!.variable![0]
      expect(gv['@name']).toBe('gVar')
      expect(gv['@address']).toBe('%MW0')
      const gvRecord = gv as unknown as Record<string, unknown>
      expect(gvRecord.type).toEqual({ INT: '' })
      expect((gvRecord.initialValue as Record<string, Record<string, string>>).simpleValue['@value']).toBe('42')
      expect((gvRecord.documentation as Record<string, Record<string, string>>)['xhtml:p'].$).toBe('A global var')
    })

    it('sets documentation to space when empty string', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          {
            name: 'g',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
        ],
      })
      const result = codeSysInstanceToXml(xml, config)
      const gv = result.project.instances.configurations.configuration.globalVars!.variable![0] as unknown as Record<
        string,
        unknown
      >
      expect((gv.documentation as Record<string, Record<string, string>>)['xhtml:p'].$).toBe(' ')
    })

    it('sets initialValue to null when not provided', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          {
            name: 'g',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: 'doc',
          },
        ],
      })
      const result = codeSysInstanceToXml(xml, config)
      const gv = result.project.instances.configurations.configuration.globalVars!.variable![0] as unknown as Record<
        string,
        unknown
      >
      expect(gv.initialValue).toBeNull()
    })

    it('initializes globalVars structure when undefined', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          {
            name: 'x',
            type: { definition: 'base-type', value: 'DINT' },
            location: '',
            documentation: '',
          },
        ],
      })
      const result = codeSysInstanceToXml(xml, config)
      expect(result.project.instances.configurations.configuration.globalVars!.variable).toHaveLength(1)
    })

    it('initializes globalVars.variable when globalVars exists but variable is undefined', () => {
      const xml = makeBaseXml()
      ;(xml.project.instances.configurations.configuration as unknown as Record<string, unknown>).globalVars = {}
      const config = makeConfig({
        globalVariables: [
          {
            name: 'x',
            type: { definition: 'base-type', value: 'DINT' },
            location: '',
            documentation: '',
          },
        ],
      })
      const result = codeSysInstanceToXml(xml, config)
      expect(result.project.instances.configurations.configuration.globalVars!.variable).toHaveLength(1)
    })
  })

  it('returns the xml object', () => {
    const xml = makeBaseXml()
    const result = codeSysInstanceToXml(xml, makeConfig())
    expect(result).toBe(xml)
  })
})
