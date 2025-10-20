/**
 * WebAssembly Simulator Loader
 *
 * This module handles loading and executing the OpenPLC Simulator WebAssembly module.
 * The simulator runs in the renderer process to interact with the UI for debugging.
 */

type SimulatorModule = {
  ccall: (ident: string, returnType: string, argTypes: string[], args: unknown[]) => unknown
  cwrap: (ident: string, returnType: string, argTypes: string[]) => (...args: unknown[]) => unknown
}

type SimulatorModuleFactory = (config?: {
  locateFile?: (path: string) => string
  print?: (text: string) => void
  printErr?: (text: string) => void
}) => Promise<SimulatorModule>

let simulatorModule: SimulatorModule | null = null

/**
 * Load the WebAssembly simulator module
 * @param wasmPath Path to the .wasm file
 * @param jsPath Path to the .js glue code file
 * @returns Promise that resolves to the loaded module
 */
export async function loadSimulator(wasmPath: string, jsPath: string): Promise<SimulatorModule> {
  if (simulatorModule) {
    console.log('Simulator already loaded, returning existing instance')
    return simulatorModule
  }

  try {
    console.log('Loading simulator from:', { wasmPath, jsPath })

    const createModule = (await import(/* webpackIgnore: true */ jsPath)) as { default: SimulatorModuleFactory }

    const module = await createModule.default({
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return wasmPath
        }
        return path
      },
      print: (text: string) => {
        console.log('[WASM Simulator]', text)
      },
      printErr: (text: string) => {
        console.error('[WASM Simulator Error]', text)
      },
    })

    simulatorModule = module
    console.log('Simulator loaded successfully')
    return module
  } catch (error) {
    console.error('Failed to load simulator:', error)
    throw new Error(`Failed to load WebAssembly simulator: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Get the currently loaded simulator module
 * @returns The loaded module or null if not loaded
 */
export function getSimulator(): SimulatorModule | null {
  return simulatorModule
}

/**
 * Unload the simulator module
 */
export function unloadSimulator(): void {
  simulatorModule = null
  console.log('Simulator unloaded')
}

/**
 * Call a function in the simulator
 * @param functionName Name of the exported function
 * @param returnType Return type (e.g., 'number', 'string', 'void')
 * @param argTypes Array of argument types
 * @param args Array of arguments
 * @returns The return value from the function
 */
export function callSimulatorFunction(
  functionName: string,
  returnType: string,
  argTypes: string[],
  args: unknown[],
): unknown {
  if (!simulatorModule) {
    throw new Error('Simulator not loaded. Call loadSimulator() first.')
  }

  try {
    return simulatorModule.ccall(functionName, returnType, argTypes, args)
  } catch (error) {
    console.error(`Error calling simulator function ${functionName}:`, error)
    throw error
  }
}

/**
 * Wrap a simulator function for easier calling
 * @param functionName Name of the exported function
 * @param returnType Return type
 * @param argTypes Array of argument types
 * @returns A wrapped function that can be called directly
 */
export function wrapSimulatorFunction(
  functionName: string,
  returnType: string,
  argTypes: string[],
): (...args: unknown[]) => unknown {
  if (!simulatorModule) {
    throw new Error('Simulator not loaded. Call loadSimulator() first.')
  }

  return simulatorModule.cwrap(functionName, returnType, argTypes)
}
