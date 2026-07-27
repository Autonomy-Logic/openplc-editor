import { parseConfigurationXml } from '../instances-xml'

describe('parseConfigurationXml', () => {
  it('parses a Cyclic task with instances', () => {
    const result = parseConfigurationXml({
      configurations: {
        configuration: {
          resource: {
            task: [
              {
                '@name': 'task0',
                '@priority': '0',
                '@interval': 'T#20ms',
                pouInstance: [{ '@name': 'inst0', '@typeName': 'main' }],
              },
            ],
          },
        },
      },
    })
    expect(result.resource.tasks).toEqual([{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }])
    expect(result.resource.instances).toEqual([{ name: 'inst0', task: 'task0', program: 'main' }])
  })

  it('parses an Interrupt task (no @interval) with empty interval', () => {
    const result = parseConfigurationXml({
      configurations: { configuration: { resource: { task: { '@name': 'irq', '@priority': '1' } } } },
    })
    expect(result.resource.tasks).toEqual([{ name: 'irq', triggering: 'Interrupt', interval: '', priority: 1 }])
  })

  it('parses global variables', () => {
    const result = parseConfigurationXml({
      configurations: {
        configuration: {
          resource: {},
          globalVars: { variable: [{ '@name': 'gvar', type: { BOOL: '' } }] },
        },
      },
    })
    expect(result.resource.globalVariables).toEqual([
      {
        name: 'gvar',
        class: 'global',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        initialValue: null,
        documentation: '',
      },
    ])
  })

  it('defaults to empty tasks/instances/globalVariables when absent', () => {
    const result = parseConfigurationXml({})
    expect(result).toEqual({ resource: { tasks: [], instances: [], globalVariables: [] } })
  })
})
