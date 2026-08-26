import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayTotalElements, isArrayVariable } from '../PLC/array-codegen-helpers'
import { describeShmField, SHM_STRING_CHARS } from './shm-type-map'

type PythonRuntimeInjectionParams = {
  fmtIn: string
  fmtOut: string
  inputVariables: PLCVariable[]
  outputVariables: PLCVariable[]
  originalCode: string
  pouName: string
}

const generateInputUnpackCode = (inputVariables: PLCVariable[]): string => {
  if (inputVariables.length === 0) return '    # No input variables to read'
  return generateUnpackCode(inputVariables, {
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
 * Previously the outputs were initialised from their declarations
 * (`initialValue || 0`) and written back after the first `block_loop()`, before
 * the user's code had assigned anything — so the IEC-side value was replaced by
 * a default on every start. With RETAIN that is destructive rather than merely
 * wrong. The C stub publishes the live values into shared memory when it maps
 * the segment (see `generateOutputSeedCode`), and this reads them back.
 *
 * A block that never assigns an output now leaves it exactly as the PLC had it.
 */
const generateOutputSeedCode = (outputVariables: PLCVariable[]): string => {
  if (outputVariables.length === 0) return '# No output variables to seed'
  return generateUnpackCode(outputVariables, {
    header: '# Seed outputs from the values the PLC already holds',
    buffer: 'shm_out',
    fmt: 'fmt_out',
    size: 'data_size_out',
    indent: '',
  })
}

/**
 * Emit the unpack sequence for a set of variables.
 *
 * Shared by the per-cycle input read and the one-time output seed: both decode
 * the same packed layout, differing only in which buffer they read and at what
 * indentation. Keeping one generator means the two cannot drift in how they
 * interpret a field — the same reason the type table is shared.
 */
const generateUnpackCode = (
  variables: PLCVariable[],
  opts: { header: string; buffer: string; fmt: string; size: string; indent: string },
): string => {
  const { header, buffer, fmt, size, indent } = opts

  let code = `${header}\n`
  code += `${indent}_vals = struct.unpack(${fmt}, ${buffer}.buf[:${size}])\n`
  code += `${indent}_idx = 0\n`

  variables.forEach((variable) => {
    const kind = describeShmField(variable)?.kind

    if (isArrayVariable(variable)) {
      const count = getArrayTotalElements(variable)
      code += `${indent}${variable.name} = list(_vals[_idx:_idx+${count}])\n`
      code += `${indent}_idx += ${count}\n`
    } else if (kind === 'string' || kind === 'wstring') {
      code += `${indent}${variable.name}_len = _vals[_idx]\n`
      code += `${indent}_idx += 1\n`
      code += `${indent}${variable.name}_body = _vals[_idx]\n`
      code += `${indent}_idx += 1\n`
      // The C side clamps the length to the budget, but the prefix is a signed
      // int8 and the buffer starts zeroed, so clamp on read too: a negative
      // slice bound would silently truncate from the end instead of failing.
      code += `${indent}${variable.name}_len = max(0, min(${variable.name}_len, ${SHM_STRING_CHARS}))\n`
      if (kind === 'wstring') {
        // The length counts UTF-16 code units, so the byte slice is twice it.
        code += `${indent}${variable.name} = ${variable.name}_body[:${variable.name}_len * 2].decode('utf-16-le', errors='ignore')\n`
      } else {
        code += `${indent}${variable.name} = ${variable.name}_body[:${variable.name}_len].decode('utf-8', errors='ignore')\n`
      }
    } else {
      code += `${indent}${variable.name} = _vals[_idx]\n`
      code += `${indent}_idx += 1\n`
    }
  })

  return code
}

/**
 * Generate Python code that packs output variables into the flat struct format.
 * Arrays are flattened via extend(), scalars and string pairs via append().
 */
const generateOutputPackCode = (outputVariables: PLCVariable[]): string => {
  if (outputVariables.length === 0) return '    # No output variables to write'

  let code = '    # Write output variables\n'
  code += '    _out = []\n'

  outputVariables.forEach((variable) => {
    if (isArrayVariable(variable)) {
      code += `    _out.extend(${variable.name})\n`
    } else if (describeShmField(variable)?.kind === 'string') {
      code += `    _body = ${variable.name}.encode('utf-8')[:${SHM_STRING_CHARS}]\n`
      code += `    _len = len(_body)\n`
      code += `    _body = _body.ljust(${SHM_STRING_CHARS}, b'\\0')\n`
      code += `    _out.append(_len)\n`
      code += `    _out.append(_body)\n`
    } else if (describeShmField(variable)?.kind === 'wstring') {
      // Truncate on a code-unit boundary, never mid-unit: encode, clip to the
      // byte budget, then round down to an even length. `_len` is the code-unit
      // count the C side expects, not the byte count.
      code += `    _body = ${variable.name}.encode('utf-16-le')[:${SHM_STRING_CHARS * 2}]\n`
      code += `    _body = _body[: len(_body) - (len(_body) % 2)]\n`
      code += `    _len = len(_body) // 2\n`
      code += `    _body = _body.ljust(${SHM_STRING_CHARS * 2}, b'\\0')\n`
      code += `    _out.append(_len)\n`
      code += `    _out.append(_body)\n`
    } else {
      code += `    _out.append(${variable.name})\n`
    }
  })

  code += '    packed = struct.pack(fmt_out, *_out)\n'
  code += '    shm_out.buf[:data_size_out] = packed'

  return code
}

const injectPythonRuntime = (params: PythonRuntimeInjectionParams): string => {
  const { fmtIn, fmtOut, inputVariables, outputVariables, originalCode, pouName } = params

  const outputSeeding = generateOutputSeedCode(outputVariables)
  const readInputSection = generateInputUnpackCode(inputVariables)
  const writeOutputSection = generateOutputPackCode(outputVariables)

  const injectedCode = `
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
