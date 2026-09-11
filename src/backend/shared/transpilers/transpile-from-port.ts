/**
 * Project the renderer's port-shape `PLCProjectData` (`middleware/shared/ports/types.ts`)
 * into the JSON transpiler's minimal IR.
 *
 * Shared by both builds: the store shape is the same on each, so the projection is too.
 * The companion schema adapter — the one the main process uses on the compile path,
 * against the shape its IPC payload arrives in — is `st-transpiler/from-schema.ts`.
 */

import {
  globalVariableListIsReferencedIn,
  globalVariableListTypeName,
  referenceSearchText,
} from '../../../frontend/utils/PLC/global-variable-list-serializer'
import type {
  PLCBody,
  PLCDataType,
  PLCGlobalVariableList,
  PLCInstance,
  PLCPou,
  PLCProjectData,
  PLCStructureVariable,
  PLCTask,
  PLCVariable,
  PLCVariableType,
  VariableClass,
} from '../../../middleware/shared/ports/types'
import type {
  TranspileBody,
  TranspileBodyLanguage,
  TranspileDataType,
  TranspileInstance,
  TranspilePou,
  TranspileProject,
  TranspileTask,
  TranspileVariable,
  TranspileVariableType,
} from './st-transpiler/types'
import type { RFFbdBody } from './st-transpiler/walker/fbd'
import type { RFBody, RFEdge, RFNode, RFRung } from './st-transpiler/walker/types'

/* ─────────────────────────── public entry ───────────────────────────────── */

export function fromPortShape(data: PLCProjectData): TranspileProject {
  const resource = data.configurations?.resource
  // A Global Variable List has no IEC equivalent, so it is compiled as the shape STruC++
  // resolves qualified member access through: a STRUCT type, one global instance named
  // after the list, and a `VAR_EXTERNAL` in each POU that mentions it. An empty list is
  // skipped — an empty STRUCT is not a legal type, so there would be nothing to instantiate.
  const lists = (data.globalVariableLists ?? []).filter((list) => list.variables.length > 0)

  return {
    pous: data.pous.map((pou) => withGlobalListExternals(projectPou(pou), lists)),
    dataTypes: [...(data.dataTypes ?? []).map(projectDataType), ...lists.map(globalListStruct)],
    configuration: {
      tasks: (resource?.tasks ?? []).map(projectTask),
      instances: (resource?.instances ?? []).map(projectInstance),
      globalVariables: [...(resource?.globalVariables ?? []).map(projectVariable), ...lists.map(globalListInstance)],
    },
  }
}

/* ──────────────────── global variable lists (GVLs) ──────────────────────── */

// The `_TYPE` suffix and what counts as a reference are imported from the serialiser, not
// restated: a private copy would let the struct type stop matching its instance silently.

/** The struct backing a list. Member addresses are dropped: a struct member cannot be bound to I/O. */
function globalListStruct(list: PLCGlobalVariableList): TranspileDataType {
  return {
    name: globalVariableListTypeName(list.name),
    derivation: 'structure',
    variable: list.variables.map((variable) => {
      const projected = projectVariable(variable)
      return { name: projected.name, type: projected.type, initialValue: projected.initialValue }
    }),
  }
}

/** The single global instance the user's code qualifies against. */
function globalListInstance(list: PLCGlobalVariableList): TranspileVariable {
  return {
    name: list.name,
    type: { definition: 'derived', value: globalVariableListTypeName(list.name) },
    location: '',
  }
}

/** Declare, in this POU, the lists its body actually references — STruC++ needs a `VAR_EXTERNAL`. */
function withGlobalListExternals(pou: TranspilePou, lists: PLCGlobalVariableList[]): TranspilePou {
  // The whole projected POU is scanned, not just its body: a ladder or FBD reference lives
  // in a node's variable name rather than in any text the body exposes.
  const searchText = referenceSearchText(pou)
  const referenced = lists.filter((list) => globalVariableListIsReferencedIn(list.name, searchText))
  if (referenced.length === 0) return pou

  const externals = referenced.map((list): TranspileVariable => {
    return {
      name: list.name,
      class: 'external',
      type: { definition: 'derived', value: globalVariableListTypeName(list.name) },
      location: '',
    }
  })
  return { ...pou, interface: { ...pou.interface, variables: [...pou.interface.variables, ...externals] } }
}

/* ─────────────────────────── projections ────────────────────────────────── */

function projectPou(pou: PLCPou): TranspilePou {
  const variables = (pou.interface?.variables ?? []).map(projectVariable)
  return {
    name: pou.name,
    pouType: pou.pouType,
    documentation: pou.documentation ?? '',
    interface: {
      variables,
      ...(pou.pouType === 'function' && pou.interface?.returnType ? { returnType: pou.interface.returnType } : {}),
    },
    body: projectBody(pou.body),
  }
}

function projectBody(body: PLCBody): TranspileBody {
  const language = normalizeLanguage(body.language)
  switch (language) {
    case 'st':
    case 'il':
    case 'python':
    case 'cpp':
      return { language, value: String(body.value ?? '') }
    case 'ld':
      return { language: 'ld', value: projectLdBody(body.value) }
    case 'fbd':
      return { language: 'fbd', value: projectFbdBody(body.value) }
    case 'sfc':
      // SFC is not ported yet: ST passthrough so legacy fixtures do not crash the transpiler.
      return { language: 'st', value: String(body.value ?? '') }
  }
}

/* ─── React Flow body projection ─────────────────────────────────── */

// A graphical body is `unknown` on the port, so every field is read through a guard.

function projectLdBody(value: unknown): RFBody {
  const rungs = isRecord(value) ? asArray(value.rungs) : []
  return { rungs: rungs.map(projectRung) }
}

function projectFbdBody(value: unknown): RFFbdBody {
  const rung = isRecord(value) && isRecord(value.rung) ? value.rung : {}
  return {
    rung: {
      comment: asString(rung.comment) ?? '',
      nodes: asArray(rung.nodes).map(projectNode),
      edges: asArray(rung.edges).map(projectEdge),
    },
  }
}

function projectRung(value: unknown): RFRung {
  const rung = isRecord(value) ? value : {}
  return {
    id: asString(rung.id) ?? '',
    comment: asString(rung.comment) ?? '',
    reactFlowViewport: rung.reactFlowViewport,
    nodes: asArray(rung.nodes).map(projectNode),
    edges: asArray(rung.edges).map(projectEdge),
  }
}

function projectNode(value: unknown): RFNode {
  const node = isRecord(value) ? value : {}
  const position = isRecord(node.position) ? node.position : {}
  return {
    id: asString(node.id) ?? '',
    type: asString(node.type) ?? '',
    position: {
      x: asNumber(position.x) ?? 0,
      y: asNumber(position.y) ?? 0,
    },
    data: isRecord(node.data) ? node.data : {},
  }
}

function projectEdge(value: unknown): RFEdge {
  const edge = isRecord(value) ? value : {}
  return {
    id: asString(edge.id) ?? '',
    source: asString(edge.source) ?? '',
    target: asString(edge.target) ?? '',
    sourceHandle: asString(edge.sourceHandle) ?? null,
    targetHandle: asString(edge.targetHandle) ?? null,
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function projectVariable(v: PLCVariable): TranspileVariable {
  return {
    name: v.name,
    type: projectVariableType(v.type),
    ...(v.class !== undefined ? { class: normalizeVarClass(v.class) } : {}),
    ...(v.location ? { location: v.location } : {}),
    ...(v.initialValue !== null && v.initialValue !== undefined && v.initialValue !== ''
      ? { initialValue: v.initialValue }
      : {}),
    ...(v.documentation ? { documentation: v.documentation } : {}),
  }
}

function projectStructureVariable(v: PLCStructureVariable): TranspileVariable {
  // The port hides a structure member's initial value inside `{ simpleValue: { value } }`;
  // the IR flattens that to a bare string, as the PLCVariable projection above does.
  const initial = v.initialValue?.simpleValue?.value
  return {
    name: v.name,
    type: projectVariableType(v.type),
    ...(initial !== undefined && initial !== '' ? { initialValue: initial } : {}),
    ...(v.documentation ? { documentation: v.documentation } : {}),
  }
}

function projectVariableType(type: PLCVariableType): TranspileVariableType {
  if (type.definition === 'array' && type.data) {
    return {
      definition: 'array',
      data: {
        dimensions: type.data.dimensions.map((d) => ({ dimension: d.dimension })),
        baseType: typeof type.data.baseType === 'string' ? type.data.baseType : { value: type.data.baseType.value },
      },
    }
  }
  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    return { definition: type.definition, value: type.value }
  }
  return { definition: 'base-type', value: type.value }
}

function projectDataType(dt: PLCDataType): TranspileDataType {
  if (dt.derivation === 'array') {
    return {
      name: dt.name,
      derivation: 'array',
      dimensions: dt.dimensions.map((d) => ({ dimension: d.dimension })),
      // The port's array baseType is a PLCVariableType; the IR carries the same scalar
      // shape the schema side does — a bare name for a nested array, a wrapper otherwise.
      baseType: dt.baseType.definition === 'array' ? dt.baseType.value : { value: dt.baseType.value },
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
  return {
    name: dt.name,
    derivation: 'structure',
    variable: dt.variable.map(projectStructureVariable),
  }
}

function projectTask(task: PLCTask): TranspileTask {
  return {
    name: task.name,
    priority: task.priority,
    triggering: task.triggering,
    ...(task.triggering === 'Cyclic' ? { interval: task.interval } : { single: task.interval }),
  }
}

function projectInstance(inst: PLCInstance): TranspileInstance {
  return {
    name: inst.name,
    program: inst.program,
    ...(inst.task ? { task: inst.task } : {}),
  }
}

const BODY_LANGUAGES: readonly TranspileBodyLanguage[] = ['st', 'il', 'ld', 'fbd', 'sfc', 'python', 'cpp']

/** The port accepts uppercase variants (`'IL'`, `'ST'`, …); the IR switches on lowercase only. */
function normalizeLanguage(language: PLCBody['language']): TranspileBodyLanguage {
  const lower = language.toLowerCase()
  return BODY_LANGUAGES.find((known) => known === lower) ?? 'st'
}

/** The port's 'global' class has no IR equivalent (globals live under the configuration). */
function normalizeVarClass(cls: VariableClass): TranspileVariable['class'] {
  if (cls === 'global') return 'local'
  return cls
}
