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
import type { RFFbdBody } from './walker/fbd'
import type { RFBody, RFEdge, RFNode, RFRung } from './walker/types'

export type SchemaProjectData = SchemaPLCProjectData

export function fromSchemaShape(data: SchemaPLCProjectData): TranspileProject {
  const lists = (data as { globalVariableLists?: SchemaGlobalVariableList[] }).globalVariableLists ?? []
  const usableLists = lists.filter((list) => (list.variables ?? []).length > 0)

  return {
    pous: data.pous.map((pou) => withGlobalListExternals(projectPou(pou), usableLists)),
    dataTypes: [...(data.dataTypes ?? []).map(projectDataType), ...usableLists.map(globalListStruct)],
    configuration: {
      tasks: (data.configuration?.resource?.tasks ?? []).map(projectTask),
      instances: (data.configuration?.resource?.instances ?? []).map(projectInstance),
      globalVariables: [
        ...(data.configuration?.resource?.globalVariables ?? []).map((v) => projectVariable(v as SchemaVariable)),
        ...usableLists.map(globalListInstance),
      ],
    },
  }
}

/* ───────────────────── global variable lists (GVLs) ─────────────────────── */

type SchemaGlobalVariableList = {
  name: string
  variables?: SchemaVariable[]
}

/**
 * A Global Variable List has no IEC equivalent, so it is compiled as the shape STruC++
 * resolves qualified member access through: a STRUCT type, one global instance of it named
 * after the list, and a `VAR_EXTERNAL` in each POU that mentions the list. `GVL.Output1`
 * then type-checks exactly as it did in CODESYS.
 *
 * Doing it here — at the schema → IR boundary — means the emitters need no knowledge of
 * lists at all: they already know how to write a struct, a configuration global and an
 * external.
 */
function globalListTypeName(listName: string): string {
  return `${listName}_TYPE`
}

/** The struct backing a list. Member ADDRESSES are dropped on purpose: a struct member
 *  cannot be bound to I/O today — the compiler accepts an `AT` there and silently
 *  discards it — so emitting one would imply a binding that does not exist. The address
 *  stays on the project model for the round trip back to CODESYS. */
function globalListStruct(list: SchemaGlobalVariableList): TranspileDataType {
  return {
    name: globalListTypeName(list.name),
    derivation: 'structure',
    variable: (list.variables ?? []).map((variable) => {
      const projected = projectVariable(variable)
      // Location deliberately omitted — see the note above.
      return { name: projected.name, type: projected.type, initialValue: projected.initialValue }
    }),
  } as TranspileDataType
}

/** The single global instance the user's code qualifies against. */
function globalListInstance(list: SchemaGlobalVariableList): TranspileVariable {
  return {
    name: list.name,
    type: { definition: 'derived', value: globalListTypeName(list.name) },
    location: '',
  } as TranspileVariable
}

/**
 * Declare, in this POU, the lists its body actually references.
 *
 * STruC++ reaches a configuration-level global only through a matching `VAR_EXTERNAL`;
 * without one `GVL.Output1` fails with "Undeclared variable 'GVL'". Matching on `<name>.`
 * keeps an unrelated POU from being given a name it never uses, and stops a list whose
 * name merely prefixes another from being dragged in.
 */
function withGlobalListExternals(pou: TranspilePou, lists: SchemaGlobalVariableList[]): TranspilePou {
  // Match against the WHOLE projected POU, not just its body: a ladder or FBD body is a
  // node graph, and the reference lives in a node's variable name rather than in any text
  // the body exposes. Serialising the POU catches it wherever the language keeps it.
  const body = JSON.stringify(pou)
  const referenced = lists.filter((list) =>
    new RegExp(`(^|[^\\w.])${list.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\.`, 'i').test(body),
  )
  if (referenced.length === 0) return pou

  const externals = referenced.map(
    (list) =>
      ({
        name: list.name,
        class: 'external',
        type: { definition: 'derived', value: globalListTypeName(list.name) },
        location: '',
      }) as TranspileVariable,
  )
  return { ...pou, interface: { ...pou.interface, variables: [...pou.interface.variables, ...externals] } }
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
    case 'ld':
      return { language: 'ld', value: projectLdBody(body.value.rungs) }
    case 'fbd':
      return { language: 'fbd', value: projectFbdBody(body.value.rung) }
    case 'sfc':
      throw new Error('SFC support is under development')
    default: {
      const unreachable: never = body
      throw new Error(`Unknown body language: ${JSON.stringify(unreachable)}`)
    }
  }
}

/* ─── graphical body projection ──────────────────────────────────── */

type SchemaLdValue = Extract<SchemaBody, { language: 'ld' }>['value']
type SchemaFbdValue = Extract<SchemaBody, { language: 'fbd' }>['value']
type SchemaRung = SchemaLdValue['rungs'][number]
type SchemaFbdRung = SchemaFbdValue['rung']
type SchemaNode = SchemaRung['nodes'][number]
type SchemaEdge = SchemaRung['edges'][number]

function projectLdBody(rungs: readonly SchemaRung[]): RFBody {
  return { rungs: rungs.map(projectRung) }
}

function projectFbdBody(rung: SchemaFbdRung): RFFbdBody {
  return {
    rung: {
      comment: rung.comment,
      nodes: rung.nodes.map(projectNode),
      edges: rung.edges.map(projectEdge),
    },
  }
}

function projectRung(rung: SchemaRung): RFRung {
  return {
    id: rung.id,
    comment: rung.comment,
    reactFlowViewport: rung.reactFlowViewport,
    nodes: rung.nodes.map(projectNode),
    edges: rung.edges.map(projectEdge),
  }
}

function projectNode(n: SchemaNode): RFNode {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: isRecord(n.data) ? n.data : {},
  }
}

function projectEdge(e: SchemaEdge): RFEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
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
