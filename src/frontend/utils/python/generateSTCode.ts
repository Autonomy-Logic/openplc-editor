import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayStartIndex, getArrayTotalElements, isArrayVariable } from '../PLC/array-codegen-helpers'
import { describeShmField, SHM_STRING_CHARS } from './shm-type-map'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
  processedPythonCode: string
}

/**
 * Which of the three SHM shapes a field takes, from the one table both sides
 * read (`shm-type-map.ts`). `null` never reaches here in a real compile —
 * `preprocessPous` refuses an unsupported type first — but the emitters stay
 * total so a direct caller cannot produce a half-formed struct.
 */
const fieldKind = (variable: PLCVariable): 'scalar' | 'string' | 'wstring' | null =>
  describeShmField(variable)?.kind ?? null

/**
 * Raw C type for an SHM struct field.
 *
 * SHM is a packed binary protocol Python decodes with `struct.unpack`, so every
 * field must be a trivially-copyable C primitive. The strucpp `IEC_T` aliases
 * resolve to `IECVar<T>` wrappers with a non-trivial copy assignment, so
 * memcpy'ing into them is UB and gcc fires `-Wclass-memaccess`. The C stub
 * bridges between the wrapper (force-aware reads and writes on the IEC side)
 * and these raw fields at the boundary.
 */
const shmFieldType = (variable: PLCVariable): string =>
  describeShmField(variable)?.cType ?? 'uint8_t'

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
    const kind = fieldKind(variable)

    if (isArrayVariable(variable)) {
      // Iterate IEC indices and pull each element through `.get()` so
      // forced array elements appear in shared memory the same way they
      // appear to the IEC program logic.
      const totalElements = getArrayTotalElements(variable)
      const startIdx = getArrayStartIndex(variable)
      code += `        for (int __i = 0; __i < ${totalElements}; __i++) data_in.${fieldName}[__i] = ${upperName}[${startIdx} + __i].get();\n`
    } else if (kind === 'string') {
      // IECStringVar::get() returns IECString<N> by value — bind once to a
      // local so c_str() / length() refer to the same temporary. Copy only the
      // characters that exist and zero the rest, so the body is deterministic
      // rather than carrying whatever the wrapper's tail held.
      code += `        { auto __s = ${upperName}.get();\n`
      code += `          __strlen_t __n = (__strlen_t)(__s.length() < STR_MAX_LEN ? __s.length() : STR_MAX_LEN);\n`
      code += `          data_in.${fieldName}.len = __n;\n`
      code += `          std::memset(data_in.${fieldName}.body, 0, STR_MAX_LEN);\n`
      code += `          std::memcpy(data_in.${fieldName}.body, __s.c_str(), (size_t)__n); }\n`
    } else if (kind === 'wstring') {
      // WSTRING is UTF-16: `length()` counts code units and `c_str()` yields
      // `const char16_t*`, so the byte count is twice the length. The previous
      // code copied STR_MAX_LEN *bytes* (63 code units) while writing a length
      // in characters, which put the two sides permanently out of step.
      code += `        { auto __s = ${upperName}.get();\n`
      code += `          __strlen_t __n = (__strlen_t)(__s.length() < STR_MAX_LEN ? __s.length() : STR_MAX_LEN);\n`
      code += `          data_in.${fieldName}.len = __n;\n`
      code += `          std::memset(data_in.${fieldName}.body, 0, STR_MAX_LEN * sizeof(uint16_t));\n`
      code += `          std::memcpy(data_in.${fieldName}.body, __s.c_str(), (size_t)__n * sizeof(uint16_t)); }\n`
    } else {
      // Scalar — IECVar's implicit conversion to T routes through .get()
      // so a forced input is observed correctly.
      code += `        data_in.${fieldName} = ${upperName};\n`
    }
  })

  code += '        memcpy(shm_in_ptr, &data_in, sizeof(data_in));\n\n'

  return code
}

/**
 * Publish the IEC-side output values into shared memory once, at startup.
 *
 * Without this the Python block seeds its output globals from the declaration
 * (`initialValue || 0`) and writes them back after its very first
 * `block_loop()`, before the user's code has assigned anything — so whatever
 * the IEC variable held is destroyed. Today that discards a declared initial
 * value; once a Python block can carry RETAIN it destroys the retained value on
 * every restart, which is the exact opposite of what retain is for.
 *
 * Shared memory is created zeroed, so there is nothing for Python to seed from
 * unless the C side puts it there. This is the mirror of `generateOutputCopyCode`
 * — same fields, opposite direction — and runs in the `first_run` branch right
 * after the loader has mapped the segment.
 */
const generateOutputSeedCode = (outputVars: PLCVariable[]): string => {
  if (outputVars.length === 0) return ''

  let code = '        shm_data_out_t seed_out;\n'
  code += '        std::memset(&seed_out, 0, sizeof(seed_out));\n'

  outputVars.forEach((variable) => {
    const upperName = variable.name.toUpperCase()
    const fieldName = variable.name
    const kind = fieldKind(variable)

    if (isArrayVariable(variable)) {
      const totalElements = getArrayTotalElements(variable)
      const startIdx = getArrayStartIndex(variable)
      code += `        for (int __i = 0; __i < ${totalElements}; __i++) seed_out.${fieldName}[__i] = ${upperName}[${startIdx} + __i].get();\n`
    } else if (kind === 'string') {
      code += `        { auto __s = ${upperName}.get();\n`
      code += `          __strlen_t __n = (__strlen_t)(__s.length() < STR_MAX_LEN ? __s.length() : STR_MAX_LEN);\n`
      code += `          seed_out.${fieldName}.len = __n;\n`
      code += `          std::memcpy(seed_out.${fieldName}.body, __s.c_str(), (size_t)__n); }\n`
    } else if (kind === 'wstring') {
      code += `        { auto __s = ${upperName}.get();\n`
      code += `          __strlen_t __n = (__strlen_t)(__s.length() < STR_MAX_LEN ? __s.length() : STR_MAX_LEN);\n`
      code += `          seed_out.${fieldName}.len = __n;\n`
      code += `          std::memcpy(seed_out.${fieldName}.body, __s.c_str(), (size_t)__n * sizeof(uint16_t)); }\n`
    } else {
      code += `        seed_out.${fieldName} = ${upperName};\n`
    }
  })

  code += '        memcpy(shm_out_ptr, &seed_out, sizeof(seed_out));\n'
  return code
}

const generateOutputCopyCode = (outputVars: PLCVariable[]): string => {
  if (outputVars.length === 0) return ''

  let code = '        shm_data_out_t data_out;\n'
  code += '        memcpy(&data_out, shm_out_ptr, sizeof(data_out));\n'

  outputVars.forEach((variable) => {
    const upperName = variable.name.toUpperCase()
    const fieldName = variable.name
    const kind = fieldKind(variable)

    if (isArrayVariable(variable)) {
      const totalElements = getArrayTotalElements(variable)
      const startIdx = getArrayStartIndex(variable)
      // Element-wise assignment; IECVar::operator=(T) routes through
      // .set(), which is a no-op when forced — Python user writes to a
      // forced array element are silently dropped on the IEC side.
      code += `        for (int __i = 0; __i < ${totalElements}; __i++) ${upperName}[${startIdx} + __i] = data_out.${fieldName}[__i];\n`
    } else if (kind === 'string') {
      code += `        ${upperName} = strucpp::IECString<254>(reinterpret_cast<const char*>(data_out.${fieldName}.body), data_out.${fieldName}.len);\n`
    } else if (kind === 'wstring') {
      // Reconstruct from char16_t units, not bytes — the mirror of the copy-in
      // fix above. Reinterpreting the body as `char*` (what this did before)
      // handed IECWString half a string.
      code += `        ${upperName} = strucpp::IECWString<254>(reinterpret_cast<const char16_t*>(data_out.${fieldName}.body), data_out.${fieldName}.len);\n`
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
  const outputSeedCode = generateOutputSeedCode(outputVariables)

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
    #define STR_MAX_LEN ${SHM_STRING_CHARS}
    typedef STR_LEN_TYPE __strlen_t;
    // These MUST be packed in their own right, not merely used inside a packed
    // struct: #pragma pack applies to the struct being defined, never to a
    // member type that was already laid out. shm_iec_string_t survived without
    // it only because uint8_t needs no alignment; the wstring uint16_t body
    // forces a padding byte after the length field, making it 254 bytes where
    // Python packs 253 - a one-byte shift that corrupts every later field.
    #pragma pack(push, 1)
    typedef struct {
        __strlen_t len;
        uint8_t body[STR_MAX_LEN];
    } shm_iec_string_t;
    typedef struct {
        __strlen_t len;
        uint16_t body[STR_MAX_LEN];
    } shm_iec_wstring_t;
    #pragma pack(pop)

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

        // Publish the current IEC output values so the Python side can seed
        // from them instead of from its declarations. Shared memory is created
        // zeroed; without this the block's first write-back would overwrite the
        // IEC value (a retained one included) with a default.
${outputSeedCode}    }
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
