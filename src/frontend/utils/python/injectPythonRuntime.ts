import type { PLCDataType, PLCVariable } from '../../../middleware/shared/ports/types'
import { resolveFunctionBlockPins } from '../PLC/function-block-pins'
import type { ShmLeaf, ShmWalkContext } from './shm-leaves'
import { describeShmLeaves, pinCrossesInDirection, pythonFunctionBlockInstances } from './shm-leaves'
import { SHM_STRING_CHARS } from './shm-type-map'

type PythonRuntimeInjectionParams = {
  fmtIn: string
  fmtOut: string
  inputVariables: PLCVariable[]
  outputVariables: PLCVariable[]
  originalCode: string
  pouName: string
  /** Walk context for what the PLC sends the block. */
  inbound: ShmWalkContext
  /** Walk context for what the block sends back. */
  outbound: ShmWalkContext
}

/**
 * Python classes for the structures and enumerations a block's interface uses.
 *
 * The wire format is flat — one field per scalar leaf — but the user should
 * write `m.speed`, not `m_speed`, exactly as they would in ST. So the driver
 * rebuilds an object from consecutive leaves on the way in and reads it back
 * apart on the way out, and these are the shapes it builds.
 *
 * A structure becomes a plain class with `__slots__`: cheap, and an assignment
 * to a name the structure does not have raises rather than silently creating an
 * attribute the PLC will never read back. An enumeration becomes an `IntEnum`,
 * so `mode == Mode.RUNNING` reads naturally while the value crossing the
 * boundary stays the plain integer the PLC stores.
 */
const generateTypeDeclarations = (variables: PLCVariable[], context: ShmWalkContext): string => {
  const dataTypes = context.dataTypes ?? []
  const referenced = collectReferencedTypes(variables, dataTypes, context)
  const instanceClasses = generateInstanceClasses(variables, context)

  if (referenced.length === 0 && instanceClasses === '') {
    return '# This block uses no structures, enumerations or function block instances'
  }

  let code = ''
  if (referenced.length === 0) return instanceClasses
  code += '# Structures and enumerations from the Variables Table\n'
  for (const dataType of referenced) {
    if (dataType.derivation === 'enumerated') {
      code += `class ${dataType.name}(IntEnum):\n`
      dataType.values.forEach((value, index) => {
        code += `    ${value.description} = ${index}\n`
      })
      code += '\n'
      continue
    }
    /* istanbul ignore else -- collectReferencedTypes yields only these two */
    if (dataType.derivation === 'structure') {
      const members = dataType.variable.map((member) => member.name)
      code += `class ${dataType.name}:\n`
      code += `    __slots__ = (${members.map((m) => `'${m}'`).join(', ')}${members.length === 1 ? ',' : ''})\n`
      code += `    def __init__(self${members.map((m) => `, ${m}=None`).join('')}):\n`
      for (const member of members) {
        code += `        self.${member} = ${member}\n`
      }
      code += '\n'
    }
  }
  return code + instanceClasses
}

/**
 * Python classes for the function block instances a block declares.
 *
 * Python cannot call an instance, but it does not need to: the generated ST
 * wrapper calls each one every scan, in the PLC process where the instance
 * lives. What Python gets is the pins, and it should use them the way ST does —
 * `ton0.IN = True`, then `ton0.Q` — so each instance becomes an object with its
 * pins as attributes.
 *
 * Pin names are upper-cased, matching how the compiler names them and how the
 * copy statements reach them, so a user writes `ton0.IN` rather than `ton0.in`
 * (which would also collide with a Python keyword).
 *
 * Only the pins that cross appear. FB-internal `local` state is left out: it is
 * the instance's own business, and exposing it would invite writes that corrupt
 * the block from outside.
 */
/**
 * The Python class name for a function block type.
 *
 * Upper-cased, and this is the ONLY place that decides it. The class is emitted
 * once per type and constructed once per instance, from two different functions,
 * and each used to spell the name from its own variable's raw `type.value`
 * while the de-duplication keyed on the upper-cased form. So `a : Accum` and
 * `b : ACCUM` emitted a single `class Accum:` and then constructed both
 * `Accum(...)` and `ACCUM(...)` — the second a `NameError` at module scope,
 * before `block_init()` ever ran.
 *
 * Upper case is the right canonical form here: it is what the de-duplication
 * already keyed on, what strucpp does to every identifier, and what the pin
 * names and shared-memory slots on this side already use. The class name never
 * appears in user code — a user writes `ton0.IN`, never the type — so nothing
 * user-visible changes.
 */
const pythonClassName = (typeName: string): string => typeName.toUpperCase()

const generateInstanceClasses = (variables: PLCVariable[], context: ShmWalkContext): string => {
  const instances = pythonFunctionBlockInstances(variables, context.dataTypes ?? [])
  if (instances.length === 0) return ''

  const emitted = new Set<string>()
  let code = '# Function block instances — called once per scan by the PLC\n'
  for (const instance of instances) {
    const typeName = instance.type.value
    // The de-duplication key IS the emitted class name, so the two cannot drift.
    const className = pythonClassName(typeName)
    if (emitted.has(className)) continue
    emitted.add(className)

    const pins = resolveFunctionBlockPins(typeName, context.pous ?? [], context.libraries ?? [])
    /* istanbul ignore next -- defensive: an unresolvable instance is refused upstream */
    if (!pins) continue
    const names = pins
      // Every pin that ever crosses, in either direction, so one class serves
      // both the seed (inputs only) and the per-cycle read (all pins).
      .filter((pin) => pinCrossesInDirection(pin.class, 'in'))
      .map((pin) => pin.name.toUpperCase())
    /* istanbul ignore next -- defensive: a block with no pins at all */
    if (names.length === 0) continue

    code += `class ${className}:\n`
    code += `    __slots__ = (${names.map((n) => `'${n}'`).join(', ')}${names.length === 1 ? ',' : ''})\n`
    code += `    def __init__(self${names.map((n) => `, ${n}=None`).join('')}):\n`
    for (const n of names) code += `        self.${n} = ${n}\n`
    code += '\n'
  }
  return code
}

/**
 * Every structure and enumeration a block's interface reaches, nested ones
 * included, in an order where a type is declared before anything using it.
 *
 * "Reaches" includes THROUGH A FUNCTION BLOCK INSTANCE. A pin can be a structure
 * or an enumeration, and the constructor for that pin names its class — so a
 * walk that stopped at the instance left the class undeclared and the generated
 * module referenced a name that was never defined.
 */
const collectReferencedTypes = (
  variables: PLCVariable[],
  dataTypes: readonly PLCDataType[],
  context: ShmWalkContext,
): PLCDataType[] => {
  const byName = new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))
  const ordered: PLCDataType[] = []
  const seen = new Set<string>()
  const seenBlocks = new Set<string>()

  const visit = (typeName: string, depth: number): void => {
    /* istanbul ignore next -- defensive: describeShmLeaves refuses deeper nesting first */
    if (depth > 16) return
    const key = typeName.toUpperCase()
    const dataType = byName.get(key)

    // No data type by that name: a function block instance. Its pins are what
    // the constructor names, so they are what has to be reachable from here.
    if (!dataType) {
      if (seenBlocks.has(key)) return
      seenBlocks.add(key)
      const pins = resolveFunctionBlockPins(typeName, context.pous ?? [], context.libraries ?? [])
      for (const pin of pins ?? []) {
        if (pin.type.definition === 'user-data-type' || pin.type.definition === 'derived') {
          visit(pin.type.value, depth + 1)
        }
      }
      return
    }

    if (seen.has(key) || dataType.derivation === 'array') return
    seen.add(key)
    if (dataType.derivation === 'structure') {
      // Members first, so a nested structure is defined before the class that
      // constructs it.
      for (const member of dataType.variable) {
        if (member.type.definition === 'user-data-type' || member.type.definition === 'derived') {
          visit(member.type.value, depth + 1)
        }
      }
    }
    ordered.push(dataType)
  }

  for (const variable of variables) {
    const base = variable.type.definition === 'array' ? variable.type.data?.baseType : variable.type
    if (base?.definition === 'user-data-type' || base?.definition === 'derived') visit(base.value, 0)
  }
  return ordered
}

/**
 * Emit the statements that decode one variable from consecutive leaves.
 *
 * A scalar binds straight to its name. A structure is constructed from its
 * members, innermost first, so nesting rebuilds correctly. An enumeration is
 * wrapped in its IntEnum.
 */
const generateVariableUnpack = (variable: PLCVariable, context: ShmWalkContext, indent: string): string => {
  const walked = describeShmLeaves(variable, context)
  /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
  if ('refusal' in walked) return ''

  // Every leaf decodes into its own temporary, then the containers are rebuilt
  // and filled. Uniform: a plain scalar is the one-leaf, one-assignment case of
  // the same rule, with no separate path to get wrong.
  let code = ''
  for (const leaf of walked.leaves) {
    code += decodeLeaf(leaf, `_${leaf.field}`, indent)
  }
  code += assembleFromLeaves(walked.leaves, indent)
  return code
}

/**
 * Python expression for a leaf's own path, e.g. `m.trims[0]`.
 *
 * A numeric segment is an index, a string segment an attribute — the same
 * distinction `ShmLeaf.path` carries.
 */
const pathExpr = (path: ReadonlyArray<string | number>): string =>
  path.reduce<string>((acc, seg, i) => {
    if (i === 0) return String(seg)
    return typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${seg}`
  }, '')

/**
 * Statements that rebuild a variable's containers, then fill every leaf.
 *
 * Driven ENTIRELY by the leaves. The previous assembler walked the project's
 * types a second time to enumerate members, and the two walks disagreed the
 * moment one descended somewhere the other did not — a structure pin on a
 * function block produced `DRIVE(CFG=_drv_CFG)` against a decode that had only
 * ever produced `_drv_CFG_speed`. There is one walk now, and this reads its
 * output.
 *
 * Containers are created before they are filled, deepest last, so
 * `m = Motor(); m.trims = [None] * 3; m.trims[0] = …` is always in order. A list
 * is sized from the indices actually present, which is exact because the walk
 * enumerates every element.
 */
const assembleFromLeaves = (leaves: readonly ShmLeaf[], indent: string): string => {
  // Every container node that has to exist, keyed by its path prefix. A `null`
  // class means a list; the number is its length.
  const objects = new Map<string, { expr: string; className: string; depth: number }>()
  const lists = new Map<string, { expr: string; length: number; depth: number }>()

  for (const leaf of leaves) {
    for (let i = 0; i < leaf.path.length - 1; i++) {
      const prefix = leaf.path.slice(0, i + 1)
      const key = prefix.map(String).join('\u0000')
      const nextSegment = leaf.path[i + 1]
      if (typeof nextSegment === 'number') {
        const existing = lists.get(key)
        const length = Math.max(existing?.length ?? 0, nextSegment + 1)
        lists.set(key, { expr: pathExpr(prefix), length, depth: i })
        continue
      }
      const className = leaf.objectPath[i]
      /* istanbul ignore next -- defensive: a node with an attribute below it is always an object */
      if (className) objects.set(key, { expr: pathExpr(prefix), className, depth: i })
    }
  }

  // Shallowest first, so a parent exists before a child is assigned into it.
  const creations = [
    ...[...objects.values()].map((o) => ({ depth: o.depth, code: `${o.expr} = ${o.className}()` })),
    ...[...lists.values()].map((l) => ({ depth: l.depth, code: `${l.expr} = [None] * ${l.length}` })),
  ].sort((a, b) => a.depth - b.depth)

  let code = ''
  for (const creation of creations) code += `${indent}${creation.code}\n`
  for (const leaf of leaves) {
    const value = leaf.enumTypeName ? `${leaf.enumTypeName}(_${leaf.field})` : `_${leaf.field}`
    code += `${indent}${pathExpr(leaf.path)} = ${value}\n`
  }
  return code
}

/** Decode one leaf out of `_vals` into `local`. */
const decodeLeaf = (leaf: ShmLeaf, local: string, indent: string): string => {
  const { descriptor } = leaf
  let code = ''

  if (descriptor.kind === 'string' || descriptor.kind === 'wstring') {
    code += `${indent}${local}_len = _vals[_idx]\n`
    code += `${indent}_idx += 1\n`
    code += `${indent}${local}_body = _vals[_idx]\n`
    code += `${indent}_idx += 1\n`
    // The C side clamps the length to the budget, but the prefix is a signed
    // int8 and the buffer starts zeroed, so clamp on read too: a negative slice
    // bound would silently truncate from the end instead of failing.
    code += `${indent}${local}_len = max(0, min(${local}_len, ${SHM_STRING_CHARS}))\n`
    if (descriptor.kind === 'wstring') {
      // The length counts UTF-16 code units, so the byte slice is twice it.
      code += `${indent}${local} = ${local}_body[:${local}_len * 2].decode('utf-16-le', errors='ignore')\n`
    } else {
      code += `${indent}${local} = ${local}_body[:${local}_len].decode('utf-8', errors='ignore')\n`
    }
    return code
  }

  code += `${indent}${local} = _vals[_idx]\n`
  code += `${indent}_idx += 1\n`
  return code
}

/**
 * Emit the unpack sequence for a set of variables.
 *
 * Shared by the per-cycle input read and the one-time output seed: both decode
 * the same packed layout, differing only in which buffer they read and at what
 * indentation. Keeping one generator means the two cannot drift in how they
 * interpret a field — the same reason the leaf walk is shared with the C side.
 */
const generateUnpackCode = (
  variables: PLCVariable[],
  context: ShmWalkContext,
  opts: { header: string; buffer: string; fmt: string; size: string; indent: string },
): string => {
  const { header, buffer, fmt, size, indent } = opts

  let code = `${header}\n`
  code += `${indent}_vals = struct.unpack(${fmt}, ${buffer}.buf[:${size}])\n`
  code += `${indent}_idx = 0\n`
  for (const variable of variables) {
    code += generateVariableUnpack(variable, context, indent)
  }
  return code
}

const generateInputUnpackCode = (variables: PLCVariable[], context: ShmWalkContext): string => {
  if (variables.length === 0) return '    # No input variables to read'
  return generateUnpackCode(variables, context, {
    header: '    # Read input variables',
    buffer: 'shm_in',
    fmt: 'fmt_in',
    size: 'data_size_in',
    indent: '    ',
  })
}

/**
 * Seed the output globals from what the PLC currently holds, before
 * `block_init()` runs.
 *
 * Previously the outputs were initialised from their declarations and written
 * back after the first `block_loop()`, before the user's code had assigned
 * anything — so the IEC-side value was replaced by a default on every start.
 * With RETAIN that is destructive rather than merely wrong. The C stub publishes
 * the live values into shared memory when it maps the segment, and this reads
 * them back. A block that never assigns an output now leaves it exactly as the
 * PLC had it.
 */
const generateOutputSeedCode = (variables: PLCVariable[], context: ShmWalkContext): string => {
  if (variables.length === 0) return '# No output variables to seed'
  return generateUnpackCode(variables, context, {
    header: '# Seed outputs from the values the PLC already holds',
    buffer: 'shm_out',
    fmt: 'fmt_out',
    size: 'data_size_out',
    indent: '',
  })
}

/** Encode one leaf, reading through the Python attribute path it came from. */
const encodeLeaf = (leaf: ShmLeaf): string => {
  const expr = pathExpr(leaf.path)
  const { descriptor } = leaf

  if (descriptor.kind === 'string') {
    let code = `    _body = ${expr}.encode('utf-8')[:${SHM_STRING_CHARS}]\n`
    code += `    _len = len(_body)\n`
    code += `    _body = _body.ljust(${SHM_STRING_CHARS}, b'\\0')\n`
    code += `    _out.append(_len)\n`
    code += `    _out.append(_body)\n`
    return code
  }

  if (descriptor.kind === 'wstring') {
    // Truncate on a code-unit boundary, never mid-unit: encode, clip to the byte
    // budget, then round down to an even length. `_len` is the code-unit count
    // the C side expects, not the byte count.
    let code = `    _body = ${expr}.encode('utf-16-le')[:${SHM_STRING_CHARS * 2}]\n`
    code += `    _body = _body[: len(_body) - (len(_body) % 2)]\n`
    code += `    _len = len(_body) // 2\n`
    code += `    _body = _body.ljust(${SHM_STRING_CHARS * 2}, b'\\0')\n`
    code += `    _out.append(_len)\n`
    code += `    _out.append(_body)\n`
    return code
  }

  // An IntEnum packs as its integer already, but saying so keeps the generated
  // code honest about what crosses — and survives a user assigning a plain int.
  if (leaf.enumTypeName) return `    _out.append(int(${expr}))\n`

  return `    _out.append(${expr})\n`
}

/**
 * Generate Python code that packs output variables into the flat struct format.
 */
const generateOutputPackCode = (variables: PLCVariable[], context: ShmWalkContext): string => {
  if (variables.length === 0) return '    # No output variables to write'

  let code = '    # Write output variables\n'
  code += '    _out = []\n'
  for (const variable of variables) {
    const walked = describeShmLeaves(variable, context)
    /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
    if ('refusal' in walked) continue
    for (const leaf of walked.leaves) code += encodeLeaf(leaf)
  }

  code += '    packed = struct.pack(fmt_out, *_out)\n'
  code += '    shm_out.buf[:data_size_out] = packed'

  return code
}

const injectPythonRuntime = (params: PythonRuntimeInjectionParams): string => {
  const { fmtIn, fmtOut, inputVariables, outputVariables, originalCode, pouName, inbound, outbound } = params

  const outputSeeding = generateOutputSeedCode(outputVariables, outbound)
  const readInputSection = generateInputUnpackCode(inputVariables, inbound)
  const writeOutputSection = generateOutputPackCode(outputVariables, outbound)
  // Declared before the user's code, so a block_init() that constructs one of
  // its own structures finds the class already defined. The inbound context is
  // the fuller one — it carries a function block's outputs as well as its
  // inputs — so the emitted class has every pin.
  const typeDeclarations = generateTypeDeclarations([...inputVariables, ...outputVariables], inbound)

  const injectedCode = `
from enum import IntEnum

${typeDeclarations}
${originalCode}

plc_pid = %d
fmt_in = ('${fmtIn}')
fmt_out = ('${fmtOut}')
try:
    shm_in = shared_memory.SharedMemory(name='%s_in')
    shm_out = shared_memory.SharedMemory(name='%s_out')
except Exception as e:
    print(f'Error on shared memory: {e}')
    exit(1)

data_size_in = struct.calcsize(fmt_in)
data_size_out = struct.calcsize(fmt_out)

# Outputs start from what the PLC already holds, not from their declarations.
# The stub publishes the live values into shared memory when it maps the
# segment, so a block that never assigns an output leaves it untouched — and a
# RETAIN output survives the restart it exists to survive.
${outputSeeding}

# Initialize block
block_init()
while True:
    try:
        os.kill(plc_pid, 0)
    except Exception as e:
        print('PLC runtime has stopped.')
        break
${readInputSection}

    # Run block
    block_loop()

${writeOutputSection}

    # Sleep for 100ms
    time.sleep(0.1)
print('Stopping Python block: ${pouName}')
try:
    shm_in.close()
    shm_in.unlink()
    shm_out.close()
    shm_out.unlink()
except Exception as e:
    print(f'Cleanup error: {e}')
`

  return injectedCode
}

export { injectPythonRuntime, type PythonRuntimeInjectionParams }
