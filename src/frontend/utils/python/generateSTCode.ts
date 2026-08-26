import type { PLCDataType, PLCVariable } from '../../../middleware/shared/ports/types'
import { pythonInboundVariables, pythonOutboundVariables } from './block-interface'
import type { ShmLeaf } from './shm-leaves'
import { describeShmLayout, describeShmLeaves } from './shm-leaves'
import { SHM_STRING_CHARS } from './shm-type-map'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
  processedPythonCode: string
  /** The project's data types, so a structure or enumeration can be walked. */
  dataTypes?: readonly PLCDataType[]
}

/**
 * Which of the three SHM shapes a field takes, from the one table both sides
 * read (`shm-type-map.ts`). `null` never reaches here in a real compile —
 * `preprocessPous` refuses an unsupported type first — but the emitters stay
 * total so a direct caller cannot produce a half-formed struct.
 */
const generateStructField = (leaf: ShmLeaf): string => {
  const fieldType = leaf.descriptor.cType
  if (leaf.count > 1) {
    return `        ${fieldType} ${leaf.field}[${leaf.count}];\n`
  }
  return `        ${fieldType} ${leaf.field};\n`
}

const generateOneStruct = (leaves: ShmLeaf[], typeName: string): string => {
  let structs = '    #pragma pack(push, 1)\n'
  structs += '    typedef struct {\n'
  if (leaves.length > 0) {
    leaves.forEach((leaf) => {
      structs += generateStructField(leaf)
    })
  } else {
    // An empty struct is not portable C, and its size would differ between the
    // two sides. One byte nobody reads keeps the layouts agreeing.
    structs += '        uint8_t _padding;\n'
  }
  structs += `    } ${typeName};\n`
  structs += '    #pragma pack(pop)\n'
  return structs
}

const generateCStructs = (inbound: ShmLeaf[], outbound: ShmLeaf[]): string =>
  `${generateOneStruct(inbound, 'shm_data_in_t')}\n${generateOneStruct(outbound, 'shm_data_out_t')}`

/**
 * Copy one leaf between the strucpp side and a packed transport field.
 *
 * `toShm` picks the direction. Reads go through `.get()` (explicitly for arrays
 * and strings, implicitly through `IECVar`'s conversion for scalars) so a forced
 * value appears to Python exactly as it appears to the IEC program. Writes go
 * through `IECVar::operator=`, which is a no-op while forced — a Python write to
 * a forced variable is dropped on the IEC side, as it should be.
 */
const generateLeafCopy = (leaf: ShmLeaf, struct: string, toShm: boolean): string => {
  const { field, access, descriptor, count, startIndex } = leaf
  const shm = `${struct}.${field}`

  if (count > 1) {
    // Iterate IEC indices so a forced element crosses like any other.
    return toShm
      ? `        for (int __i = 0; __i < ${count}; __i++) ${shm}[__i] = ${access}[${startIndex} + __i].get();\n`
      : `        for (int __i = 0; __i < ${count}; __i++) ${access}[${startIndex} + __i] = ${shm}[__i];\n`
  }

  if (descriptor.kind === 'string' || descriptor.kind === 'wstring') {
    const wide = descriptor.kind === 'wstring'
    const unit = wide ? ' * sizeof(uint16_t)' : ''
    if (toShm) {
      // `get()` returns the string by value — bind it once so `c_str()` and
      // `length()` refer to the same temporary. Copy only the characters that
      // exist and zero the rest, so the body is deterministic rather than
      // carrying whatever the wrapper's tail held.
      let code = `        { auto __s = ${access}.get();\n`
      code += `          __strlen_t __n = (__strlen_t)(__s.length() < STR_MAX_LEN ? __s.length() : STR_MAX_LEN);\n`
      code += `          ${shm}.len = __n;\n`
      code += `          std::memset(${shm}.body, 0, STR_MAX_LEN${unit});\n`
      code += `          std::memcpy(${shm}.body, __s.c_str(), (size_t)__n${unit}); }\n`
      return code
    }
    // Reconstruct from the right unit width: a WSTRING body is char16_t, and
    // reading it as `char*` would hand IECWString half a string.
    const wrapper = wide ? 'IECWString' : 'IECString'
    const pointer = wide ? 'const char16_t*' : 'const char*'
    return `        ${access} = strucpp::${wrapper}<254>(reinterpret_cast<${pointer}>(${shm}.body), ${shm}.len);\n`
  }

  if (leaf.enumTypeName) {
    // An `IEC_ENUM_Var` yields an `IEC_ENUM_Value`, which converts to the scoped
    // enum but not to an integer, so the read goes through both and then casts.
    // The write goes through `set()` rather than `operator=`, which would
    // copy-assign a whole temporary wrapper and take the forced state with it.
    const enumType = leaf.enumTypeName.toUpperCase()
    return toShm
      ? `        ${shm} = static_cast<${descriptor.cType}>(${access}.get().get());\n`
      : `        ${access}.set(static_cast<${enumType}>(${shm}));\n`
  }

  // A plain scalar: `IECVar` converts to its value implicitly on the way out and
  // assigns through `set()` on the way back.
  if (toShm) return `        ${shm} = ${access};\n`
  return `        ${access} = ${shm};\n`
}

/**
 * Wrap a leaf's copy in its global's lock when the leaf belongs to a
 * VAR_EXTERNAL.
 *
 * A `VAR_EXTERNAL` is a `GlobalVar<V>*` — the value together with that global's
 * mutex. Naming it in a copy statement would compile, convert the pointer, and
 * read the wrong memory holding no lock at all.
 *
 * Each external is wrapped on its own rather than nested: this stub only copies
 * values, it runs no user code, so one lock at a time is enough and there is no
 * ordering to reason about. The lambda parameter is deduced, so nothing here
 * names `V`. The dereference is bound to a reference on its own line rather
 * than written inline as `(*p)`: this C++ sits inside an `{external}` block
 * that the ST front end still scans, where `(*` opens a block comment.
 */
const withExternalLock = (variable: PLCVariable, body: string): string => {
  if (variable.class !== 'external') return body
  const upperName = variable.name.toUpperCase()
  return `        ${upperName}->with_lock([&](auto* __g) {\n        auto& __r = *__g;\n${body}        });\n`
}

/**
 * Rewrite a leaf's access so it reaches through the locked reference instead of
 * the class member, for a leaf belonging to a VAR_EXTERNAL.
 */
const throughLock = (variable: PLCVariable, leaf: ShmLeaf): ShmLeaf => {
  if (variable.class !== 'external') return leaf
  const upperName = variable.name.toUpperCase()
  return { ...leaf, access: `__r${leaf.access.slice(upperName.length)}` }
}

/** Emit one direction's copies, grouping each external's leaves under its lock. */
const generateCopies = (
  variables: PLCVariable[],
  dataTypes: readonly PLCDataType[],
  struct: string,
  toShm: boolean,
): string => {
  let code = ''
  for (const variable of variables) {
    const result = describeShmLeaves(variable, dataTypes)
    /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
    if ('refusal' in result) continue
    const body = result.leaves.map((leaf) => generateLeafCopy(throughLock(variable, leaf), struct, toShm)).join('')
    code += withExternalLock(variable, body)
  }
  return code
}

const generateInputCopyCode = (variables: PLCVariable[], dataTypes: readonly PLCDataType[]): string => {
  if (variables.length === 0) return ''
  let code = '        shm_data_in_t data_in;\n'
  code += generateCopies(variables, dataTypes, 'data_in', true)
  code += '        memcpy(shm_in_ptr, &data_in, sizeof(data_in));\n\n'
  return code
}

/**
 * Publish the IEC-side output values into shared memory once, at startup.
 *
 * Without this the Python block seeds its output globals from the declaration
 * and writes them back after its very first `block_loop()`, before the user's
 * code has assigned anything — so whatever the IEC variable held is destroyed.
 * Today that discards a declared initial value; once a Python block can carry
 * RETAIN it destroys the retained value on every restart, which is the exact
 * opposite of what retain is for.
 *
 * Shared memory is created zeroed, so there is nothing for Python to seed from
 * unless the C side puts it there.
 */
const generateOutputSeedCode = (variables: PLCVariable[], dataTypes: readonly PLCDataType[]): string => {
  if (variables.length === 0) return ''
  let code = '        shm_data_out_t seed_out;\n'
  code += '        std::memset(&seed_out, 0, sizeof(seed_out));\n'
  code += generateCopies(variables, dataTypes, 'seed_out', true)
  code += '        memcpy(shm_out_ptr, &seed_out, sizeof(seed_out));\n'
  return code
}

const generateOutputCopyCode = (variables: PLCVariable[], dataTypes: readonly PLCDataType[]): string => {
  if (variables.length === 0) return ''
  let code = '        shm_data_out_t data_out;\n'
  code += '        memcpy(&data_out, shm_out_ptr, sizeof(data_out));\n'
  code += generateCopies(variables, dataTypes, 'data_out', false)
  return code
}

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables, processedPythonCode, dataTypes = [] } = params

  const inputVariables = pythonInboundVariables(allVariables)
  const outputVariables = pythonOutboundVariables(allVariables)

  // The struct layout and the copy statements are generated from the same leaf
  // walk, so a structure cannot be laid out one way and copied another.
  const inboundLeaves = describeShmLayout(inputVariables, dataTypes)
  const outboundLeaves = describeShmLayout(outputVariables, dataTypes)
  /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
  const cStructs = generateCStructs(
    'leaves' in inboundLeaves ? inboundLeaves.leaves : [],
    'leaves' in outboundLeaves ? outboundLeaves.leaves : [],
  )
  const inputCopyCode = generateInputCopyCode(inputVariables, dataTypes)
  const outputCopyCode = generateOutputCopyCode(outputVariables, dataTypes)
  const outputSeedCode = generateOutputSeedCode(outputVariables, dataTypes)

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
