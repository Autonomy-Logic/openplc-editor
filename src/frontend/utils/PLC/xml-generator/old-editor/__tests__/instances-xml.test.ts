import type { PLCConfiguration } from '@root/middleware/shared/ports/open-plc-types'

import { getBaseOldEditorXmlStructure } from '../base-xml'
import { oldEditorInstanceToXml } from '../instances-xml'

const makeBaseXml = () => getBaseOldEditorXmlStructure()

const makeConfig = (overrides: Partial<PLCConfiguration['resource']> = {}): PLCConfiguration => ({
  resource: {
    tasks: [],
    instances: [],
    globalVariables: [],
    ...overrides,
  },
})

describe('oldEditorInstanceToXml', () => {
  describe('tasks', () => {
    it('adds a cyclic task with matching instances', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        tasks: [{ name: 'Task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
        instances: [{ name: 'Inst0', task: 'Task0', program: 'main' }],
      })
      const result = oldEditorInstanceToXml(xml, config)
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
      })
      const result = oldEditorInstanceToXml(xml, config)
      const task = result.project.instances.configurations.configuration.resource.task[0]
      expect(task['@interval']).toBeNull()
      expect(task['@single']).toBe('')
    })

    it('initializes task array when undefined', () => {
      const xml = makeBaseXml()
      ;(xml.project.instances.configurations.configuration.resource as unknown as Record<string, unknown>).task =
        undefined
      const config = makeConfig({
        tasks: [{ name: 'T', triggering: 'Cyclic', interval: 'T#10ms', priority: 0 }],
      })
      const result = oldEditorInstanceToXml(xml, config)
      expect(result.project.instances.configurations.configuration.resource.task).toHaveLength(1)
    })
  })

  describe('globalVariables', () => {
    it('adds a global variable with location, initial value and documentation', () => {
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
      const result = oldEditorInstanceToXml(xml, config)
      const gv = result.project.instances.configurations.configuration.globalVars!.variable![0] as unknown as Record<
        string,
        unknown
      >
      expect(gv['@name']).toBe('gVar')
      expect(gv['@address']).toBe('%MW0')
      expect(gv.type).toEqual({ INT: '' })
      expect((gv.initialValue as Record<string, Record<string, string>>).simpleValue['@value']).toBe('42')
      expect((gv.documentation as Record<string, Record<string, string>>)['xhtml:p'].$).toBe('A global var')
    })

    it('sets address to undefined when location is empty', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          { name: 'g', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' },
        ],
      })
      const result = oldEditorInstanceToXml(xml, config)
      const gv = result.project.instances.configurations.configuration.globalVars!.variable![0] as unknown as Record<
        string,
        unknown
      >
      expect(gv['@address']).toBeUndefined()
    })

    it('sets documentation to space when empty string', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          { name: 'g', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' },
        ],
      })
      const result = oldEditorInstanceToXml(xml, config)
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
          { name: 'g', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' },
        ],
      })
      const result = oldEditorInstanceToXml(xml, config)
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
          { name: 'x', type: { definition: 'base-type', value: 'DINT' }, location: '', documentation: '' },
        ],
      })
      const result = oldEditorInstanceToXml(xml, config)
      expect(result.project.instances.configurations.configuration.globalVars!.variable).toHaveLength(1)
    })

    it('initializes globalVars.variable when globalVars exists but variable is undefined', () => {
      const xml = makeBaseXml()
      ;(xml.project.instances.configurations.configuration as unknown as Record<string, unknown>).globalVars = {}
      const config = makeConfig({
        globalVariables: [
          { name: 'x', type: { definition: 'base-type', value: 'DINT' }, location: '', documentation: '' },
        ],
      })
      const result = oldEditorInstanceToXml(xml, config)
      expect(result.project.instances.configurations.configuration.globalVars!.variable).toHaveLength(1)
    })

    it('handles derived type variable', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          { name: 'g', type: { definition: 'derived', value: 'MyType' }, location: '', documentation: 'doc' },
        ],
      })
      const result = oldEditorInstanceToXml(xml, config)
      const gv = result.project.instances.configurations.configuration.globalVars!.variable![0] as unknown as Record<
        string,
        unknown
      >
      expect(gv.type).toEqual({ derived: { '@name': 'MyType' } })
    })

    it('handles array type variable', () => {
      const xml = makeBaseXml()
      const config = makeConfig({
        globalVariables: [
          {
            name: 'g',
            type: {
              definition: 'array',
              value: '',
              data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..9' }] },
            },
            location: '',
            documentation: '',
          },
        ],
      })
      const result = oldEditorInstanceToXml(xml, config)
      const gv = result.project.instances.configurations.configuration.globalVars!.variable![0] as unknown as Record<
        string,
        unknown
      >
      expect((gv.type as Record<string, unknown>).array).toBeDefined()
    })
  })

  it('returns the xml object', () => {
    const xml = makeBaseXml()
    const result = oldEditorInstanceToXml(xml, makeConfig())
    expect(result).toBe(xml)
  })
})
