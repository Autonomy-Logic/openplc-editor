# Phase 4: Editor Compiler Module Updates

## Goal

Wire the STruC++ compilation into `compiler-module.ts`: read `program.st`, call `compile()`
directly, write the generated C++ files, copy runtime headers, and invoke `arduino-cli` with
C++17 flags. No wrapper module, no glue code generator -- just direct integration.

## Prerequisites

- Phase 1 (STruC++ installed in node_modules, runtime headers at resources/strucpp/)
- Phase 2 (static StrucppBaremetal.ino sketch)

## Primary File

**`src/backend/editor/compiler/compiler-module.ts`** (~2,348 lines)

This is the main compilation orchestrator. The STruC++ pipeline adds new methods alongside
the existing MatIEC ones; both coexist.

## Step 4.1: Pipeline Routing

The entry point `compileProgram()` determines which pipeline to use based on the board's
`compiler_backend` field in `hals.json`:

```typescript
async compileProgram(args, _mainProcessPort, mainProcessBridge) {
  const boardTarget = args[1] as string
  const boardEntry = this.halsContent[boardTarget]

  if (boardEntry?.compiler_backend === 'strucpp') {
    return this.compileArduinoWithSTruCpp(args, _mainProcessPort, mainProcessBridge)
  }
  // ... existing MatIEC pipeline
}
```

## Step 4.2: New STruC++ Compilation Pipeline

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

    // === STEP 4: Copy STruC++ files (NEW) ===
    this.copyStrucppFiles(compilationPath)

    // === STEP 5: Compile ST to C++ with STruC++ (NEW - replaces iec2c) ===
    await this.handleCompileSTtoCpp(compilationPath)

    // === STEP 6: Generate C++ blocks header/code (unchanged) ===
    await this.handleGenerateCBlocksHeader(projectData, compilationPath)
    await this.handleGenerateCBlocksCode(projectData, compilationPath)

    // === STEP 7: Copy HAL file (unchanged) ===
    await this.handleGenerateArduinoCppFile(boardTarget, compilationPath)

    // === STEP 8: Generate defines.h (unchanged in structure) ===
    await this.handleGenerateDefinitionsFile(projectData, boardTarget, compilationPath)

    // === STEP 9: Arduino compilation (adds -std=gnu++17) ===
    await this.handleCoreInstallation(boardTarget)
    await this.handleLibraryInstallation(boardTarget, compilationPath)
    await this.handleCompileArduinoProgram(boardTarget, compilationPath, compileOnly)

    // === STEP 10: Upload (unchanged) ===
    if (!compileOnly) {
      await this.handleUploadProgram(boardTarget, compilationPath)
    }
  } catch (error) {
    // error handling...
  }
}
```

## Step 4.3: New Private Methods

### `copyStrucppFiles()`

Copies the static Arduino sketch and STruC++ runtime headers to the build directory:

```typescript
private copyStrucppFiles(compilationPath: string): void {
  // Runtime headers (downloaded by scripts/download-binaries.ts)
  const runtimeDir = path.join(this.resourcesPath, 'strucpp', 'runtime', 'include')
  if (!fs.existsSync(runtimeDir)) {
    throw new Error('STruC++ runtime headers not found. Run "npm run setup:binaries".')
  }
  for (const file of fs.readdirSync(runtimeDir)) {
    fs.copyFileSync(path.join(runtimeDir, file), path.join(compilationPath, file))
  }

  // Static sketch (stored in the repo)
  const sketchDir = path.join(this.resourcesPath, 'sources', 'StrucppBaremetal')
  fs.copyFileSync(
    path.join(sketchDir, 'StrucppBaremetal.ino'),
    path.join(compilationPath, 'StrucppBaremetal.ino'),
  )
}
```

### `handleCompileSTtoCpp()`

Reads `program.st` and calls STruC++ `compile()` directly -- no wrapper:

```typescript
import { compile } from 'strucpp'

private async handleCompileSTtoCpp(compilationPath: string): Promise<void> {
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

That's it. No metadata extraction, no glue generation. The Arduino sketch handles
everything dynamically from the generated C++ structures.

### Arduino Compilation Flag

The `handleCompileArduinoProgram` method (or the hals.json entry) must ensure
`-std=gnu++17` is in the CXX flags. This can be done by:
- Adding it to hals.json for each board, or
- Injecting it programmatically when `compiler_backend === 'strucpp'`

## Step 4.4: Build Directory Structure

### Old (MatIEC):
```
build/{boardTarget}/src/
  plc.xml, program.st
  lib/                    <- MatIEC runtime headers
  POUS.c, POUS.h          <- MatIEC output
  Res0.c, Config0.c, Config0.h
  LOCATED_VARIABLES.h
  glueVars.c              <- xml2st output
  debug.c                 <- xml2st output
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
  openplc.h               <- Buffer declarations (adapted for STruC++)
  StrucppBaremetal.ino     <- Static sketch
```

No glue files. No debug files (debugger is a separate phase). The sketch and generated
code together are self-contained.

## Testing Strategy

1. **End-to-end compile**: Simple ST project through the full pipeline
   - Verify `generated.cpp` and `generated.hpp` are produced
   - Verify arduino-cli compiles without errors for the Simulator target
   - Verify firmware binary is produced

2. **Pipeline routing**: MatIEC boards still use old pipeline
   - Board with `compiler_backend: "matiec"` (or absent) → old debug.c/glueVars.c path
   - Board with `compiler_backend: "strucpp"` → new STruC++ path

3. **Error handling**: Invalid ST code → STruC++ errors propagated to UI

4. **Regression**: All existing compiler tests pass for MatIEC boards

## Files Created/Modified

| File | Action |
|------|--------|
| `src/backend/editor/compiler/compiler-module.ts` | Modified -- add STruC++ pipeline |
