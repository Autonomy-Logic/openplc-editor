import type { PLCDataType, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { LibraryFunctionBlockSource } from '../PLC/function-block-pins'
import { pythonInboundVariables, pythonOutboundVariables } from './block-interface'
import type { ShmLeaf, ShmWalkContext } from './shm-leaves'
import { describeShmLayout, describeShmLeaves, pythonFunctionBlockInstances } from './shm-leaves'
import { SHM_STRING_CHARS } from './shm-type-map'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
  processedPythonCode: string
  /** The project's data types, so a structure or enumeration can be walked. */
  dataTypes?: readonly PLCDataType[]
  /** Project POUs, for resolving a function block instance's pins. */
  pous?: readonly PLCPou[]
  /** Bundled libraries, for resolving a standard block such as TON. */
  libraries?: readonly LibraryFunctionBlockSource[]
}

/**
 * Which of the three SHM shapes a field takes, from the one table both sides
 * read (`shm-type-map.ts`). `null` never reaches here in a real compile —
 * `preprocessPous` refuses an unsupported type first — but the emitters stay
 * total so a direct caller cannot produce a half-formed struct.
 */
const generateStructField = (leaf: ShmLeaf): string => {
  // One field per leaf. An array is many leaves, so it is many fields — the
  // same shape the compiler's own leaf enumeration has.
  return `        ${leaf.descriptor.cType} ${leaf.field};\n`
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
  const { field, access, descriptor } = leaf
  const shm = `${struct}.${field}`

  // No array branch: `access` already names one element, subscripted the way
  // strucpp expects — `A[3]` for rank 1, `G(1, 0)` for rank 2 and 3, whose
  // backing storage is private so there is no flat accessor to loop over.

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
    //
    // GUARDED, because the transport is narrower than the declared type. A
    // strucpp `IECStringVar` / `IECWStringVar` holds 254 characters, while the
    // SHM body carries STR_MAX_LEN (the cap the debug protocol frames at). An
    // IEC string longer than that reaches Python already truncated, so writing
    // Python's copy back would shorten the IEC variable permanently — with no
    // user code having touched it. Now that `local`, `inOut` and `external`
    // round-trip, that turned a read into a destructive write.
    //
    // The current length is what says whether anything was lost: at or under the
    // cap, Python holds the whole value and the write-back is faithful; over it,
    // Python holds a prefix and the IEC value is left alone. A string that fits
    // — the ordinary case — round-trips exactly as before.
    // The capacity comes from strucpp, not from a literal here.
    // `IEC_STRING` / `IEC_WSTRING` are the aliases strucpp declares FOR CODEGEN
    // (`using IEC_STRING = IECStringVar<254>;`), and `::value_type` is the value
    // type behind the variable — so this names exactly the type the compiler
    // gave the variable, and tracks it if strucpp ever changes the default. It
    // used to say `IECString<254>`, which was the right number written in the
    // wrong place: nothing would have caught it drifting.
    const alias = wide ? 'IEC_WSTRING' : 'IEC_STRING'
    const pointer = wide ? 'const char16_t*' : 'const char*'
    let code = `        { auto __cur = ${access}.get();\n`
    code += `          if (__cur.length() <= STR_MAX_LEN)\n`
    code += `            ${access} = strucpp::${alias}::value_type(reinterpret_cast<${pointer}>(${shm}.body), ${shm}.len); }\n`
    return code
  }

  if (leaf.enumTypeName) {
    // An `IEC_ENUM_Var` yields an `IEC_ENUM_Value`, which converts to the scoped
    // enum but not to an integer, so the read goes through both and then casts.
    // The write goes through `set()` rather than `operator=`, which would
    // copy-assign a whole temporary wrapper and take the forced state with it.
    const enumType = leaf.enumTypeName.toUpperCase()
    // An element of an array OF this enumeration is a RAW scoped enum, because
    // the container holds values rather than wrappers — so it converts and
    // assigns directly, where a wrapper needs `.get().get()` and `.set()`.
    // Found by an on-device build: `MODES[0].get().get()` does not compile.
    if (leaf.arrayElement) {
      return toShm
        ? `        ${shm} = static_cast<${descriptor.cType}>(${access});\n`
        : `        ${access} = static_cast<${enumType}>(${shm});\n`
    }
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
const generateCopies = (variables: PLCVariable[], context: ShmWalkContext, struct: string, toShm: boolean): string => {
  let code = ''
  for (const variable of variables) {
    const result = describeShmLeaves(variable, context)
    /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
    if ('refusal' in result) continue
    const body = result.leaves.map((leaf) => generateLeafCopy(throughLock(variable, leaf), struct, toShm)).join('')
    code += withExternalLock(variable, body)
  }
  return code
}

const generateInputCopyCode = (variables: PLCVariable[], context: ShmWalkContext): string => {
  if (variables.length === 0) return ''
  let code = '        shm_data_in_t data_in;\n'
  code += generateCopies(variables, context, 'data_in', true)
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
const generateOutputSeedCode = (variables: PLCVariable[], context: ShmWalkContext): string => {
  if (variables.length === 0) return ''
  let code = '        shm_data_out_t seed_out;\n'
  code += '        std::memset(&seed_out, 0, sizeof(seed_out));\n'
  code += generateCopies(variables, context, 'seed_out', true)
  code += '        memcpy(shm_out_ptr, &seed_out, sizeof(seed_out));\n'
  return code
}

const generateOutputCopyCode = (variables: PLCVariable[], context: ShmWalkContext): string => {
  if (variables.length === 0) return ''
  let code = '        shm_data_out_t data_out;\n'
  code += '        memcpy(&data_out, shm_out_ptr, sizeof(data_out));\n'
  code += generateCopies(variables, context, 'data_out', false)
  return code
}

/**
 * One ST call per function block instance the block declares.
 *
 * This is what makes an instance usable from Python at all. Python cannot call
 * it — it runs in another process — but the wrapper does, in the PLC process
 * where the instance lives, once per scan. The call sits between applying
 * Python's writes to the input pins and publishing the pins back, so within a
 * scan the sequence is: take what Python wrote, run the instance, report what it
 * produced.
 *
 * Written as ST rather than inside an `{external}` block so the call goes through
 * the same path a hand-written `ton0();` would, including the EN gate the
 * compiler puts at every call site.
 */
const generateInstanceCalls = (instances: PLCVariable[]): string =>
  instances.map((instance) => `${instance.name}();`).join('\n')

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables, processedPythonCode, dataTypes = [], pous = [], libraries = [] } = params

  const inputVariables = pythonInboundVariables(allVariables)
  const outputVariables = pythonOutboundVariables(allVariables)
  const instances = pythonFunctionBlockInstances(allVariables, dataTypes)

  // Direction decides which of a function block instance's pins cross: Python
  // drives the inputs and reads the outputs. Everything else is symmetric.
  const inbound: ShmWalkContext = { dataTypes, pous, libraries, direction: 'in' }
  const outbound: ShmWalkContext = { dataTypes, pous, libraries, direction: 'out' }

  // The struct layout and the copy statements are generated from the same leaf
  // walk, so a structure cannot be laid out one way and copied another.
  const inboundLeaves = describeShmLayout(inputVariables, inbound)
  const outboundLeaves = describeShmLayout(outputVariables, outbound)
  /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
  const cStructs = generateCStructs(
    'leaves' in inboundLeaves ? inboundLeaves.leaves : [],
    'leaves' in outboundLeaves ? outboundLeaves.leaves : [],
  )
  const inputCopyCode = generateInputCopyCode(inputVariables, inbound)
  const outputCopyCode = generateOutputCopyCode(outputVariables, outbound)
  const outputSeedCode = generateOutputSeedCode(outputVariables, outbound)
  const instanceCalls = generateInstanceCalls(instances)

  // The pointer guards, repeated in each `{external}` block that needs them:
  // ST scoping puts every block in the same function, but re-deriving them keeps
  // each block readable on its own and costs nothing.
  const mapSegments = (
    which: 'in' | 'out',
  ) => `        void *shm_${which}_ptr = (void *)(uint64_t)SHM_${which.toUpperCase()}_PTR;
        if (shm_${which}_ptr == NULL)
        {
            printf("shm_${which}_ptr is NULL!\\n");
            return;
        }
`

  // With no function block instance the exchange is one block, exactly as it was
  // before instances existed: publish the PLC's values, then take Python's back.
  //
  // With instances there is an order to respect. Python's writes have to reach
  // the input pins before the instance runs, and the pins it produces have to be
  // published after — otherwise a user setting `ton0.IN` would see `ton0.Q`
  // answer a scan late for no reason. So the exchange splits around the calls:
  // take what Python wrote, run the instances, publish what they produced.
  const exchangeCode =
    instances.length === 0
      ? `    {external
${mapSegments('in')}${mapSegments('out')}
${inputCopyCode}${outputCopyCode}    }`
      : `    {external
${mapSegments('out')}
${outputCopyCode}    }
${instanceCalls}
    {external
${mapSegments('in')}
${inputCopyCode}    }`

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
${exchangeCode}
end_if;`

  return stCode
}

export { generateSTCode, type STCodeGenerationParams }
