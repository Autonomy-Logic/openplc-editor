import type { PLCInstance, PLCTask, PLCVariable } from '../../../../middleware/shared/ports/types'
import { parseVariableXml } from './variable-xml'
import { asArray, asRecord, asString } from './xml-node'

export interface ParsedConfiguration {
  resource: {
    tasks: PLCTask[]
    instances: PLCInstance[]
    globalVariables: PLCVariable[]
  }
}

// Reverse of `oldEditorInstanceToXml` (xml-generator/old-editor/instances-xml.ts).
// An Interrupt task has no `@interval` in the XML (only Cyclic tasks do), so
// its original interval value can't be recovered here — it comes back as ''.
export function parseConfigurationXml(instancesXml: unknown): ParsedConfiguration {
  const configuration = asRecord(asRecord(asRecord(instancesXml).configurations).configuration)
  const resource = asRecord(configuration.resource)

  const tasks: PLCTask[] = []
  const instances: PLCInstance[] = []

  for (const taskXmlRaw of asArray(resource.task)) {
    const taskXml = asRecord(taskXmlRaw)
    const name = asString(taskXml['@name'])
    const interval = taskXml['@interval']
    const triggering: 'Cyclic' | 'Interrupt' = typeof interval === 'string' ? 'Cyclic' : 'Interrupt'

    tasks.push({
      name,
      triggering,
      interval: typeof interval === 'string' ? interval : '',
      priority: Number(asString(taskXml['@priority'])),
    })

    for (const poRaw of asArray(taskXml.pouInstance)) {
      const po = asRecord(poRaw)
      instances.push({ name: asString(po['@name']), task: name, program: asString(po['@typeName']) })
    }
  }

  const globalVariables: PLCVariable[] = asArray(asRecord(configuration.globalVars).variable).map((v) =>
    parseVariableXml(v, 'global'),
  )

  return { resource: { tasks, instances, globalVariables } }
}
