/**
 * Project the renderer's port-shape `PLCProjectData`
 * (`middleware/shared/ports/types.ts`) into the JSON transpiler's
 * minimal IR.
 *
 * Lives under `middleware/adapters/editor/` rather than alongside the
 * transpiler itself so importing port-shape types — which are
 * middleware-scoped — doesn't violate the inward-only layer rule
 * (`backend/shared/` modules can't depend on `middleware/`).  Its twin
 * sits at `middleware/adapters/web/transpile-from-port.ts`: the
 * projection is the same on both builds because the store shape is,
 * but it cannot live on the shared surface for the layer reason above.
 *
 * The companion schema adapter — the one the main process uses on the
 * compile path, against the shape its IPC payload arrives in — lives at
 * `backend/shared/transpilers/st-transpiler/from-schema.ts`.
 */

import type {
  TranspileBody,
  TranspileBodyLanguage,
  TranspileDataType,
  TranspileInstance,
  TranspilePou,
  TranspilePouKind,
  TranspileProject,
  TranspileTask,
  TranspileVariable,
  TranspileVariableType,
} from '../../../backend/shared/transpilers/st-transpiler/types'
import type { RFFbdBody } from '../../../backend/shared/transpilers/st-transpiler/walker/fbd'
import type { RFBody, RFEdge, RFNode, RFRung } from '../../../backend/shared/transpilers/st-transpiler/walker/types'
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
} from '../../shared/ports/types'

/* ─────────────────────────── public entry ───────────────────────────────── */

export function fromPortShape(data: PLCProjectData): TranspileProject {
  const resource = data.configurations?.resource
  // A Global Variable List has no IEC equivalent, so it is compiled as the shape STruC++
  // resolves qualified member access through: a STRUCT type, one global instance named
  // after the list, and a `VAR_EXTERNAL` in each POU that mentions it. `GVL.Output1` then
  // type-checks exactly as it did in CODESYS. An empty list is skipped — an empty STRUCT
  // is not a legal type, so there would be nothing to instantiate.
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

/*
 * The two rules with no compiler diagnostic behind them — the `_TYPE` suffix and
 * what counts as a reference — are imported from the serialiser, not restated
 * here. They also govern the ST text output and the schema→IR projection in
 * `backend/shared/transpilers/st-transpiler/from-schema.ts`; a private copy in
 * any one of the three would let the struct type stop matching its instance and
 * its `VAR_EXTERNAL` silently.
 */

/** The struct backing a list. Member ADDRESSES are dropped deliberately: a struct member
 *  cannot be bound to I/O today — the compiler accepts an `AT` there and silently
 *  discards it — so emitting one would imply a binding that does not exist. The address
 *  stays on the project model for the trip back to CODESYS. */
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

/**
 * Declare, in this POU, the lists its body actually references.
 *
 * STruC++ reaches a configuration-level global only through a matching `VAR_EXTERNAL`;
 * without one `GVL.Output1` fails with "Undeclared variable 'GVL'".
 */
function withGlobalListExternals(pou: TranspilePou, lists: PLCGlobalVariableList[]): TranspilePou {
  // Scan the WHOLE projected POU, not just its body: a ladder or FBD body is a node
  // graph, and the reference lives in a node's variable name rather than in any text the
  // body exposes. `referenceSearchText` — not `JSON.stringify` — because JSON escaping
  // hides every reference that starts a line; see the note on that function.
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
    pouType: pou.pouType as TranspilePouKind,
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
    case 'ld': {
      const flow = body.value as { rungs: unknown[] }
      return { language: 'ld', value: projectLdBody(flow.rungs) }
    }
    case 'fbd': {
      const flow = body.value as { rung: unknown }
      return { language: 'fbd', value: projectFbdBody(flow.rung) }
    }
    case 'sfc':
      // SFC isn't ported yet — fall back to ST passthrough so the
      // transpiler doesn't crash on legacy SFC fixtures.
      return { language: 'st', value: String(body.value ?? '') }
    default: {
      // Exhaustiveness check — required so TS sees the switch
      // covers every `TranspileBodyLanguage` variant and the function
      // returns on every path.
      const _exhaustive: never = language
      throw new Error(`Unhandled body language: ${String(_exhaustive)}`)
    }
  }
}

/* ─── React Flow body projection ─────────────────────────────────── */

interface PortRung {
  id?: unknown
  comment?: unknown
  reactFlowViewport?: unknown
  nodes: unknown[]
  edges: unknown[]
}

interface PortNode {
  id: unknown
  type: unknown
  position?: { x?: unknown; y?: unknown }
  data?: unknown
}

interface PortEdge {
  id: unknown
  source: unknown
  target: unknown
  sourceHandle?: unknown
  targetHandle?: unknown
}

function projectLdBody(rungs: readonly unknown[]): RFBody {
  return { rungs: rungs.map((r) => projectRung(r as PortRung)) }
}

function projectFbdBody(rung: unknown): RFFbdBody {
  const r = rung as PortRung
  return {
    rung: {
      comment: asString(r.comment) ?? '',
      nodes: (r.nodes ?? []).map((n) => projectNode(n as PortNode)),
      edges: (r.edges ?? []).map((e) => projectEdge(e as PortEdge)),
    },
  }
}

function projectRung(rung: PortRung): RFRung {
  return {
    id: asString(rung.id) ?? '',
    comment: asString(rung.comment) ?? '',
    reactFlowViewport: rung.reactFlowViewport,
    nodes: (rung.nodes ?? []).map((n) => projectNode(n as PortNode)),
    edges: (rung.edges ?? []).map((e) => projectEdge(e as PortEdge)),
  }
}

function projectNode(n: PortNode): RFNode {
  return {
    id: asString(n.id) ?? '',
    type: asString(n.type) ?? '',
    position: {
      x: asNumber(n.position?.x) ?? 0,
      y: asNumber(n.position?.y) ?? 0,
    },
    data: isRecord(n.data) ? n.data : {},
  }
}

function projectEdge(e: PortEdge): RFEdge {
  return {
    id: asString(e.id) ?? '',
    source: asString(e.source) ?? '',
    target: asString(e.target) ?? '',
    sourceHandle: asString(e.sourceHandle) ?? null,
    targetHandle: asString(e.targetHandle) ?? null,
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
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
  // Port-shape structure variables hide initial value inside
  // `{ simpleValue: { value: ... } }`; the IR flattens that to a
  // bare string for symmetry with the PLCVariable projection above.
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
      // PLCDataType's array baseType is a PLCVariableType (object);
      // collapse to either a string (elementary tag like "INT") or
      // a single-field wrapper so the IR carries the same scalar
      // shape the schema side does.
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
  // structure
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

function normalizeLanguage(language: string): TranspileBodyLanguage {
  // Port shape accepts uppercase variants ('IL', 'ST', …) on the
  // body.language type union; the IR canonicalises to lowercase so
  // downstream code can switch on a single case.
  const lower = language.toLowerCase()
  if (
    lower === 'st' ||
    lower === 'il' ||
    lower === 'ld' ||
    lower === 'fbd' ||
    lower === 'sfc' ||
    lower === 'python' ||
    lower === 'cpp'
  ) {
    return lower
  }
  // Fallback: treat unknown languages as ST passthrough so the
  // transpiler doesn't crash on legacy fixtures.
  return 'st'
}

function normalizeVarClass(cls: VariableClass): TranspileVariable['class'] {
  // Port shape has a 'global' class that the IR doesn't (global vars
  // live under configuration.globalVariables, not in a POU
  // interface).  Map it onto 'local' for the projection; this only
  // matters when a global slips into the interface variables list,
  // which the renderer prevents at the editor level.
  if (cls === 'global') return 'local'
  return cls
}
