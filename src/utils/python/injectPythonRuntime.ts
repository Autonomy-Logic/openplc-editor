import { PLCVariable } from '@root/types/PLC/open-plc'

type PythonRuntimeInjectionParams = {
  fmtIn: string
  fmtOut: string
  inputVariables: PLCVariable[]
  outputVariables: PLCVariable[]
  originalCode: string
  pouName: string
}

const injectPythonRuntime = (params: PythonRuntimeInjectionParams): string => {
  const { fmtIn, fmtOut, inputVariables, outputVariables, originalCode, pouName } = params

  const outputInitialization =
    outputVariables.length > 0
      ? outputVariables
          .map((variable) => {
            const defaultValue = variable.type?.value === 'string' ? '""' : variable.initialValue || 0
            return `${variable.name} = ${defaultValue}`
          })
          .join('\n')
      : '# No output variables to initialize'

  const inputVariableNames = (() => {
    if (inputVariables.length === 0) return ''

    const variablesList = inputVariables
      .map((variable) => {
        if (variable.type?.value === 'string') {
          return `${variable.name}_body, ${variable.name}_len`
        }
        return variable.name
      })
      .join(', ')

    const totalElements = inputVariables.reduce((count, variable) => {
      return count + (variable.type?.value === 'string' ? 2 : 1)
    }, 0)

    return totalElements === 1 ? `${variablesList},` : variablesList
  })()

  const outputVariableNames =
    outputVariables.length > 0 ? outputVariables.map((variable) => variable.name).join(', ') : ''

  const stringDecodingLines = inputVariables
    .filter((variable) => variable.type?.value === 'string')
    .map(
      (variable) =>
        `    ${variable.name} = ${variable.name}_body[:${variable.name}_len].decode('utf-8', errors='ignore')`,
    )
    .join('\n')

  const readInputSection =
    inputVariables.length > 0
      ? `    # Read input variables
    values_in = struct.unpack(fmt_in, shm_in.buf[:data_size_in])
    (${inputVariableNames}) = values_in${stringDecodingLines ? '\n' + stringDecodingLines : ''}`
      : `    # No input variables to read`

  const writeOutputSection =
    outputVariables.length > 0
      ? `    # Write output variables
    packed = struct.pack(fmt_out, ${outputVariableNames})
    shm_out.buf[:data_size_out] = packed`
      : `    # No output variables to write`

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

# Initialize output variables here - if any
${outputInitialization}

# Initialize block
block_init()
data_size_in = struct.calcsize(fmt_in)
data_size_out = struct.calcsize(fmt_out)
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
