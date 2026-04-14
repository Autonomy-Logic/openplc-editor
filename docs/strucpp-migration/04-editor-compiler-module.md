# Phase 4: Editor Compiler Module Updates

## Goal

Wire the new STruC++ pipeline (Phases 1-3) into the editor's `compiler-module.ts`, replacing
the iec2c and xml2st debug/glue steps while preserving the existing MatIEC path for backward
compatibility.

## Prerequisites

- Phase 1 (strucpp-compiler.ts wrapper)
- Phase 2 (generate-arduino-glue.ts)
- Phase 3 (debug map generation and debug arrays in glue)

## Primary File

**`src/backend/editor/compiler/compiler-module.ts`** (~2,348 lines)

This is the main compilation orchestrator. It currently handles the full pipeline from JSON
project data to uploaded firmware. The STruC++ pipeline adds new methods alongside existing
ones; both coexist.

## Step 4.1: Pipeline Routing

The entry point `compileProgram()` (line ~1377) determines which pipeline to use based on
the board's `compiler_backend` field in `hals.json`:

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

Similarly for `compileForDebugger()` (line ~2157):

```typescript
async compileForDebugger(args, _mainProcessPort, mainProcessBridge) {
  const boardTarget = args[1] as string
  const boardEntry = this.halsContent[boardTarget]

  if (boardEntry?.compiler_backend === 'strucpp') {
    return this.compileForDebuggerWithSTruCpp(args, _mainProcessPort, mainProcessBridge)
  }
  // ... existing MatIEC debug pipeline
}
```

## Step 4.2: New STruC++ Compilation Pipeline

### Method: `compileArduinoWithSTruCpp()`

```typescript
private async compileArduinoWithSTruCpp(
  args: Array<string | null | PLCProjectData>,
  _mainProcessPort: MessagePortMain,
  mainProcessBridge: MainProcessBridgeType,
): Promise<void> {
  const projectData = args[0] as PLCProjectData
  const boardTarget = args[1] as string
  const projectPath = args[2] as string
  const compileOnly = args[3] as boolean
  // ... extract other args

  const compilationPath = path.join(projectPath, 'build', boardTarget, 'src')

  try {
    // === STEP 1: Create directories (unchanged) ===
    this.createBasicDirectories(projectPath, boardTarget)
    this.postMessage(_mainProcessPort, 'info', 'Creating build directories...')

    // === STEP 2: Generate XML from JSON (unchanged) ===
    this.postMessage(_mainProcessPort, 'info', 'Generating IEC 61131-3 XML...')
    await this.handleGenerateXMLfromJSON(projectData, compilationPath)

    // === STEP 3: xml2st --generate-st (unchanged) ===
    this.postMessage(_mainProcessPort, 'info', 'Transpiling XML to Structured Text...')
    await this.handleTranspileXMLtoST(compilationPath)
    // Result: program.st in compilationPath

    // === STEP 4: Copy STruC++ static files (NEW) ===
    this.postMessage(_mainProcessPort, 'info', 'Copying STruC++ runtime headers...')
    this.copyStrucppStaticFiles(compilationPath)

    // === STEP 5: Compile ST to C++ with STruC++ (NEW - replaces iec2c) ===
    this.postMessage(_mainProcessPort, 'info', 'Compiling Structured Text to C++...')
    const strucppResult = await this.handleCompileSTtoCpp(compilationPath)
    if (!strucppResult.success) {
      const errorMsg = strucppResult.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n')
      this.postMessage(_mainProcessPort, 'error', `STruC++ compilation failed:\n${errorMsg}`)
      this.closePort(_mainProcessPort)
      return
    }

    // === STEP 6: Compute MD5 (NEW approach) ===
    const stContent = fs.readFileSync(path.join(compilationPath, 'program.st'), 'utf-8')
    const md5Hash = crypto.createHash('md5').update(stContent).digest('hex')

    // === STEP 7: Generate glue + debug files (NEW - replaces xml2st debug/glue) ===
    this.postMessage(_mainProcessPort, 'info', 'Generating I/O binding and debug maps...')
    await this.handleGenerateGlueAndDebug(strucppResult, projectData, compilationPath, md5Hash, boardTarget)

    // === STEP 8: Generate C++ blocks header/code (unchanged) ===
    this.postMessage(_mainProcessPort, 'info', 'Processing C++ blocks...')
    await this.handleGenerateCBlocksHeader(projectData, compilationPath)
    await this.handleGenerateCBlocksCode(projectData, compilationPath)

    // === STEP 9: Copy HAL file (unchanged) ===
    this.postMessage(_mainProcessPort, 'info', 'Configuring hardware abstraction...')
    await this.handleGenerateArduinoCppFile(boardTarget, compilationPath)

    // === STEP 10: Generate defines.h (modified - reads stContent for library detection) ===
    this.postMessage(_mainProcessPort, 'info', 'Generating definitions...')
    await this.handleGenerateDefinitionsFileSTruCpp(projectData, boardTarget, compilationPath, md5Hash, stContent)

    // === STEP 11-12: Arduino compilation (modified - adds -std=gnu++17) ===
    this.postMessage(_mainProcessPort, 'info', 'Installing Arduino core...')
    await this.handleCoreInstallation(boardTarget)
    await this.handleLibraryInstallation(boardTarget, compilationPath)

    this.postMessage(_mainProcessPort, 'info', 'Compiling Arduino program...')
    await this.handleCompileArduinoProgramSTruCpp(boardTarget, compilationPath, compileOnly)

    // === STEP 13: Upload (unchanged) ===
    if (!compileOnly) {
      this.postMessage(_mainProcessPort, 'info', 'Uploading firmware...')
      await this.handleUploadProgram(boardTarget, compilationPath)
    }

    this.postMessage(_mainProcessPort, 'info', 'Compilation successful!')
    this.closePort(_mainProcessPort)

  } catch (error) {
    this.postMessage(_mainProcessPort, 'error', `Compilation failed: ${getErrorMessage(error)}`)
    this.closePort(_mainProcessPort)
  }
}
```

## Step 4.3: New Private Methods

### `copyStrucppStaticFiles()`

```typescript
private copyStrucppStaticFiles(compilationPath: string): void {
  const strucppRuntimeDir = path.join(this.resourcesPath, 'sources', 'StrucppRuntime')
  const strucppBaremetalDir = path.join(this.resourcesPath, 'sources', 'StrucppBaremetal')

  // Copy runtime headers
  const headers = fs.readdirSync(strucppRuntimeDir)
  for (const file of headers) {
    fs.copyFileSync(
      path.join(strucppRuntimeDir, file),
      path.join(compilationPath, file),
    )
  }

  // Copy StrucppBaremetal.ino
  fs.copyFileSync(
    path.join(strucppBaremetalDir, 'StrucppBaremetal.ino'),
    path.join(compilationPath, 'StrucppBaremetal.ino'),
  )
}
```

### `handleCompileSTtoCpp()`

```typescript
private async handleCompileSTtoCpp(compilationPath: string): Promise<STruCppResult> {
  const stFilePath = path.join(compilationPath, 'program.st')
  const stSource = fs.readFileSync(stFilePath, 'utf-8')

  // Compile with STruC++
  const result = compileWithSTruCpp(stSource, {
    headerFileName: 'generated.hpp',
    debug: true,
    lineMapping: true,
  })

  if (result.success) {
    // Write generated files
    fs.writeFileSync(path.join(compilationPath, 'generated.cpp'), result.cppCode)
    fs.writeFileSync(path.join(compilationPath, 'generated.hpp'), result.headerCode)
  }

  return result
}
```

### `handleGenerateGlueAndDebug()`

```typescript
private async handleGenerateGlueAndDebug(
  strucppResult: STruCppResult,
  projectData: PLCProjectData,
  compilationPath: string,
  md5Hash: string,
  boardTarget: string,
): Promise<void> {
  const boardEntry = this.halsContent[boardTarget]
  const boardMemoryClass = this.getBoardMemoryClass(boardTarget)

  // Generate generated_glue.hpp (I/O binding + scheduler + debug arrays)
  const glueCode = generateArduinoGlue({
    configurationName: projectData.configurations?.resource?.[0]?.name ?? 'Config0',
    taskIntervals: strucppResult.taskIntervals,
    variableDescriptors: strucppResult.variableDescriptors,
    md5Hash,
    boardMemoryClass,
  })
  fs.writeFileSync(path.join(compilationPath, 'generated_glue.hpp'), glueCode)

  // Generate debug-map.json
  const gcdNs = computeTaskGCD(strucppResult.taskIntervals)
  const debugMap = generateDebugMap(
    strucppResult.variableDescriptors,
    strucppResult.taskIntervals,
    md5Hash,
    gcdNs,
  )
  fs.writeFileSync(path.join(compilationPath, 'debug-map.json'), debugMap)
}
```

### `handleCompileArduinoProgramSTruCpp()`

```typescript
private async handleCompileArduinoProgramSTruCpp(
  boardTarget: string,
  compilationPath: string,
  compileOnly: boolean,
): Promise<void> {
  const boardEntry = this.halsContent[boardTarget]

  // Ensure -std=gnu++17 is in CXX flags
  const cxxFlags = boardEntry.cxx_flags ? [...boardEntry.cxx_flags] : []
  if (!cxxFlags.some(f => f.includes('-std='))) {
    cxxFlags.push('-std=gnu++17')
  }

  // Build the arduino-cli compile command
  // Same structure as current handleCompileArduinoProgram() but with C++17 flag
  const buildProperties = [
    `compiler.cpp.extra_flags=${cxxFlags.join(' ')}`,
    // ... other build properties (same as current)
  ]

  await this.executeArduinoCliCommand([
    'compile',
    '--fqbn', boardEntry.platform,
    '--build-property', buildProperties.join(';'),
    '--export-binaries',
    compilationPath,
  ])
}
```

### `handleGenerateDefinitionsFileSTruCpp()`

Same as current `handleGenerateDefinitionsFile()` but:
- Receives `stContent` (program.st text) as parameter instead of reading from file
- Uses the same library detection logic (scanning for DS18B20, P1AM, etc.)
- Embeds MD5 hash from parameter instead of regex extraction
- No changes to pin mapping, Modbus config, or board defines

## Step 4.4: Debug Compilation Pipeline

### Method: `compileForDebuggerWithSTruCpp()`

Simplified pipeline that produces debug metadata without full Arduino compilation:

```typescript
private async compileForDebuggerWithSTruCpp(
  args: Array<string | null | PLCProjectData>,
  _mainProcessPort: MessagePortMain,
  mainProcessBridge: MainProcessBridgeType,
): Promise<void> {
  const projectData = args[0] as PLCProjectData
  const boardTarget = args[1] as string
  const projectPath = args[2] as string
  const compilationPath = path.join(projectPath, 'build', boardTarget, 'src')

  try {
    // Steps 1-3: Same as full compile (create dirs, XML, ST)
    this.createBasicDirectories(projectPath, boardTarget)
    await this.handleGenerateXMLfromJSON(projectData, compilationPath)
    await this.handleTranspileXMLtoST(compilationPath)

    // Step 4: Compile ST to C++ (for variable metadata)
    const strucppResult = await this.handleCompileSTtoCpp(compilationPath)
    if (!strucppResult.success) {
      this.postMessage(_mainProcessPort, 'error', 'STruC++ compilation failed')
      this.closePort(_mainProcessPort)
      return
    }

    // Step 5: Compute MD5
    const stContent = fs.readFileSync(path.join(compilationPath, 'program.st'), 'utf-8')
    const md5Hash = crypto.createHash('md5').update(stContent).digest('hex')

    // Step 6: Generate debug-map.json only (no glue code needed for debug)
    const gcdNs = computeTaskGCD(strucppResult.taskIntervals)
    const debugMap = generateDebugMap(
      strucppResult.variableDescriptors,
      strucppResult.taskIntervals,
      md5Hash,
      gcdNs,
    )
    fs.writeFileSync(path.join(compilationPath, 'debug-map.json'), debugMap)

    // Step 7: Generate C blocks (for variable detection)
    await this.handleGenerateCBlocksHeader(projectData, compilationPath)
    await this.handleGenerateCBlocksCode(projectData, compilationPath)

    // Done -- no Arduino compilation needed
    this.postMessage(_mainProcessPort, 'info', 'Debug compilation complete')
    this.closePort(_mainProcessPort)

  } catch (error) {
    this.postMessage(_mainProcessPort, 'error', `Debug compilation failed: ${getErrorMessage(error)}`)
    this.closePort(_mainProcessPort)
  }
}
```

## Step 4.5: IPC Bridge Updates

### Read Debug Map

The IPC bridge needs a new handler to read `debug-map.json`:

**File to modify**: `src/main/modules/ipc/main.ts`

```typescript
handleReadDebugMap = (
  _event: IpcMainEvent,
  args: Array<string>,
): Promise<{ success: boolean; content?: string; error?: string }> => {
  const [projectPath, boardTarget] = args
  const debugMapPath = path.join(projectPath, 'build', boardTarget, 'src', 'debug-map.json')

  if (!fs.existsSync(debugMapPath)) {
    return { success: false, error: 'debug-map.json not found' }
  }

  const content = fs.readFileSync(debugMapPath, 'utf-8')
  return { success: true, content }
}
```

**File to modify**: `src/main/modules/preload/preload.ts`

Expose the new handler:
```typescript
debuggerReadDebugMap: (projectPath: string, boardTarget: string) =>
  ipcRenderer.invoke('debugger:read-debug-map', [projectPath, boardTarget])
```

## Step 4.6: Build Directory Structure

### Old (MatIEC):
```
build/{boardTarget}/src/
  plc.xml
  program.st
  lib/                    <- MatIEC runtime headers
  POUS.c                  <- MatIEC output
  POUS.h
  Res0.c
  Config0.c
  Config0.h
  LOCATED_VARIABLES.h
  glueVars.c              <- xml2st output
  debug.c                 <- xml2st output
  VARIABLES.csv
  c_blocks.h
  c_blocks_code.cpp
  arduino.cpp             <- HAL file
  defines.h
  Baremetal.ino
```

### New (STruC++):
```
build/{boardTarget}/src/
  plc.xml
  program.st
  iec_var.hpp             <- STruC++ runtime headers
  iec_types.hpp
  iec_located.hpp
  ... (other runtime headers)
  generated.hpp           <- STruC++ output
  generated.cpp           <- STruC++ output
  generated_glue.hpp      <- Glue generator output
  debug-map.json          <- Debug map
  c_blocks.h
  c_blocks_code.cpp
  arduino.cpp             <- HAL file (unchanged)
  defines.h
  openplc.h               <- Buffer declarations (unchanged)
  debug.h                 <- Debug function declarations (updated)
  ModbusSlave.h           <- Modbus + debug protocol (updated)
  StrucppBaremetal.ino     <- New Arduino sketch
```

## Testing Strategy

1. **End-to-end Arduino compile**: Simple ST project through full pipeline
   - Verify all generated files are present in build directory
   - Verify arduino-cli compiles without errors
   - Verify firmware binary is produced

2. **End-to-end debug compile**: Same project through debug pipeline
   - Verify debug-map.json is generated
   - Verify it contains correct variable metadata
   - Verify no arduino-cli invocation (faster)

3. **Pipeline routing**: Test that MatIEC boards still use old pipeline
   - Set `compiler_backend: "matiec"` (or absent) in hals.json
   - Verify old debug.c and glueVars.c are generated

4. **Error handling**: Test STruC++ compilation error propagation
   - Feed invalid ST code
   - Verify error messages reach the frontend via MessagePort

5. **Regression**: All existing compiler-module.spec.ts tests pass unchanged

## Files Created/Modified

| File | Action |
|------|--------|
| `src/backend/editor/compiler/compiler-module.ts` | Modified -- add STruC++ pipeline methods |
| `src/main/modules/ipc/main.ts` | Modified -- add debug map read handler |
| `src/main/modules/preload/preload.ts` | Modified -- expose debug map reader |
