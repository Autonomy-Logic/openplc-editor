/**
 * Python function blocks on the bundled CPython, run by the Wasmer SDK. The runtime is loaded once; each interpreter
 * is a sandbox of its own with no network, booted with a script that waits on stdin for its block's script.
 *
 * The SDK is typed here by the part this file uses, because each platform imports it from a different entry point
 * (`@wasmer/sdk/node`, `@wasmer/sdk`).
 */
import type { PythonRuntimeAssets } from '../../../middleware/shared/ports/python-mechanisms'

/** Where the boot script, the numpy wheel and unpacked numpy live in each sandbox (the SDK accepts only /workspace). */
const RUNTIME_DIR = '/workspace/.openplc'
const BOOT_SCRIPT = `${RUNTIME_DIR}/boot.py`
const NUMPY_WHEEL = `${RUNTIME_DIR}/numpy.whl`
const SITE_DIR = `${RUNTIME_DIR}/site`
/** The boot script's first line on stdout: the interpreter is up and numpy unpacked. */
export const PYTHON_BOOT_READY = '@@openplc-python-ready'

/**
 * Unpacks numpy onto the import path (importing it stays the block's choice), says it is ready, then runs the block's
 * script as `__main__`, reporting its traceback from the block's own code. Stdin carries the block name, the script's
 * length in bytes, then the script; the rest is the block's.
 */
export const PYTHON_BOOT_SCRIPT = `import sys, zipfile
zipfile.ZipFile('${NUMPY_WHEEL}').extractall('${SITE_DIR}')
sys.path.insert(0, '${SITE_DIR}')
print('${PYTHON_BOOT_READY}', flush=True)
_boot_stdin = sys.stdin.buffer
_boot_name = _boot_stdin.readline().decode().strip()
_boot_source = _boot_stdin.read(int(_boot_stdin.readline())).decode()
del zipfile
try:
    exec(compile(_boot_source, _boot_name + '.py', 'exec'), {'__name__': '__main__', '__builtins__': __builtins__})
except SystemExit:
    raise
except BaseException as _boot_error:
    import traceback
    traceback.print_exception(type(_boot_error), _boot_error, _boot_error.__traceback__.tb_next)
    sys.exit(1)
`

export interface WasmerStdin {
  write(data: string | Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface WasmerLines {
  lines(): AsyncGenerator<string>
}

export interface WasmerProcess {
  readonly stdin: WasmerStdin | null
  readonly stdout: WasmerLines | null
  readonly stderr: WasmerLines | null
  wait(): Promise<{ exitCode: number }>
  kill(): Promise<void>
}

export interface WasmerSandbox {
  command(
    name: string,
    args: readonly string[],
  ): { spawn(options: { stdin: 'pipe'; stdout: 'pipe'; stderr: 'pipe' }): Promise<WasmerProcess> }
  close(): Promise<void>
}

export interface WasmerClient {
  packages: { load(source: Uint8Array): Promise<unknown> }
  sandboxes: {
    create(options: {
      packages: readonly unknown[]
      files: Readonly<Record<string, string | Uint8Array>>
      env: Readonly<Record<string, string>>
      network: { mode: 'disabled' }
    }): Promise<WasmerSandbox>
  }
}

/** The part of the Wasmer SDK module this runtime uses. */
export interface WasmerSdk {
  Wasmer: { create(options: { cache: false }): Promise<WasmerClient> }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** `Wasmer` is a class, so it is checked as a function with a static `create`. */
export const isWasmerSdk = (value: unknown): value is WasmerSdk =>
  isRecord(value) && typeof value.Wasmer === 'function' && typeof Reflect.get(value.Wasmer, 'create') === 'function'

/** How an interpreter ended: its own exit, a kill asked for, or a failure of the runtime (a trap) with its reason. */
export type PythonExit = { kind: 'exited'; code: number } | { kind: 'killed' } | { kind: 'failed'; reason: string }

/** One running interpreter, from the thread that runs it. */
export interface PythonProcess {
  write(text: string): void
  onStdout: ((line: string) => void) | null
  onStderr: ((line: string) => void) | null
  /** Called once when the interpreter ends. */
  onExit: ((exit: PythonExit) => void) | null
  kill(): void
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

class WasmerPythonProcess implements PythonProcess {
  onStdout: ((line: string) => void) | null = null
  onStderr: ((line: string) => void) | null = null
  onExit: ((exit: PythonExit) => void) | null = null

  /** Resolves once the boot script reports ready; rejects with its output when it ends before that. */
  readonly ready: Promise<void>

  private killed = false
  private ended = false
  private booted = false
  private bootErrors: string[] = []
  private writes: Promise<void> = Promise.resolve()
  private settleBoot: { resolve: () => void; reject: (error: Error) => void } | null = null

  constructor(
    private readonly sandbox: WasmerSandbox,
    private readonly process: WasmerProcess,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.settleBoot = { resolve, reject }
    })
    void this.pump(process.stdout, (line) => {
      if (this.booted) this.onStdout?.(line)
      else if (line === PYTHON_BOOT_READY) this.boot()
    })
    void this.pump(process.stderr, (line) => {
      if (this.booted) this.onStderr?.(line)
      else this.bootErrors.push(line)
    })
    process.wait().then(
      (output) => this.end(this.killed ? { kind: 'killed' } : { kind: 'exited', code: output.exitCode }),
      (error: unknown) => this.end(this.killed ? { kind: 'killed' } : { kind: 'failed', reason: describe(error) }),
    )
  }

  write(text: string): void {
    const stdin = this.process.stdin
    if (this.ended || !stdin) return
    this.writes = this.writes.then(() => stdin.write(text)).catch(() => undefined)
  }

  kill(): void {
    if (this.ended || this.killed) return
    this.killed = true
    void this.process.kill().catch(() => undefined)
  }

  private async pump(stream: WasmerLines | null, deliver: (line: string) => void): Promise<void> {
    if (!stream) return
    try {
      for await (const line of stream.lines()) deliver(line.replace(/\r?\n$/, ''))
    } catch {
      // The stream ends with the process; its exit is reported by `wait()`.
    }
  }

  private boot(): void {
    this.booted = true
    this.settleBoot?.resolve()
    this.settleBoot = null
  }

  private end(exit: PythonExit): void {
    if (this.ended) return
    this.ended = true
    void this.sandbox.close().catch(() => undefined)
    if (this.settleBoot) {
      const reason = exit.kind === 'failed' ? exit.reason : exit.kind === 'exited' ? `exit code ${exit.code}` : 'killed'
      this.settleBoot.reject(new Error([reason, ...this.bootErrors].join('\n')))
      this.settleBoot = null
      return
    }
    this.onExit?.(exit)
  }
}

/** The loaded Python runtime; `spawn` starts an interpreter that waits for its block's script. */
export class WasmerPythonRuntime {
  private constructor(
    private readonly client: WasmerClient,
    private readonly pythonPackage: unknown,
    private readonly numpyWheel: Uint8Array,
  ) {}

  /** Loads the CPython package from its bytes; nothing is fetched and no interpreter starts. */
  static async load(sdk: WasmerSdk, assets: PythonRuntimeAssets): Promise<WasmerPythonRuntime> {
    const client = await sdk.Wasmer.create({ cache: false })
    const pythonPackage = await client.packages.load(assets.pythonPackage)
    return new WasmerPythonRuntime(client, pythonPackage, assets.numpyWheel)
  }

  async spawn(): Promise<PythonProcess> {
    const sandbox = await this.client.sandboxes.create({
      packages: [this.pythonPackage],
      files: { [BOOT_SCRIPT]: PYTHON_BOOT_SCRIPT, [NUMPY_WHEEL]: this.numpyWheel },
      // The Console shows plain text, so tracebacks come without colour codes.
      env: { PYTHON_COLORS: '0', NO_COLOR: '1' },
      network: { mode: 'disabled' },
    })
    try {
      const process = await sandbox.command('python', ['-u', BOOT_SCRIPT]).spawn({
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const python = new WasmerPythonProcess(sandbox, process)
      await python.ready
      return python
    } catch (error) {
      await sandbox.close().catch(() => undefined)
      throw new Error(`The Python interpreter could not start: ${describe(error)}`)
    }
  }
}
