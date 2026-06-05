import { PLCConfiguration } from '@root/middleware/shared/ports/open-plc-types'
import { BaseXml } from '@root/middleware/shared/ports/xml-types/codesys'
import { PouInstance, TaskXML } from '@root/middleware/shared/ports/xml-types/codesys/task/task-diagram'

export const codeSysInstanceToXml = (xml: BaseXml, configuration: PLCConfiguration) => {
  const { instances, tasks, globalVariables } = configuration.resource

  const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority)

  sortedTasks.forEach((task) => {
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

    if (!xml.project.instances.configurations.configuration.globalVars) {
      xml.project.instances.configurations.configuration.globalVars = {
        variable: [],
      }
    }
    if (!xml.project.instances.configurations.configuration.globalVars.variable) {
      xml.project.instances.configurations.configuration.globalVars.variable = []
    }
    xml.project.instances.configurations.configuration.globalVars.variable.push(v)
  })

  return xml
}
