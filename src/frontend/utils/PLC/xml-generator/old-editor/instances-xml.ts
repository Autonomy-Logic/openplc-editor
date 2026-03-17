import { PLCConfiguration } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data/old-editor'
import { PouInstance, TaskXML } from '@root/types/PLC/xml-data/old-editor/task/task-diagram'
import { VariableXML } from '@root/types/PLC/xml-data/old-editor/variable/variable-diagram'

import { convertTypeToXml } from './type-xml'

export const oldEditorInstanceToXml = (xml: BaseXml, configuration: PLCConfiguration) => {
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
    const v: VariableXML = {
      '@name': variable.name,
      '@address': variable.location || undefined,
      type: convertTypeToXml(variable.type),
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
