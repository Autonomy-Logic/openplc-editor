/**
 * Compose the OpenPLC Runtime v4 upload bundle.
 *
 * Canonical, pure function that builds the file map sent to the
 * runtime as `program.zip` (or written to disk as
 * `<build>/<target>/src/` on the editor side before being compressed).
 *
 * **Single source of truth for the upload zip contract.**  Today
 * openplc-web's `compileProgram` calls into this function.
 * openplc-editor's `compileProgram` still scatters the equivalent
 * `writeFile` calls across `handleGenerate*Config` /
 * `handleGenerateCBlocksHeader` / `handleGenerateCBlocksCode` /
 * inline `defines.h` write — same outputs, different code path.
 * Editor MUST be routed through this composer in a follow-up so the
 * contract becomes literally impossible to drift; until then, every
 * change here REQUIRES a matching change in `compiler-module.ts`,
 * and vice versa.  Tests pin the file layout so symptoms of drift
 * show up loudly.
 *
 * Side effects: none.  No disk I/O, no HTTP, no DOM.  Inputs in,
 * `Record<string, string>` out.  The caller is responsible for
 * writing to disk (editor: per-file `fs.writeFile`) or zipping
 * (web: `JSZip`).
 *
 * Per-target bundle inputs:
 *  - `strucppFiles`: output of `runProgramBuildPipeline` — at minimum
 *    `generated.cpp`, `generated.hpp`, `generated_debug.cpp`,
 *    `debug-map.json`; plus any per-POU `*.cpp` splits and
 *    `program.st.map.json` newer strucpp builds emit.  Keys land at
 *    the zip root.
 *  - `strucppRuntimeHeaders`: the strucpp runtime `.hpp` set
 *    (`iec_std_lib.hpp`, `debug_dispatch.hpp`, …) keyed under
 *    `strucpp_runtime/include/<filename>` — the path the runtime's
 *    `core/scripts/compile.sh` looks for.  Platform-provided so the
 *    composer stays I/O-free (editor: read off disk; web: Vite glob).
 *  - Conf inputs come pre-rendered as JSON strings.  Generation
 *    helpers themselves stay in `frontend/utils/{modbus,opcua,s7comm}`
 *    and `backend/shared/{ethercat,utils/modbus}` — callers invoke
 *    them and pass the result through, so the composer doesn't pull
 *    a layer it doesn't need (and so callers can branch / report
 *    errors at their own pace).
 *
 * Mirror of the file layout editor's `handleCompile` produces under
 * `<build>/<target>/src/` for `boardRuntime === 'openplc-compiler'`.
 */

export interface ComposeRuntimeV4BundleInput {
  /** Concatenated ST program emitted by xml2st. */
  programSt: string
  /** MD5 of `programSt` — written to `defines.h` so the v4 runtime
   *  shim (`runtime_v4_entry.cpp`) can report it via FC 0x45. */
  md5: string
  /** Strucpp emitted artefacts (key = filename at zip root, value
   *  = file content).  Typically: generated.cpp, generated.hpp,
   *  generated_debug.cpp, debug-map.json, per-POU *.cpp splits,
   *  program.st.map.json. */
  strucppFiles: Record<string, string>
  /** Pre-rendered C blocks artefacts.  The composer treats them as
   *  opaque strings:
   *    - `header`: required.  Empty / no-cpp projects pass
   *      `'// Empty file\n'` (matches editor's static stub copied
   *      from `resources/sources/arduino/c_blocks.h`).
   *    - `code`: pass `null` when the project has no C/C++ POUs; the
   *      runtime build skips the file via wildcard glob.  Otherwise
   *      pass the output of `generateCBlocksCode(originalCppPous)`. */
  cBlocks: {
    header: string
    code: string | null
  }
  /** Strucpp runtime headers keyed under `strucpp_runtime/include/<filename>`.
   *  The composer doesn't read them itself because their source
   *  differs per platform (editor: filesystem read of the strucpp npm
   *  package; web: Vite `?raw` glob at bundle time). */
  strucppRuntimeHeaders: Record<string, string>
  /** Pre-rendered config JSON strings (null when the project has no
   *  config of that type — caller skips writing).  See the docblock
   *  for which helper produces each. */
  confs: {
    /** From `generateModbusSlaveConfig(servers)`. */
    modbusSlave: string | null
    /** From `generateModbusMasterConfig(remoteDevices)`. */
    modbusMaster: string | null
    /** From `generateS7CommConfig(servers)`. */
    s7Comm: string | null
    /** From `generateOpcUaConfig(servers, generated_debug.cpp, instances)`.
     *  Caller catches `OpcUaConfigError` and surfaces it before
     *  calling the composer — passing `null` skips the file. */
    opcUa: string | null
    /** From `generateEthercatConfig(remoteDevices)`.  Caller should
     *  run `validateEthercatConfig` first and abort the compile (not
     *  call the composer) when validation produces errors. */
    ethercat: string
  }
}

/**
 * Build the file map.  Output keys are paths relative to the zip
 * root (which is what the runtime extracts into `core/generated/`).
 */
export function composeRuntimeV4Bundle(input: ComposeRuntimeV4BundleInput): Record<string, string> {
  const files: Record<string, string> = {}

  // 1. Concatenated ST program (xml2st output)
  files['program.st'] = input.programSt

  // 2. Strucpp emitted artefacts at the zip root
  for (const [name, content] of Object.entries(input.strucppFiles)) {
    files[name] = content
  }

  // 3. Strucpp runtime headers (`strucpp_runtime/include/*.hpp`) —
  //    expected layout for `core/scripts/compile.sh:check_required_files`
  for (const [path, content] of Object.entries(input.strucppRuntimeHeaders)) {
    files[path] = content
  }

  // 4. defines.h with PROGRAM_MD5 — mirrors editor's emission in
  //    `compiler-module.ts` (the v4 runtime shim reads PROGRAM_MD5 to
  //    answer the editor's FC 0x45 DEBUG_GET_MD5 query).
  files['defines.h'] = `#pragma once\n// Program MD5\n#define PROGRAM_MD5 "${input.md5}"\n`

  // 5. c_blocks.h — empty stub when there are no C/C++ POUs (matches
  //    the editor's static `resources/sources/arduino/c_blocks.h`
  //    that gets copied first), generated header otherwise.  C/C++
  //    POU source file goes alongside ONLY when there are blocks to
  //    emit; otherwise the runtime build skips it via wildcard glob.
  //    The composer treats both as opaque strings — the caller runs
  //    `generateCBlocksHeader` / `generateCBlocksCode` (they live in
  //    `backend/shared/utils/cpp/` which is one layer below this
  //    composer per the arch rules) and passes the output through.
  files['c_blocks.h'] = input.cBlocks.header
  if (input.cBlocks.code) {
    files['c_blocks_code.cpp'] = input.cBlocks.code
  }

  // 6. conf/* — only the configs the project actually uses end up in
  //    the zip.  Each helper returns `null` when its protocol isn't
  //    enabled by the project; the caller passes `null` through here
  //    and we skip writing.  Editor's `handleGenerate*Config` methods
  //    do the same conditional write.
  if (input.confs.modbusSlave) files['conf/modbus_slave.json'] = input.confs.modbusSlave
  if (input.confs.modbusMaster) files['conf/modbus_master.json'] = input.confs.modbusMaster
  if (input.confs.s7Comm) files['conf/s7comm.json'] = input.confs.s7Comm
  if (input.confs.opcUa) files['conf/opcua.json'] = input.confs.opcUa
  files['conf/ethercat.json'] = input.confs.ethercat

  return files
}
