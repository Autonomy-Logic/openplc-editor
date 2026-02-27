import { PLCVariable } from '@root/types/PLC/open-plc'
import { getArrayTotalElements, getVariableIECType, isArrayVariable } from '@root/utils/PLC/array-codegen-helpers'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
  processedPythonCode: string
}

const generateStructField = (variable: PLCVariable): string => {
  const iecType = getVariableIECType(variable)
  if (isArrayVariable(variable)) {
    const totalElements = getArrayTotalElements(variable)
    return `        ${iecType} ${variable.name}[${totalElements}];\n`
  }
  return `        ${iecType} ${variable.name};\n`
}

const generateCStructs = (inputVars: PLCVariable[], outputVars: PLCVariable[]): string => {
  let structs = ''

  // Input struct
  structs += '    #pragma pack(push, 1)\n'
  structs += '    typedef struct {\n'
  if (inputVars.length > 0) {
    inputVars.forEach((variable) => {
      structs += generateStructField(variable)
    })
  } else {
    // Padding field ensures sizeof() >= 1, preventing mmap() failure with size 0.
    structs += '        uint8_t _padding;\n'
  }
  structs += '    } shm_data_in_t;\n'
  structs += '    #pragma pack(pop)\n\n'

  // Output struct
  structs += '    #pragma pack(push, 1)\n'
  structs += '    typedef struct {\n'
  if (outputVars.length > 0) {
    outputVars.forEach((variable) => {
      structs += generateStructField(variable)
    })
  } else {
    // Padding field ensures sizeof() >= 1, preventing mmap() failure with size 0.
    structs += '        uint8_t _padding;\n'
  }
  structs += '    } shm_data_out_t;\n'

  return structs
}

const generateInputCopyCode = (inputVars: PLCVariable[]): string => {
  if (inputVars.length === 0) return ''

  let code = '        shm_data_in_t data_in;\n'

  inputVars.forEach((variable) => {
    const isString = variable.type?.definition === 'base-type' && variable.type?.value === 'string'
    const upperName = variable.name.toUpperCase()

    if (isArrayVariable(variable)) {
      const totalElements = getArrayTotalElements(variable)
      code += `        for (int __i = 0; __i < ${totalElements}; __i++) data_in.${variable.name}[__i] = data__->${upperName}.value.table[__i].value;\n`
    } else if (isString) {
      code += `        data_in.${variable.name}.len = data__->${upperName}.value.len;\n`
      code += `        memcpy(data_in.${variable.name}.body, data__->${upperName}.value.body, STR_MAX_LEN);\n`
    } else {
      code += `        data_in.${variable.name} = data__->${upperName}.value;\n`
    }
  })

  code += '        memcpy(shm_in_ptr, &data_in, sizeof(data_in));\n\n'

  return code
}

const generateOutputCopyCode = (outputVars: PLCVariable[]): string => {
  if (outputVars.length === 0) return ''

  let code = '        shm_data_out_t data_out;\n'
  code += '        memcpy(&data_out, shm_out_ptr, sizeof(data_out));\n'

  outputVars.forEach((variable) => {
    const isString = variable.type?.definition === 'base-type' && variable.type?.value === 'string'
    const upperName = variable.name.toUpperCase()

    if (isArrayVariable(variable)) {
      const totalElements = getArrayTotalElements(variable)
      code += `        for (int __i = 0; __i < ${totalElements}; __i++) data__->${upperName}.value.table[__i].value = data_out.${variable.name}[__i];\n`
    } else if (isString) {
      code += `        data__->${upperName}.value.len = data_out.${variable.name}.len;\n`
      code += `        memcpy(data__->${upperName}.value.body, data_out.${variable.name}.body, STR_MAX_LEN);\n`
    } else {
      code += `        data__->${upperName}.value = data_out.${variable.name};\n`
    }
  })

  return code
}

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables, processedPythonCode } = params

  const inputVariables = allVariables.filter((v) => v.class === 'input')
  const outputVariables = allVariables.filter((v) => v.class === 'output')

  const cStructs = generateCStructs(inputVariables, outputVariables)
  const inputCopyCode = generateInputCopyCode(inputVariables)
  const outputCopyCode = generateOutputCopyCode(outputVariables)

  const escapedPythonCode = processedPythonCode
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n"\n            "')

  const stCode = `(* Type definitions *)
{{
    typedef uint8_t  IEC_BOOL;
    typedef int8_t    IEC_SINT;
    typedef int16_t   IEC_INT;
    typedef int32_t   IEC_DINT;
    typedef int64_t   IEC_LINT;
    typedef uint8_t    IEC_USINT;
    typedef uint16_t   IEC_UINT;
    typedef uint32_t   IEC_UDINT;
    typedef uint64_t   IEC_ULINT;
    typedef uint8_t    IEC_BYTE;
    typedef uint16_t   IEC_WORD;
    typedef uint32_t   IEC_DWORD;
    typedef uint64_t   IEC_LWORD;
    typedef float    IEC_REAL;
    typedef double   IEC_LREAL;
    #define STR_LEN_TYPE int8_t
    #define STR_MAX_LEN 126
    typedef STR_LEN_TYPE __strlen_t;
    typedef struct {
        __strlen_t len;
        uint8_t body[STR_MAX_LEN];
    } IEC_STRING;

${cStructs}
}}

if first_run = false then
    {{
        pid_t pid = getpid();
        void *shm_in_ptr = NULL;
        void *shm_out_ptr = NULL;
        char shm_name[128];
        create_shm_name(shm_name, sizeof(shm_name));

        const char *script_name = "${pouName}.py";
        const char script_template[] =
            "${escapedPythonCode}";

        if (python_block_loader(script_name, script_template, shm_name, sizeof(shm_data_in_t), sizeof(shm_data_out_t), &shm_in_ptr, &shm_out_ptr, pid) < 0)
        {
            printf("an error occurred!\\n");
            return;
        }

        data__->SHM_IN_PTR.value = (uint64_t)shm_in_ptr;
        data__->SHM_OUT_PTR.value = (uint64_t)shm_out_ptr;
    }}
    first_run := true;
else
    {{
        void *shm_in_ptr = (void *)data__->SHM_IN_PTR.value;
        void *shm_out_ptr = (void *)data__->SHM_OUT_PTR.value;

        if (shm_in_ptr == NULL)
        {
            printf("shm_in_ptr is NULL!\\n");
            return;
        }
        if (shm_out_ptr == NULL)
        {
            printf("shm_out_ptr is NULL!\\n");
            return;
        }

${inputCopyCode}${outputCopyCode}    }}
end_if;`

  return stCode
}

export { generateSTCode, type STCodeGenerationParams }
