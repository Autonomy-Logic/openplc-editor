import type { PLCVariable } from '../../../middleware/shared/ports/types'
import {
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
} from '../PLC/array-codegen-helpers'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
  processedPythonCode: string
}

/**
 * Detect a STRING / WSTRING base-type variable. Strings flow through the
 * SHM struct as `{ len; body[STR_MAX_LEN]; }` (mirroring the historical
 * MatIEC-era layout the Python runtime side already speaks). The C-side
 * stub copies in/out of strucpp's IECStringVar at the boundary.
 */
const isStringVariable = (variable: PLCVariable): boolean => {
  if (variable.type.definition !== 'base-type') return false
  const v = variable.type.value.toLowerCase()
  return v === 'string' || v === 'wstring'
}

/** A STRING field inside the SHM struct uses the local raw layout — see
 *  the typedef emitted in the stub preamble. */
const isStringStructField = (variable: PLCVariable): boolean => isStringVariable(variable)

/**
 * Raw C type used for an SHM struct field. SHM is a packed binary
 * protocol the Python runtime decodes via `struct.unpack`, so each
 * field has to be a trivially-copyable C primitive. The strucpp
 * IEC_T aliases resolve to IECVar<T> (wrappers with a non-trivial
 * copy assignment), so memcpy'ing into them is UB and gcc rightly
 * fires `-Wclass-memaccess`. Map to the raw underlying type instead;
 * the C-side stub bridges between IECVar (force-aware reads/writes
 * on the IEC side) and these raw fields at the boundary.
 */
const RAW_TYPE_BY_BASETYPE: Record<string, string> = {
  bool: 'uint8_t',
  sint: 'int8_t',
  int: 'int16_t',
  dint: 'int32_t',
  lint: 'int64_t',
  usint: 'uint8_t',
  uint: 'uint16_t',
  udint: 'uint32_t',
  ulint: 'uint64_t',
  byte: 'uint8_t',
  word: 'uint16_t',
  dword: 'uint32_t',
  lword: 'uint64_t',
  real: 'float',
  lreal: 'double',
  time: 'int64_t',
  date: 'int64_t',
  tod: 'int64_t',
  dt: 'int64_t',
}

const shmFieldType = (variable: PLCVariable): string => {
  if (isStringStructField(variable)) return 'shm_iec_string_t'

  if (variable.type.definition === 'array' && variable.type.data) {
    const elemType = variable.type.data.baseType.value.toLowerCase()
    if (elemType === 'string') return 'shm_iec_string_t'
    return RAW_TYPE_BY_BASETYPE[elemType] ?? 'uint8_t'
  }

  if (variable.type.definition === 'base-type') {
    return RAW_TYPE_BY_BASETYPE[variable.type.value.toLowerCase()] ?? 'uint8_t'
  }

  // Defensive fallback — non-base, non-array variables shouldn't appear
  // in a Python POU's interface; emit a single byte to keep the struct
  // layout deterministic.
  return 'uint8_t'
}

const generateStructField = (variable: PLCVariable): string => {
  const fieldType = shmFieldType(variable)
  const name = variable.name
  if (isArrayVariable(variable)) {
    const totalElements = getArrayTotalElements(variable)
    return `        ${fieldType} ${name}[${totalElements}];\n`
  }
  return `        ${fieldType} ${name};\n`
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
    structs += '        uint8_t _padding;\n'
  }
  structs += '    } shm_data_out_t;\n'
  structs += '    #pragma pack(pop)\n'

  return structs
}

const generateInputCopyCode = (inputVars: PLCVariable[]): string => {
  if (inputVars.length === 0) return ''

  let code = '        shm_data_in_t data_in;\n'

  inputVars.forEach((variable) => {
    const upperName = variable.name.toUpperCase()
    const fieldName = variable.name

    if (isArrayVariable(variable)) {
      // Iterate IEC indices and pull each element through `.get()` so
      // forced array elements appear in shared memory the same way they
      // appear to the IEC program logic.
      const totalElements = getArrayTotalElements(variable)
      const startIdx = getArrayStartIndex(variable)
      code += `        for (int __i = 0; __i < ${totalElements}; __i++) data_in.${fieldName}[__i] = ${upperName}[${startIdx} + __i].get();\n`
    } else if (isStringStructField(variable)) {
      // IECStringVar::get() returns IECString<N> by value — bind once
      // to a local so c_str() / length() refer to the same temporary.
      code += `        { auto __s = ${upperName}.get();\n`
      code += `          data_in.${fieldName}.len = (__strlen_t)__s.length();\n`
      code += `          std::memcpy(data_in.${fieldName}.body, __s.c_str(), STR_MAX_LEN); }\n`
    } else {
      // Scalar — IECVar's implicit conversion to T routes through .get()
      // so a forced input is observed correctly.
      code += `        data_in.${fieldName} = ${upperName};\n`
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
    const upperName = variable.name.toUpperCase()
    const fieldName = variable.name

    if (isArrayVariable(variable)) {
      const totalElements = getArrayTotalElements(variable)
      const startIdx = getArrayStartIndex(variable)
      // Element-wise assignment; IECVar::operator=(T) routes through
      // .set(), which is a no-op when forced — Python user writes to a
      // forced array element are silently dropped on the IEC side.
      code += `        for (int __i = 0; __i < ${totalElements}; __i++) ${upperName}[${startIdx} + __i] = data_out.${fieldName}[__i];\n`
    } else if (isStringStructField(variable)) {
      const iecType = getVariableIECType(variable)
      const innerType = iecType === 'IEC_WSTRING' ? 'strucpp::IECWString<254>' : 'strucpp::IECString<254>'
      code += `        ${upperName} = ${innerType}(reinterpret_cast<const char*>(data_out.${fieldName}.body), data_out.${fieldName}.len);\n`
    } else {
      // Scalar — IECVar::operator=(T) → set(), force-respect.
      code += `        ${upperName} = data_out.${fieldName};\n`
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

  // The preamble used to redefine IEC_BOOL/IEC_INT/... typedefs and a
  // local IEC_STRING struct. STruC++ emits the {external} body inside
  // a class method that already lives under `using namespace strucpp`,
  // so all of those types are visible — the redefinitions either
  // collided with strucpp's IEC_STRING (which is IECStringVar<254>) or
  // were dead weight. Keep only the SHM-local string layout under a
  // distinct name (`shm_iec_string_t`) so it can't shadow strucpp's
  // typedef.
  //
  // Python helper symbols (`getpid`, `pid_t`, `create_shm_name`,
  // `python_block_loader`) are NOT declared here — they come from
  // iec_python.h, which the runtime's scripts/compile.sh force-includes
  // into the generated.cpp build (same toolchain trick MatIEC used).
  // The stub references them by name only, identical in spirit to
  // MatIEC-era stubs. STruC++ stays Python-unaware.
  const stCode = `(* Type definitions *)
{external
    #define STR_LEN_TYPE int8_t
    #define STR_MAX_LEN 126
    typedef STR_LEN_TYPE __strlen_t;
    typedef struct {
        __strlen_t len;
        uint8_t body[STR_MAX_LEN];
    } shm_iec_string_t;

${cStructs}
}

if first_run = false then
    {external
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

        SHM_IN_PTR = (uint64_t)shm_in_ptr;
        SHM_OUT_PTR = (uint64_t)shm_out_ptr;
    }
    first_run := true;
else
    {external
        void *shm_in_ptr = (void *)(uint64_t)SHM_IN_PTR;
        void *shm_out_ptr = (void *)(uint64_t)SHM_OUT_PTR;

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

${inputCopyCode}${outputCopyCode}    }
end_if;`

  return stCode
}

export { generateSTCode, type STCodeGenerationParams }
