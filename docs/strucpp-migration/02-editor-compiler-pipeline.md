# Phase 2: Editor Compiler Pipeline

## Goal

Wire STruC++ `compile()` into `compiler-module.ts` so that when a board uses the STruC++
backend, the editor reads `program.st`, compiles it to C++, and writes `generated.cpp` +
`generated.hpp` to the build directory. This validates that the code generation pipeline
works end-to-end.

At this stage, the `arduino-cli` compilation step will fail because the Arduino runtime
(sketch, adapted `openplc.h`) is not yet ready for STruC++ output. That's expected -- the
goal is to verify C++ code generation, not a compilable firmware. Phase 3 addresses the
runtime.

## Prerequisites

- Phase 1 complete (STruC++ installed in `node_modules`, runtime headers at `resources/strucpp/`)

## Primary File

**`src/backend/editor/compiler/compiler-module.ts`** (~2,348 lines)

This is the main compilation orchestrator. The STruC++ pipeline adds new methods alongside
the existing MatIEC ones; both coexist.

## Step 2.1: Pipeline Routing

Add a `"compiler_backend"` field to `hals.json` board entries. The entry point
`compileProgram()` checks this field to route to the appropriate pipeline:

```typescript
async compileProgram(args, _mainProcessPort, mainProcessBridge) {
  const boardTarget = args[1] as string
  const boardEntry = this.halsContent[boardTarget]

  if (boardEntry?.compiler_backend === 'strucpp') {
    return this.compileArduinoWithSTruCpp(args, _mainProcessPort, mainProcessBridge)
  }
  // ... existing MatIEC pipeline (unchanged)
}
```

**File to modify**: `resources/sources/boards/hals.json`

Add `"compiler_backend": "strucpp"` to boards being migrated. Boards without this field (or
with `"matiec"`) continue using the existing pipeline.

## Step 2.2: New STruC++ Compilation Pipeline

### Method: `compileArduinoWithSTruCpp()`

```typescript
private async compileArduinoWithSTruCpp(args, _mainProcessPort, mainProcessBridge) {
  const projectData = args[0] as PLCProjectData
  const boardTarget = args[1] as string
  const projectPath = args[2] as string
  const compileOnly = args[3] as boolean

  const compilationPath = path.join(projectPath, 'build', boardTarget, 'src')

  try {
    // === STEP 1: Create directories (unchanged) ===
    this.createBasicDirectories(projectPath, boardTarget)

    // === STEP 2: Generate XML from JSON (unchanged) ===
    await this.handleGenerateXMLfromJSON(projectData, compilationPath)

    // === STEP 3: xml2st --generate-st (unchanged) ===
    await this.handleTranspileXMLtoST(compilationPath)
    // Result: program.st in compilationPath

    // === STEP 4: Copy STruC++ runtime headers to build dir (NEW) ===
    this.copyStrucppRuntimeHeaders(compilationPath)

    // === STEP 5: Compile ST to C++ with STruC++ (NEW - replaces iec2c) ===
    this.handleCompileSTtoCpp(compilationPath)

    // === STEP 6: Copy Arduino sketch + static files (NEW) ===
    this.copyStrucppSketchFiles(compilationPath)

    // === STEP 7: Generate C++ blocks header/code (unchanged) ===
    await this.handleGenerateCBlocksHeader(projectData, compilationPath)
    await this.handleGenerateCBlocksCode(projectData, compilationPath)

    // === STEP 8: Copy HAL file (unchanged) ===
    await this.handleGenerateArduinoCppFile(boardTarget, compilationPath)

    // === STEP 9: Generate defines.h (unchanged in structure) ===
    await this.handleGenerateDefinitionsFile(projectData, boardTarget, compilationPath)

    // === STEP 10: Arduino compilation (adds -std=gnu++17) ===
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
  const sketchDir = path.join(this.resourcesPath, 'sources', 'StrucppBaremetal')
  // Copy all files from the StrucppBaremetal directory
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

The `handleCompileArduinoProgram` method must ensure `-std=gnu++17` is in the CXX flags
when `compiler_backend === 'strucpp'`. This can be done by:
- Adding `"-std=gnu++17"` to `cxx_flags` in hals.json for each board, or
- Injecting it programmatically in the STruC++ pipeline path

## Step 2.4: hals.json Changes

**File to modify**: `resources/sources/boards/hals.json`

For boards being migrated, add:
```json
{
  "compiler_backend": "strucpp",
  "cxx_flags": ["-std=gnu++17", "-MMD", "-c"]
}
```

**C++17 support by platform**:

| Platform | GCC Version | C++17 Support |
|----------|-------------|---------------|
| Arduino AVR | 7.3+ | Yes (bundled with Arduino IDE 2.x) |
| ESP32 | 8.4+ (ESP-IDF) | Yes |
| STM32 | 10+ (STM32duino) | Yes |
| RP2040 | 10+ (Arduino Mbed) | Yes |
| SAMD | 7.2+ | Yes |

## Step 2.5: Build Directory Structure

### Old (MatIEC):
```
build/{boardTarget}/src/
  plc.xml, program.st
  lib/                    <- MatIEC runtime headers
  POUS.c, POUS.h          <- MatIEC output
  Res0.c, Config0.c, Config0.h
  LOCATED_VARIABLES.h
  glueVars.c, debug.c     <- xml2st output
  VARIABLES.csv
  c_blocks.h, c_blocks_code.cpp
  arduino.cpp, defines.h
  Baremetal.ino
```

### New (STruC++):
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
  StrucppBaremetal.ino     <- Static sketch (from Phase 3)
```

## Testing Strategy

1. **Code generation**: Compile a simple ST project through the pipeline
   - Verify `generated.cpp` and `generated.hpp` are produced in the build directory
   - Verify the generated code contains expected classes (`Configuration_Config0`, program classes)
   - The `arduino-cli` step is expected to fail until Phase 3 provides the sketch

2. **Pipeline routing**: Verify MatIEC boards are unaffected
   - Board without `compiler_backend` field → old pipeline produces `POUS.c`, `Config0.c`, etc.
   - Board with `compiler_backend: "strucpp"` → new pipeline produces `generated.cpp`, `generated.hpp`

3. **Error handling**: Invalid ST code → STruC++ errors propagated to the UI console

4. **Regression**: All existing compiler tests pass for MatIEC boards

## Files Created/Modified

| File | Action |
|------|--------|
| `src/backend/editor/compiler/compiler-module.ts` | Modified -- add STruC++ pipeline methods |
| `resources/sources/boards/hals.json` | Modified -- add `compiler_backend` and `cxx_flags` |
