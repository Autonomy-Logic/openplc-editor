/**
 * Project the editor's IPC schema-shape `PLCProjectData`
 * (`backend/shared/types/PLC/open-plc.ts`, z.infer of
 * `PLCProjectDataSchema`) into the transpiler's minimal IR.
 *
 * Lives alongside the transpiler because both types come from
 * `backend/shared/` — no layer violation.  The port-shape adapter
 * lives outside (under `middleware/adapters/`) because port-shape
 * types are middleware-scoped.
 */

import type { PLCProjectData as SchemaPLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import { fbdToXml } from '@root/frontend/utils/PLC/xml-generator/old-editor/language/fbd-xml'
import { ladderToXml } from '@root/frontend/utils/PLC/xml-generator/old-editor/language/ladder-xml'

import { xmlObjectToLdBody } from './ld/from-xmlbuilder'
import type {
  TranspileBody,
  TranspileDataType,
  TranspileInstance,
  TranspilePou,
  TranspileProject,
  TranspileTask,
  TranspileVariable,
  TranspileVariableType,
} from './types'

export type SchemaProjectData = SchemaPLCProjectData

export function fromSchemaShape(data: SchemaPLCProjectData): TranspileProject {
  return {
    pous: data.pous.map(projectPou),
    dataTypes: (data.dataTypes ?? []).map(projectDataType),
    configuration: {
      tasks: (data.configuration?.resource?.tasks ?? []).map(projectTask),
      instances: (data.configuration?.resource?.instances ?? []).map(projectInstance),
      globalVariables: (data.configuration?.resource?.globalVariables ?? []).map((v) =>
        projectVariable(v as SchemaVariable),
      ),
    },
  }
}

type SchemaPou = SchemaPLCProjectData['pous'][number]
type SchemaVariable = NonNullable<SchemaPou['data']['variables']>[number]
type SchemaDataType = NonNullable<SchemaPLCProjectData['dataTypes']>[number]
type SchemaStructureVariable = Extract<SchemaDataType, { derivation: 'structure' }>['variable'][number]
type SchemaTask = SchemaPLCProjectData['configuration']['resource']['tasks'][number]
type SchemaInstance = SchemaPLCProjectData['configuration']['resource']['instances'][number]
type SchemaBody = SchemaPou['data']['body']

function projectPou(pou: SchemaPou): TranspilePou {
  const variables = (pou.data.variables ?? []).map(projectVariable)
  return {
    name: pou.data.name,
    pouType: pou.type,
    documentation: pou.data.documentation ?? '',
    interface: {
      variables,
      ...(pou.type === 'function' ? { returnType: stringifyReturnType(pou.data.returnType) } : {}),
    },
    body: projectBody(pou.data.body),
  }
}

function projectBody(body: SchemaBody): TranspileBody {
  switch (body.language) {
    case 'st':
    case 'il':
    case 'python':
    case 'cpp':
      return { language: body.language, value: body.value }
    case 'ld': {
      const xmlBody = ladderToXml(body.value.rungs as Parameters<typeof ladderToXml>[0]) as unknown as Record<
        string,
        unknown
      >
      return { language: 'ld', xmlBody, ldBody: xmlObjectToLdBody(xmlBody) }
    }
    case 'fbd': {
      const xmlBody = fbdToXml(body.value.rung as Parameters<typeof fbdToXml>[0]) as unknown as Record<string, unknown>
      return { language: 'fbd', xmlBody, ldBody: xmlObjectToLdBody(xmlBody) }
    }
    case 'sfc':
      // Schema's SFC body is currently typed as `string`; fall back
      // to ST passthrough until the SFC pipeline ports JSON-native.
      return { language: 'st', value: body.value }
    default: {
      const unreachable: never = body
      throw new Error(`Unknown body language: ${JSON.stringify(unreachable)}`)
    }
  }
}

function projectVariable(v: SchemaVariable): TranspileVariable {
  return {
    name: v.name,
    type: projectVariableType(v.type),
    ...(v.class !== undefined ? { class: normalizeVarClass(v.class) } : {}),
    ...(v.location !== undefined && v.location !== '' ? { location: v.location } : {}),
    ...(v.initialValue !== undefined && v.initialValue !== null && v.initialValue !== ''
      ? { initialValue: v.initialValue }
      : {}),
    ...(v.documentation !== undefined && v.documentation !== '' ? { documentation: v.documentation } : {}),
  }
}

function normalizeVarClass(cls: NonNullable<SchemaVariable['class']>): TranspileVariable['class'] {
  // Schema's variable class includes 'global'; the IR doesn't (global
  // vars live under configuration.globalVariables, not in a POU
  // interface).  Collapse to 'local' for the projection — matches the
  // port-shape adapter's normalisation.
  if (cls === 'global') return 'local'
  return cls
}

function projectStructureVariable(v: SchemaStructureVariable): TranspileVariable {
  const initial = v.initialValue?.simpleValue?.value
  return {
    name: v.name,
    type: projectStructureVariableType(v.type),
    ...(initial !== undefined && initial !== '' ? { initialValue: initial } : {}),
  }
}

function projectVariableType(type: SchemaVariable['type']): TranspileVariableType {
  if (type.definition === 'array') {
    return {
      definition: 'array',
      data: {
        dimensions: type.data.dimensions.map((d) => ({ dimension: d.dimension })),
        baseType: { value: type.data.baseType.value },
      },
    }
  }
  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    return { definition: type.definition, value: type.value }
  }
  return { definition: 'base-type', value: type.value }
}

function projectStructureVariableType(type: SchemaStructureVariable['type']): TranspileVariableType {
  if (type.definition === 'array') {
    return {
      definition: 'array',
      data: {
        dimensions: type.data.dimensions.map((d) => ({ dimension: d.dimension })),
        baseType: { value: type.data.baseType.value },
      },
    }
  }
  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    return { definition: type.definition, value: type.value }
  }
  return { definition: 'base-type', value: type.value }
}

function projectDataType(dt: SchemaDataType): TranspileDataType {
  if (dt.derivation === 'array') {
    return {
      name: dt.name,
      derivation: 'array',
      dimensions: dt.dimensions.map((d) => ({ dimension: d.dimension })),
      baseType: { value: dt.baseType.value },
      ...(dt.initialValue ? { initialValue: dt.initialValue } : {}),
    }
  }
  if (dt.derivation === 'enumerated') {
    return {
      name: dt.name,
      derivation: 'enumerated',
      values: dt.values.map((v) => ({ description: v.description })),
      ...(dt.initialValue ? { initialValue: dt.initialValue } : {}),
    }
  }
  // structure
  return {
    name: dt.name,
    derivation: 'structure',
    variable: dt.variable.map(projectStructureVariable),
  }
}

function projectTask(task: SchemaTask): TranspileTask {
  return {
    name: task.name,
    priority: task.priority,
    triggering: task.triggering,
    ...(task.triggering === 'Cyclic' ? { interval: task.interval } : { single: task.interval }),
  }
}

function projectInstance(inst: SchemaInstance): TranspileInstance {
  return {
    name: inst.name,
    program: inst.program,
    ...(inst.task ? { task: inst.task } : {}),
  }
}

function stringifyReturnType(returnType: unknown): string {
  return typeof returnType === 'string' ? returnType : 'BOOL'
}
