import type {
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
  WasmToolchainTree,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { filesToTree, readTreeFile } from '../../file-tree'

export type FakeOutcome =
  | { exitCode: number; stderr?: string; produce?: boolean; dependencyFile?: 'normal' | 'missing' | 'garbage' }
  | 'throw'

/**
 * In-memory runner: writes the `-o` file as its argv followed by the text of its source and `includes[source]`, so
 * tests can see what was compiled and linked and an output changes with its inputs, and for `-MF` a dependency rule
 * naming the source (after `-c`, or after `-x <kind>` for a header) plus `includes[source]`, as clang would.
 * `outcome` decides each job's result by its argv.
 */
export class FakeRunner implements WasmClangRunner {
  jobs: WasmClangJob[] = []
  active = 0
  maxActive = 0
  prepared = 0
  private stdout = ''

  constructor(
    readonly concurrency = 2,
    private readonly outcome: (argv: string[]) => FakeOutcome = () => ({ exitCode: 0 }),
    private readonly prepareError: Error | null = null,
    private readonly includes: Record<string, string[]> = {},
  ) {}

  /** What every job writes to stdout, as `clang --version` does. */
  withStdout(text: string): this {
    this.stdout = text
    return this
  }

  prepare(): Promise<void> {
    this.prepared++
    return this.prepareError ? Promise.reject(this.prepareError) : Promise.resolve()
  }

  async run(job: WasmClangJob): Promise<WasmClangJobResult> {
    this.jobs.push(job)
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    await new Promise((r) => setTimeout(r, 1))
    this.active--
    const outcome = this.outcome(job.argv)
    if (outcome === 'throw') throw new Error('worker crashed')
    const out = job.argv[job.argv.indexOf('-o') + 1]
    const files: Record<string, Uint8Array | string> = {}
    if (outcome.exitCode === 0 && outcome.produce !== false) {
      const source = job.argv.includes('-c')
        ? job.argv[job.argv.indexOf('-c') + 1]
        : job.argv.includes('-x')
          ? job.argv[job.argv.indexOf('-x') + 2]
          : undefined
      const inputs = source === undefined ? [] : [source, ...(this.includes[source] ?? [])]
      const contents = inputs.map((path) => FakeRunner.text(job.tree, path.replace(/^\.\//, ''))).join('\n')
      files[out] = new TextEncoder().encode(
        source === undefined ? job.argv.join(' ') : `${job.argv.join(' ')}\n${contents}`,
      )
      const mf = job.argv.indexOf('-MF')
      if (mf >= 0 && source !== undefined && outcome.dependencyFile !== 'missing') {
        const deps = [...inputs, '/usr/include/stdio.h']
        files[job.argv[mf + 1]] =
          outcome.dependencyFile === 'garbage' ? 'not a rule' : `${out}: ${deps.join(' \\\n  ')}\n`
      }
    }
    const tree: WasmToolchainTree = filesToTree(files)
    return { exitCode: outcome.exitCode, stderr: outcome.stderr ?? '', stdout: this.stdout, tree }
  }

  /** Text of a file a job had in its working directory. */
  static text(tree: WasmToolchainTree, path: string): string {
    const content = readTreeFile(tree, path)
    if (content === undefined) return ''
    return typeof content === 'string' ? content : new TextDecoder().decode(content)
  }
}
