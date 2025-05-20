import { PLCConfiguration } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data/old-editor'
import { PouInstance, TaskXML } from '@root/types/PLC/xml-data/old-editor/task/task-diagram'

export const instanceToXml = (xml: BaseXml, configuration: PLCConfiguration) => {
  const { instances, tasks, globalVariables } = configuration.resource

  tasks.forEach((task) => {
    const i: PouInstance[] =
      instances
        .filter((i) => i.task === task.name)
        .map((i) => {
          return {
            '@name': i.name,
            '@typeName': i.program,
          }
        }) || []

    const t: TaskXML = {
      '@name': task.name,
      '@priority': task.priority.toString(),
      '@interval': task.triggering === 'Cyclic' ? task.interval.toString() : null,
      '@single': task.triggering === 'Interrupt' ? '' : null,
      pouInstance: i,
    }

    if (!xml.project.instances.configurations.configuration.resource.task) {
      xml.project.instances.configurations.configuration.resource.task = []
    }
    xml.project.instances.configurations.configuration.resource.task.push(t)
  })

  globalVariables.forEach((variable) => {
    const v = {
      '@name': variable.name,
      '@address': variable.location,
      type: {
        [variable.type.value.toUpperCase()]: '',
      },
      initialValue: variable.initialValue
        ? {
            simpleValue: {
              '@value': variable.initialValue,
            },
          }
        : null,
      documentation: {
        'xhtml:p': {
          $: variable.documentation === '' ? ' ' : variable.documentation,
        },
      },
    }

    if (!xml.project.instances.configurations.configuration.resource.globalVars) {
      xml.project.instances.configurations.configuration.resource.globalVars = {
        variable: [],
      }
    }
    if (!xml.project.instances.configurations.configuration.resource.globalVars.variable) {
      xml.project.instances.configurations.configuration.resource.globalVars.variable = []
    }
    xml.project.instances.configurations.configuration.resource.globalVars.variable.push(v)
  })

  return xml
}
