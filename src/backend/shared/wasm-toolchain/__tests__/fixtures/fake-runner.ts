import type {
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
  WasmToolchainTree,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { filesToTree, readTreeFile } from '../../file-tree'

export type FakeOutcome = { exitCode: number; stderr?: string; produce?: boolean } | 'throw'

/**
 * In-memory runner: writes the `-o` file as the bytes of its argv, so tests can see what was compiled and linked.
 * `outcome` decides each job's result by its argv.
 */
export class FakeRunner implements WasmClangRunner {
  jobs: WasmClangJob[] = []
  active = 0
  maxActive = 0
  prepared = 0

  constructor(
    readonly concurrency = 2,
    private readonly outcome: (argv: string[]) => FakeOutcome = () => ({ exitCode: 0 }),
    private readonly prepareError: Error | null = null,
  ) {}

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
    const tree: WasmToolchainTree =
      outcome.exitCode === 0 && outcome.produce !== false
        ? filesToTree({ [out]: new TextEncoder().encode(job.argv.join(' ')) })
        : {}
    return { exitCode: outcome.exitCode, stderr: outcome.stderr ?? '', tree }
  }

  /** Text of a file a job had in its working directory. */
  static text(tree: WasmToolchainTree, path: string): string {
    const content = readTreeFile(tree, path)
    if (content === undefined) return ''
    return typeof content === 'string' ? content : new TextDecoder().decode(content)
  }
}
