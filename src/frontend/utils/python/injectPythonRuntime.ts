import type { PLCDataType, PLCVariable } from '../../../middleware/shared/ports/types'
import { resolveFunctionBlockPins } from '../PLC/function-block-pins'
import { pythonShmRuntime } from './python-shm-runtime'
import { renderLayoutTable } from './shm-layout-table'
import type { ShmLeaf, ShmWalkContext } from './shm-leaves'
import { describeShmLayout, pinCrossesInDirection, pythonFunctionBlockInstances } from './shm-leaves'
import { SHM_STRING_CHARS } from './shm-type-map'

type PythonRuntimeInjectionParams = {
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

/** The leaves of a direction, or an empty list when a refusal stopped the build. */
const leavesFor = (variables: PLCVariable[], context: ShmWalkContext): ShmLeaf[] => {
  const walked = describeShmLayout(variables, context)
  /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
  return 'refusal' in walked ? [] : walked.leaves
}

const injectPythonRuntime = (params: PythonRuntimeInjectionParams): string => {
  const { inputVariables, outputVariables, originalCode, pouName, inbound, outbound } = params

  const inLeaves = leavesFor(inputVariables, inbound)
  const outLeaves = leavesFor(outputVariables, outbound)

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

${renderLayoutTable('_SHM_IN', inLeaves)}

${renderLayoutTable('_SHM_OUT', outLeaves)}
${pythonShmRuntime(SHM_STRING_CHARS)}

try:
    shm_in = shared_memory.SharedMemory(name='%s_in')
    shm_out = shared_memory.SharedMemory(name='%s_out')
except Exception as e:
    print(f'Error on shared memory: {e}')
    exit(1)

data_size_in = _shm_total(_SHM_IN)
data_size_out = _shm_total(_SHM_OUT)

# The segment was created with sizeof() of the packed struct the C side
# compiled. If the table and that struct disagree, every field after the first
# difference is misread — so refuse to start rather than run on a layout that
# does not describe the memory. Costs one comparison, once.
if data_size_in > shm_in.size or data_size_out > shm_out.size:
    print(
        'Layout mismatch: table needs '
        + str(data_size_in) + '/' + str(data_size_out)
        + ' bytes, segment provides ' + str(shm_in.size) + '/' + str(shm_out.size)
    )
    exit(1)

# Outputs start from what the PLC already holds, not from their declarations.
# The stub publishes the live values into shared memory when it maps the
# segment, so a block that never assigns an output leaves it untouched — and a
# RETAIN output survives the restart it exists to survive.
_shm_unpack(shm_out.buf, _SHM_OUT, globals())

# Initialize block
block_init()
while True:
    try:
        os.kill(plc_pid, 0)
    except Exception as e:
        print('PLC runtime has stopped.')
        break

    _shm_unpack(shm_in.buf, _SHM_IN, globals())

    # Run block
    block_loop()

    _shm_pack(shm_out.buf, _SHM_OUT, globals())

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
