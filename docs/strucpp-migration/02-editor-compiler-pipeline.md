# Phase 2: Editor Compiler Pipeline

## Goal

Replace the iec2c (MatIEC) compilation step in `compiler-module.ts` with STruC++ `compile()`.
The editor reads `program.st`, compiles it to C++, and writes `generated.cpp` + `generated.hpp`
to the build directory. The existing MatIEC pipeline is removed entirely -- no coexistence,
no routing, no backward compatibility.

At this stage, the `arduino-cli` compilation step will fail because the Arduino runtime
(sketch, adapted `openplc.h`) is not yet ready for STruC++ output. That's expected -- the
goal is to verify C++ code generation. Phase 3 addresses the runtime.

## Prerequisites

- Phase 1 complete (STruC++ installed in `node_modules`, runtime headers at `resources/strucpp/`)

## Primary File

**`src/backend/editor/compiler/compiler-module.ts`** (~2,348 lines)

The existing MatIEC pipeline steps (iec2c invocation, xml2st debug/glue generation) are
replaced by STruC++ calls. Dead MatIEC code is removed.

## Step 2.1: Remove MatIEC Pipeline

Delete or replace the following methods/steps in `compiler-module.ts`:
- `handleTranspileSTtoC()` (iec2c binary invocation) -- replaced by `handleCompileSTtoCpp()`
- `handleGenerateDebugFiles()` (xml2st --generate-debug) -- removed (debugger is Phase 4)
- `handleGenerateGlueVars()` (xml2st --generate-gluevars) -- removed (sketch handles I/O binding)
- `handlePatchGeneratedFiles()` (renames .c to .inc for unity build) -- removed (not needed for C++)
- MD5 extraction from program.st comments -- replaced by direct hash of program.st content
- References to `iec2c` binary path resolution -- removed
- MatIEC lib/ directory copying -- replaced by STruC++ runtime header copying

## Step 2.2: New STruC++ Compilation Pipeline

The `compileProgram()` method is refactored to use STruC++ directly:

```typescript
// The pipeline steps:
try {
  // === STEP 1: Create directories (unchanged) ===
  this.createBasicDirectories(projectPath, boardTarget)

  // === STEP 2: Generate XML from JSON (unchanged) ===
  await this.handleGenerateXMLfromJSON(projectData, compilationPath)

  // === STEP 3: xml2st --generate-st (unchanged) ===
  await this.handleTranspileXMLtoST(compilationPath)
  // Result: program.st in compilationPath

  // === STEP 4: Copy STruC++ runtime headers to build dir ===
  this.copyStrucppRuntimeHeaders(compilationPath)

  // === STEP 5: Compile ST to C++ with STruC++ (replaces iec2c) ===
  this.handleCompileSTtoCpp(compilationPath)

  // === STEP 6: Copy Arduino sketch + static files ===
  this.copyStrucppSketchFiles(compilationPath)

  // === STEP 7: Generate C++ blocks header/code (unchanged) ===
  await this.handleGenerateCBlocksHeader(projectData, compilationPath)
  await this.handleGenerateCBlocksCode(projectData, compilationPath)

  // === STEP 8: Copy HAL file (unchanged) ===
  await this.handleGenerateArduinoCppFile(boardTarget, compilationPath)

  // === STEP 9: Generate defines.h (unchanged in structure) ===
  await this.handleGenerateDefinitionsFile(projectData, boardTarget, compilationPath)

  // === STEP 10: Arduino compilation (with -std=gnu++17) ===
  await this.handleCoreInstallation(boardTarget)
  await this.handleLibraryInstallation(boardTarget, compilationPath)
  await this.handleCompileArduinoProgram(boardTarget, compilationPath, compileOnly)

  // === STEP 11: Upload (unchanged) ===
  if (!compileOnly) {
    await this.handleUploadProgram(boardTarget, compilationPath)
  }
} catch (error) {
  // error handling...
}
```

## Step 2.3: New Private Methods

### `copyStrucppRuntimeHeaders()`

Copies the STruC++ C++ runtime headers to the build directory:

```typescript
private copyStrucppRuntimeHeaders(compilationPath: string): void {
  const runtimeDir = path.join(this.resourcesPath, 'strucpp', 'runtime', 'include')
  if (!fs.existsSync(runtimeDir)) {
    throw new Error('STruC++ runtime headers not found. Run "npm run setup:binaries".')
  }
  for (const file of fs.readdirSync(runtimeDir)) {
    fs.copyFileSync(path.join(runtimeDir, file), path.join(compilationPath, file))
  }
}
```

### `copyStrucppSketchFiles()`

Copies the static Arduino sketch and OpenPLC support files to the build directory:

```typescript
private copyStrucppSketchFiles(compilationPath: string): void {
  const sketchDir = path.join(this.resourcesPath, 'sources', 'Baremetal')
  for (const file of fs.readdirSync(sketchDir)) {
    fs.copyFileSync(path.join(sketchDir, file), path.join(compilationPath, file))
  }
}
```

### `handleCompileSTtoCpp()`

Reads `program.st` and calls STruC++ `compile()` directly:

```typescript
import { compile } from 'strucpp'

private handleCompileSTtoCpp(compilationPath: string): void {
  const stSource = fs.readFileSync(path.join(compilationPath, 'program.st'), 'utf-8')

  const libsDir = path.join(this.resourcesPath, 'strucpp', 'libs')
  const result = compile(stSource, {
    headerFileName: 'generated.hpp',
    debug: true,
    lineMapping: true,
    libraryPaths: fs.existsSync(libsDir) ? [libsDir] : [],
  })

  if (!result.success) {
    const msgs = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n')
    throw new Error(`STruC++ compilation failed:\n${msgs}`)
  }

  fs.writeFileSync(path.join(compilationPath, 'generated.cpp'), result.cppCode)
  fs.writeFileSync(path.join(compilationPath, 'generated.hpp'), result.headerCode)
}
```

### C++17 Compilation Flag

All boards now require `-std=gnu++17`. This is added to `cxx_flags` in `hals.json` for
every board entry.

## Step 2.4: hals.json Changes

**File to modify**: `resources/sources/boards/hals.json`

- Add `"cxx_flags": ["-std=gnu++17", "-MMD", "-c"]` to all board entries
- Remove any MatIEC-specific fields if present

No `"compiler_backend"` field is needed -- all boards use STruC++ exclusively.

## Step 2.5: Clean Up MatIEC References

Remove or update these across the codebase:
- Binary path resolution for `iec2c` in `compiler-module.ts`
- `matiec` entry from `binary-versions.json` (no longer downloaded)
- MatIEC download logic from `scripts/download-binaries.ts`
- `resources/sources/MatIEC/` directory references
- Any `#executeIec2cBinaryPath` or similar methods
- References to `POUS.c`, `Res0.c`, `Config0.c`, `LOCATED_VARIABLES.h`, `glueVars.c`, `debug.c`

Note: `matiec` and `iec2c` references in the `binary-versions.json` and download script
should be removed since they are no longer used. The xml2st binary is still needed for
XML-to-ST conversion.

## Step 2.6: Build Directory Structure

```
build/{boardTarget}/src/
  plc.xml, program.st
  iec_var.hpp, iec_types.hpp, iec_located.hpp, iec_std_lib.hpp, ...
                          <- Copied from resources/strucpp/runtime/include/
  generated.hpp           <- STruC++ compile() output
  generated.cpp           <- STruC++ compile() output
  c_blocks.h, c_blocks_code.cpp
  arduino.cpp, defines.h
  openplc.h               <- Buffer declarations (adapted for STruC++ in Phase 3)
  Baremetal.ino     <- Static sketch (from Phase 3)
```

## Testing Strategy

1. **Code generation**: Compile a simple ST project through the pipeline
   - Verify `generated.cpp` and `generated.hpp` are produced in the build directory
   - Verify the generated code contains expected classes (`Configuration_Config0`, programs)
   - The `arduino-cli` step is expected to fail until Phase 3 provides the sketch

2. **Error handling**: Invalid ST code → STruC++ errors propagated to the UI console

3. **No MatIEC remnants**: Verify no references to iec2c, POUS.c, glueVars.c remain in the
   compilation path

## Files Created/Modified

| File | Action |
|------|--------|
| `src/backend/editor/compiler/compiler-module.ts` | Modified -- replace MatIEC pipeline with STruC++ |
| `resources/sources/boards/hals.json` | Modified -- add `cxx_flags` to all boards |
| `binary-versions.json` | Modified -- remove matiec entry |
| `scripts/download-binaries.ts` | Modified -- remove matiec download logic |
