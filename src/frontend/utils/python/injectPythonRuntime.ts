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
  const referenced = collectReferencedTypes(variables, dataTypes)
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
const generateInstanceClasses = (variables: PLCVariable[], context: ShmWalkContext): string => {
  const instances = pythonFunctionBlockInstances(variables, context.dataTypes ?? [])
  if (instances.length === 0) return ''

  const emitted = new Set<string>()
  let code = '# Function block instances — called once per scan by the PLC\n'
  for (const instance of instances) {
    const typeName = instance.type.value
    if (emitted.has(typeName.toUpperCase())) continue
    emitted.add(typeName.toUpperCase())

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

    code += `class ${typeName}:\n`
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
 */
const collectReferencedTypes = (variables: PLCVariable[], dataTypes: readonly PLCDataType[]): PLCDataType[] => {
  const byName = new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))
  const ordered: PLCDataType[] = []
  const seen = new Set<string>()

  const visit = (typeName: string, depth: number): void => {
    /* istanbul ignore next -- defensive: describeShmLeaves refuses deeper nesting first */
    if (depth > 16) return
    const key = typeName.toUpperCase()
    if (seen.has(key)) return
    const dataType = byName.get(key)
    if (!dataType || dataType.derivation === 'array') return
    seen.add(key)
    if (dataType.derivation === 'structure') {
      // Members first, so a nested structure is defined before the class that
      // constructs it.
      for (const member of dataType.variable) {
        if (member.type.definition === 'user-data-type') visit(member.type.value, depth + 1)
      }
    }
    ordered.push(dataType)
  }

  for (const variable of variables) {
    const base = variable.type.definition === 'array' ? variable.type.data?.baseType : variable.type
    if (base?.definition === 'user-data-type') visit(base.value, 0)
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

  let code = ''
  const locals: string[] = []
  for (const leaf of walked.leaves) {
    // Each leaf decodes into a temporary named for its path, then the temporaries
    // are assembled. A flat variable's path is just its own name, so the
    // temporary *is* the variable and no assembly is needed.
    const local = leaf.path.length === 1 ? variable.name : `_${leaf.field}`
    locals.push(local)
    code += decodeLeaf(leaf, local, indent)
  }

  if (walked.leaves.length === 1 && walked.leaves[0].path.length === 1) {
    const only = walked.leaves[0]
    return only.enumTypeName ? `${code}${indent}${variable.name} = ${only.enumTypeName}(${variable.name})\n` : code
  }

  code += `${indent}${variable.name} = ${buildValue(variable, context, [variable.name])}\n`
  return code
}

/**
 * Construct expression for a composite: a structure, or a function block
 * instance built from the pins that crossed.
 *
 * The two look the same from here — a named type whose members were decoded into
 * temporaries — so one builder covers both, and the only difference is where the
 * member list comes from.
 */
const buildValue = (variable: PLCVariable, context: ShmWalkContext, path: string[]): string => {
  const dataTypes = context.dataTypes ?? []
  const byName = new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))
  const base = variable.type.definition === 'array' ? variable.type.data?.baseType : variable.type

  const buildFor = (typeName: string, fieldPath: string[]): string => {
    const dataType = byName.get(typeName.toUpperCase())

    if (dataType?.derivation === 'structure') {
      const args = dataType.variable.map((member) => {
        const memberPath = [...fieldPath, member.name]
        if (member.type.definition === 'user-data-type') {
          const nested = byName.get(member.type.value.toUpperCase())
          if (nested?.derivation === 'structure') return `${member.name}=${buildFor(member.type.value, memberPath)}`
          if (nested?.derivation === 'enumerated') {
            return `${member.name}=${member.type.value}(_${memberPath.join('_')})`
          }
        }
        return `${member.name}=_${memberPath.join('_')}`
      })
      return `${dataType.name}(${args.join(', ')})`
    }

    // Not a data type, so a function block instance. Its pins are the members,
    // and only the ones that crossed appear — which for the inbound direction is
    // inputs, in-outs and outputs.
    const pins = resolveFunctionBlockPins(typeName, context.pous ?? [], context.libraries ?? [])
    /* istanbul ignore next -- defensive: an unresolvable instance is refused upstream */
    if (!pins) return `_${fieldPath.join('_')}`
    // Must match the walk exactly, or the constructor names a temporary the
    // decode never produced — hence one shared predicate.
    const crossing = pins.filter((pin) => pinCrossesInDirection(pin.class, context.direction))
    const args = crossing.map((pin) => {
      // Upper-cased on both sides of the `=`: the keyword names the class slot,
      // and the temporary names the field the walk produced. They are the same
      // name by construction — see the pin naming note in `shm-leaves`.
      const upper = pin.name.toUpperCase()
      return `${upper}=_${[...fieldPath, upper].join('_')}`
    })
    return `${typeName}(${args.join(', ')})`
  }

  /* istanbul ignore next -- defensive: callers only assemble composites */
  return base && (base.definition === 'user-data-type' || base.definition === 'derived')
    ? buildFor(base.value, path)
    : `_${path.join('_')}`
}

/** Decode one leaf out of `_vals` into `local`. */
const decodeLeaf = (leaf: ShmLeaf, local: string, indent: string): string => {
  const { descriptor, count } = leaf
  let code = ''

  if (count > 1) {
    code += `${indent}${local} = list(_vals[_idx:_idx+${count}])\n`
    code += `${indent}_idx += ${count}\n`
    return code
  }

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
  const expr = leaf.path.join('.')
  const { descriptor, count } = leaf

  if (count > 1) return `    _out.extend(${expr})\n`

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
