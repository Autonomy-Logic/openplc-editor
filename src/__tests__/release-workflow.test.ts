/**
 * The structure of `.github/workflows/release.yml`, read with the `yaml` package, and the thin-adapter exception in
 * CLAUDE.md. Which jobs and steps run is worked out from the workflow's `if:` and `${{ }}` expressions, for a tag push,
 * a dispatch on a tag and a dispatch on a branch, with GitHub's rule that a job is skipped when a job upstream of it was skipped unless
 * its `if:` calls a status function. A condition kept inside a shell script cannot be evaluated here. The upload-set
 * check of create-release also runs as a bash script, with the real check-upload-set.mjs, over a temporary directory.
 * @jest-environment node
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'

import {
  isUploadArtifact,
  type Job,
  list,
  record,
  skippedTitle,
  type Step,
  stepRunnerSkipReason,
  str,
  strings,
  text,
  workflowReader,
} from './release/helpers/workflow-yaml'

const repo = join(__dirname, '..', '..')
const WORKFLOW = join(repo, '.github', 'workflows', 'release.yml')
const CLAUDE_MD = join(repo, 'CLAUDE.md')
const workflow = workflowReader(WORKFLOW)
const { jobs, job, needsOf, uses, environmentOf, upstream } = workflow
const STEP_SKIP = stepRunnerSkipReason(['bash'])
const stepIt = STEP_SKIP === null ? it : it.skip
const skipped = (title: string): string => skippedTitle(title, STEP_SKIP)

const BUILD_JOBS = ['build-macos', 'build-windows-x64', 'build-windows-arm64', 'build-linux-x64', 'build-linux-arm64']
const RELEASE_FLAG = 'OPENPLC_RELEASE_BUILD'
const SHELL_FLAG = /OPENPLC_RELEASE_BUILD=["']?1\b/
const STATUS_FUNCTION = /\b(always|cancelled|success|failure)\s*\(/
const RUNNER_LABEL = /^(macos|windows|ubuntu)-[\w.]+$/

/** Names electron-builder writes beside the installers, which a release must never carry. */
const UPDATE_FILES = [
  'latest.yml',
  'latest-mac.yml',
  'latest-linux.yml',
  'latest-linux-arm64.yml',
  'OpenPLC_Editor_4.4.0.dmg.blockmap',
  'OpenPLC.Editor_4.4.0.exe.blockmap',
  'OpenPLC.Editor_4.4.0-ARM64.exe.blockmap',
]

/** A value of a GitHub Actions expression. */
type Value = string | number | boolean | null | Value[] | { [key: string]: Value }

/** What the expressions of one job or step can read, and what `success()` returns there. */
type Frame = { contexts: Record<string, Value>; success: boolean }

/** The event that starts a workflow run. */
type Run = { name: string; event: 'push' | 'workflow_dispatch'; ref: string; inputs: Record<string, string> }

/** A step that runs, with its position in the job and the environment it sees. */
type Executed = { step: Step; index: number; env: Record<string, Value> }

/** Which jobs run, and which steps of a job run. */
type Plan = { runs: (id: string) => boolean; steps: (id: string) => Executed[] }

const TAG_PUSH: Run = { name: 'a tag push', event: 'push', ref: 'refs/tags/v4.4.0', inputs: {} }
const TAG_DISPATCH: Run = {
  name: 'a dispatch on a v* tag',
  event: 'workflow_dispatch',
  ref: 'refs/tags/v4.4.0',
  inputs: { version: '', platforms: 'all' },
}
const TAG_RUNS = [TAG_PUSH, TAG_DISPATCH]

function dispatch(name: string, inputs: Record<string, string>): Run {
  return {
    name,
    event: 'workflow_dispatch',
    ref: 'refs/heads/feature/hardening',
    inputs: { version: '', platforms: 'all', ...inputs },
  }
}

const BRANCH_DISPATCH = dispatch('a dispatch on a branch', {})
const BRANCH_DISPATCHES = [BRANCH_DISPATCH, dispatch('a dispatch on a branch with a version', { version: '4.4.0' })]

function isDownloadArtifact(step: Step): boolean {
  return uses(step).startsWith('actions/download-artifact')
}

function isBuilding(step: Step): boolean {
  return /npm run (build|package)\b|electron-builder/.test(str(step.run))
}

function isTrustDownload(step: Step): boolean {
  return isDownloadArtifact(step) && text(step.with).includes('trust-module')
}

function runs(fragment: string): (step: Step) => boolean {
  return (step) => str(step.run).includes(fragment)
}

function normalizedPath(value: unknown): string {
  return str(value).trim().replace(/^\.\//, '').replace(/\/$/, '')
}

function truthy(value: Value): boolean {
  return !(value === false || value === null || value === '' || value === 0 || Number.isNaN(value))
}

function toNumber(value: Value): number {
  if (value === null) return 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') return value.trim() === '' ? 0 : Number(value)
  return Number.NaN
}

function looseEqual(left: Value, right: Value): boolean {
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase()
  if (typeof left === 'object' || typeof right === 'object') {
    if (left === null || right === null) return toNumber(left) === toNumber(right)
    return left === right
  }
  return typeof left === typeof right ? left === right : toNumber(left) === toNumber(right)
}

function compare(operator: string, left: Value, right: Value): boolean {
  if (operator === '==') return looseEqual(left, right)
  if (operator === '!=') return !looseEqual(left, right)
  const order =
    typeof left === 'string' && typeof right === 'string'
      ? left.toLowerCase().localeCompare(right.toLowerCase())
      : toNumber(left) - toNumber(right)
  if (operator === '<') return order < 0
  if (operator === '<=') return order <= 0
  if (operator === '>') return order > 0
  return order >= 0
}

function member(value: Value, key: string): Value {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.prototype.hasOwnProperty.call(value, key) ? (value[key] ?? null) : null
}

function call(name: string, args: Value[], frame: Frame): Value {
  const [first = null, second = null] = args
  const lower = (value: Value): string => (value === null ? '' : String(value)).toLowerCase()
  switch (name.toLowerCase()) {
    case 'startswith':
      return lower(first).startsWith(lower(second))
    case 'endswith':
      return lower(first).endsWith(lower(second))
    case 'contains':
      return Array.isArray(first)
        ? first.some((item) => looseEqual(item, second))
        : lower(first).includes(lower(second))
    case 'always':
      return true
    case 'cancelled':
    case 'failure':
      return false
    case 'success':
      return frame.success
    default:
      throw new Error(`release.yml calls ${name}(), which this test cannot evaluate`)
  }
}

/** Token pattern of a GitHub Actions expression: a string, a number, a name or an operator. */
const TOKEN = /\s*(?:'((?:[^']|'')*)'|(\d+(?:\.\d+)?)|([A-Za-z_][\w-]*)|(&&|\|\||==|!=|<=|>=|[!<>().,[\]*]))/y

type Token = { kind: 'string' | 'number' | 'word' | 'op'; text: string }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const pattern = new RegExp(TOKEN.source, 'y')
  while (source.slice(pattern.lastIndex).trim() !== '') {
    const match = pattern.exec(source)
    if (match === null) throw new Error(`cannot read the expression "${source}"`)
    if (match[1] !== undefined) tokens.push({ kind: 'string', text: match[1].replace(/''/g, "'") })
    else if (match[2] !== undefined) tokens.push({ kind: 'number', text: match[2] })
    else if (match[3] !== undefined) tokens.push({ kind: 'word', text: match[3] })
    else tokens.push({ kind: 'op', text: match[4] })
  }
  return tokens
}

/** Evaluates one GitHub Actions expression, without its `${{ }}`, against the contexts of a frame. */
function evaluate(source: string, frame: Frame): Value {
  const tokens = tokenize(source)
  let position = 0

  const isOp = (op: string): boolean => tokens[position]?.kind === 'op' && tokens[position]?.text === op
  const take = (op?: string): Token => {
    const token = tokens[position]
    if (token === undefined || (op !== undefined && !isOp(op))) {
      throw new Error(`expected ${op ?? 'more'} in "${source}"`)
    }
    position += 1
    return token
  }

  function lookup(root: string): Value {
    if (!Object.prototype.hasOwnProperty.call(frame.contexts, root)) {
      throw new Error(`release.yml reads ${root} in "${source}", which this test cannot evaluate`)
    }
    return frame.contexts[root] ?? null
  }

  function primary(): Value {
    const token = take()
    if (token.kind === 'string') return token.text
    if (token.kind === 'number') return Number(token.text)
    if (token.kind === 'op' && token.text === '(') {
      const value = or()
      take(')')
      return value
    }
    if (token.kind !== 'word') throw new Error(`unexpected ${token.text} in "${source}"`)
    if (token.text === 'true') return true
    if (token.text === 'false') return false
    if (token.text === 'null') return null
    if (!isOp('(')) return lookup(token.text)
    take('(')
    const args: Value[] = []
    if (!isOp(')')) {
      args.push(or())
      while (isOp(',')) {
        take(',')
        args.push(or())
      }
    }
    take(')')
    return call(token.text, args, frame)
  }

  function postfix(): Value {
    let value = primary()
    for (;;) {
      if (isOp('.')) {
        take('.')
        value = member(value, take().text)
      } else if (isOp('[')) {
        take('[')
        const key = or()
        take(']')
        value = member(value, key === null ? '' : String(key))
      } else {
        return value
      }
    }
  }

  function unary(): Value {
    if (!isOp('!')) return postfix()
    take('!')
    return !truthy(unary())
  }

  function comparison(): Value {
    let left = unary()
    for (;;) {
      const operator = ['==', '!=', '<=', '>=', '<', '>'].find(isOp)
      if (operator === undefined) return left
      take(operator)
      left = compare(operator, left, unary())
    }
  }

  function and(): Value {
    let left = comparison()
    while (isOp('&&')) {
      take('&&')
      const right = comparison()
      left = truthy(left) ? right : left
    }
    return left
  }

  function or(): Value {
    let left = and()
    while (isOp('||')) {
      take('||')
      const right = and()
      left = truthy(left) ? left : right
    }
    return left
  }

  const value = or()
  if (position !== tokens.length) throw new Error(`cannot read the expression "${source}"`)
  return value
}

function stringify(value: Value): string {
  if (value === null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** A YAML value with every `${{ }}` replaced by what it evaluates to. */
function interpolate(value: unknown, frame: Frame): string {
  const raw = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  return raw.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, source: string) => stringify(evaluate(source, frame)))
}

/** The expression of an `if:`, without the `${{ }}` it may be wrapped in. */
function condition(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value)
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(raw)
  return wrapped === null ? raw : wrapped[1].trim()
}

/** Whether an `if:` holds; `implied` is what GitHub uses when the condition calls no status function. */
function holds(value: unknown, frame: Frame, implied: boolean): boolean {
  const source = condition(value)
  if (STATUS_FUNCTION.test(source)) return truthy(evaluate(source, frame))
  return implied && (source === '' || truthy(evaluate(source, frame)))
}

/** An `env:` block, evaluated; the release flag must evaluate, other variables may read what this test lacks. */
function envOf(values: unknown, frame: Frame): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(record(values)).map(([name, value]): [string, Value] => {
      if (name === RELEASE_FLAG) return [name, interpolate(value, frame)]
      try {
        return [name, interpolate(value, frame)]
      } catch {
        return [name, null]
      }
    }),
  )
}

function githubContext(run: Run): Value {
  return {
    event_name: run.event,
    ref: run.ref,
    ref_name: run.ref.replace(/^refs\/(tags|heads)\//, ''),
    ref_type: run.ref.startsWith('refs/tags/') ? 'tag' : 'branch',
    sha: '0123456789abcdef0123456789abcdef01234567',
    repository: 'Autonomy-Logic/openplc-editor',
    event: run.event === 'workflow_dispatch' ? { inputs: run.inputs } : { ref: run.ref },
  }
}

/** Works out which jobs and steps of release.yml run for the given event, every job that runs succeeding. */
function simulate(run: Run): Plan {
  const base: Record<string, Value> = { github: githubContext(run), inputs: run.inputs, vars: {} }
  const ran = new Map<string, boolean>()

  const needsContext = (entry: Job): Value =>
    Object.fromEntries(
      needsOf(entry).map((id): [string, Value] => [id, { result: runs(id) ? 'success' : 'skipped', outputs: {} }]),
    )

  function runs(id: string): boolean {
    const known = ran.get(id)
    if (known !== undefined) return known
    const entry = job(id)
    const succeeded = [...upstream(entry)].every(runs)
    const frame: Frame = { contexts: { ...base, needs: needsContext(entry) }, success: succeeded }
    const result = holds(entry.body.if, frame, succeeded)
    ran.set(id, result)
    return result
  }

  function steps(id: string): Executed[] {
    if (!runs(id)) return []
    const entry = job(id)
    const jobFrame: Frame = { contexts: { ...base, needs: needsContext(entry) }, success: true }
    const env = { ...envOf(workflow.doc.env, jobFrame), ...envOf(entry.body.env, jobFrame) }
    const stepFrame: Frame = { contexts: { ...jobFrame.contexts, env }, success: true }
    return entry.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => holds(step.if, stepFrame, true))
      .map(({ step, index }) => ({ step, index, env: { ...env, ...envOf(step.env, stepFrame) } }))
  }

  return { runs, steps }
}

function running(run: Run, ids: string[]): string[] {
  const plan = simulate(run)
  return ids.filter((id) => plan.runs(id))
}

/** Shell words, quotes removed; a `${{ }}` left unquoted splits into several words. */
function shellWords(line: string): string[] {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3])
}

/** The step of @p entry whose script runs @p script; throws naming both when there is none. */
function stepRunning(entry: Job, script: string): Step {
  const found = entry.steps.find(runs(script))
  if (found === undefined) throw new Error(`${entry.id} has no step running ${script}`)
  return found
}

/** The shell words of the line of @p step that runs @p script, its line continuations joined. */
function commandWords(step: Step, script: string): string[] {
  const lines = str(step.run)
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
  return shellWords(lines.find((line) => line.includes(script)) ?? '')
}

/** The asset paths given to `gh release create` or `gh release upload`, with the job that runs them. */
function releaseAssetGlobs(): { where: string; glob: string }[] {
  return jobs().flatMap((entry) =>
    entry.steps.flatMap((step) =>
      str(step.run)
        .replace(/\\\r?\n/g, ' ')
        .split('\n')
        .flatMap((line) => {
          const command = /gh release (create|upload)\b/.exec(line)
          if (command === null) return []
          return shellWords(line.slice(command.index + command[0].length))
            .filter((word) => !word.startsWith('-') && (word.includes('/') || word.includes('*')))
            .map((glob) => ({ where: `${entry.id}: ${str(step.name)}`, glob }))
        }),
    ),
  )
}

/** Whether the file-name part of a glob matches a name; an expression or shell variable matches anything. */
function globMatches(glob: string, name: string): boolean {
  const base = (glob.split('/').pop() ?? '').replace(/\$\{\{[\s\S]*?\}\}|\$\{?\w+\}?/g, '*')
  const source = [...base]
    .map((char) => (char === '*' ? '[^/]*' : char === '?' ? '[^/]' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${source}$`).test(name)
}

/** The position of the first step text holding a fragment: the step index, then the offset in its script. */
function position(entry: Job, fragment: string): number {
  for (const [index, step] of entry.steps.entries()) {
    const offset = str(step.run).indexOf(fragment)
    if (offset >= 0) return index * 1_000_000 + offset
  }
  return -1
}

describe('release.yml: trigger and inputs', () => {
  it('still starts on v* tag pushes and by hand with the version and platforms inputs', () => {
    const on = record(workflow.doc.on)
    const inputs = record(record(on.workflow_dispatch).inputs)

    expect(list(record(on.push).tags)).toEqual(['v*'])
    expect(Object.keys(inputs).sort()).toEqual(['platforms', 'version'])
    expect(list(record(inputs.platforms).options)).toEqual(['all', 'macos', 'windows', 'linux'])
  })
})

describe('release.yml: which jobs run', () => {
  it.each(TAG_RUNS)('runs trust-module, the five build jobs, packaged-checks and create-release on $name', (run) => {
    const expected = ['trust-module', ...BUILD_JOBS, 'packaged-checks', 'create-release']

    expect(expected.filter((id) => !running(run, [id]).includes(id))).toEqual([])
  })

  it.each(BRANCH_DISPATCHES)('runs the five build jobs and packaged-checks on $name', (run) => {
    const expected = [...BUILD_JOBS, 'packaged-checks']

    expect(expected.filter((id) => !running(run, [id]).includes(id))).toEqual([])
  })

  it.each(BRANCH_DISPATCHES)('runs neither trust-module nor create-release on $name', (run) => {
    expect(running(run, ['trust-module', 'create-release'])).toEqual([])
  })

  it.each([
    ['macos', ['build-macos']],
    ['windows', ['build-windows-x64', 'build-windows-arm64']],
    ['linux', ['build-linux-x64', 'build-linux-arm64']],
  ])('builds only the %s jobs on a dispatch with that platform', (platforms, expected) => {
    expect(running(dispatch('a dispatch for one platform', { platforms }), BUILD_JOBS)).toEqual(expected)
  })
})

describe('release.yml: trust-module', () => {
  function secretStep(): Step {
    return job('trust-module').steps.find((step) => text(step).includes('TRUST_SEED_SECRET')) ?? {}
  }

  it('uses the release-trust environment, the only job with an environment', () => {
    const environments = Object.fromEntries(
      jobs()
        .filter((entry) => environmentOf(entry) !== undefined)
        .map((entry) => [entry.id, environmentOf(entry)]),
    )

    expect(environments).toStrictEqual({ 'trust-module': 'release-trust' })
  })

  it('names the seed secret in exactly one step, a step of trust-module', () => {
    const named = (value: unknown): boolean => text(value).includes('TRUST_SEED_SECRET')
    const { jobs: _jobs, ...top } = workflow.doc
    const locations = named(top) ? ['workflow'] : []
    for (const entry of jobs()) {
      const { steps: _steps, ...rest } = entry.body
      if (named(rest)) locations.push(entry.id)
      entry.steps.forEach((step, index) => {
        if (named(step)) locations.push(`${entry.id}#${index}`)
      })
    }

    expect(locations.map((location) => location.replace(/#\d+$/, '#step'))).toEqual(['trust-module#step'])
  })

  it('gives the secret as OPENPLC_TRUST_SEED_SECRET to the step that generates the module into release/package-trust', () => {
    const step = secretStep()

    expect(str(record(step.env).OPENPLC_TRUST_SEED_SECRET).replace(/\s/g, '')).toBe('${{secrets.TRUST_SEED_SECRET}}')
    expect(str(step.run)).toContain('scripts/package-trust/cli.ts generate-release')
    expect(str(step.run)).toContain('--out release/package-trust/package-trust-anchor.ts')
  })

  it('never hands every secret to a step or a called workflow', () => {
    expect(['toJSON(secrets)', 'secrets: inherit'].filter((token) => workflow.raw.includes(token))).toEqual([])
  })

  it('installs its dependencies with npm ci --ignore-scripts only', () => {
    const steps = job('trust-module').steps
    const installs = steps.filter((step) => /\bnpm (ci|install|i)\b/.test(str(step.run)))

    const offenders = installs.filter((step) => !str(step.run).includes('npm ci --ignore-scripts'))

    expect(installs.length).toBeGreaterThanOrEqual(1)
    expect(offenders.map((step) => str(step.name) || str(step.run))).toEqual([])
  })

  it('uses no cache: no actions/cache step and no setup-node cache', () => {
    const offenders = job('trust-module')
      .steps.filter((step) => uses(step).startsWith('actions/cache') || record(step.with).cache !== undefined)
      .map((step) => str(step.name) || uses(step))

    expect(offenders).toEqual([])
  })

  it('generates the module, then runs check-sites.test.ts on it, then uploads it', () => {
    const steps = job('trust-module').steps
    const generate = steps.findIndex(runs('scripts/package-trust/cli.ts generate-release'))
    const check = steps.findIndex(
      (step) => text(step).includes('OPENPLC_TRUST_MODULE_UNDER_TEST') && text(step).includes('check-sites.test.ts'),
    )
    const upload = steps.findIndex(isUploadArtifact)

    expect(generate).toBeGreaterThanOrEqual(0)
    expect([generate < check, check < upload]).toEqual([true, true])
  })

  it('uploads only package-trust-anchor.ts, as the trust-module artifact kept for one day', () => {
    const uploads = job('trust-module').steps.filter(isUploadArtifact)
    const options = record(uploads[0]?.with)
    const path = str(options.path).trim()

    expect(uploads).toHaveLength(1)
    expect({
      name: options.name,
      onlyTheModule: !path.includes('\n') && path.endsWith('package-trust-anchor.ts'),
      retention: String(options['retention-days']),
    }).toEqual({ name: 'trust-module', onlyTheModule: true, retention: '1' })
  })
})

describe('release.yml: build jobs', () => {
  it.each(TAG_RUNS)('runs every build and package step with OPENPLC_RELEASE_BUILD=1 on $name', (run) => {
    const plan = simulate(run)
    const offenders = BUILD_JOBS.flatMap((id) => {
      const executed = plan.steps(id)
      const building = executed.filter(({ step }) => isBuilding(step))
      if (building.length === 0) return [`${id}: no build step runs`]
      return building
        .filter(
          ({ index, env }) =>
            stringify(env[RELEASE_FLAG] ?? null) !== '1' &&
            !executed.some((other) => other.index <= index && SHELL_FLAG.test(str(other.step.run))),
        )
        .map(({ step }) => `${id}: ${str(step.run)}`)
    })

    expect(offenders).toEqual([])
  })

  it.each(BRANCH_DISPATCHES)('builds every job without OPENPLC_RELEASE_BUILD on $name', (run) => {
    const plan = simulate(run)
    const offenders = BUILD_JOBS.flatMap((id) => {
      const executed = plan.steps(id)
      if (!executed.some(({ step }) => isBuilding(step))) return [`${id}: no build step runs`]
      const fromEnv = executed
        .filter(({ step, env }) => isBuilding(step) && stringify(env[RELEASE_FLAG] ?? null) !== '')
        .map(({ step, env }) => `${id}: ${RELEASE_FLAG}=${stringify(env[RELEASE_FLAG] ?? null)} for ${str(step.run)}`)
      const fromShell = executed
        .filter(({ step }) => SHELL_FLAG.test(str(step.run)))
        .map(({ step }) => `${id}: sets ${RELEASE_FLAG} in "${str(step.name)}"`)
      return [...fromEnv, ...fromShell]
    })

    expect(offenders).toEqual([])
  })

  it.each(TAG_RUNS)(
    'downloads the trust-module artifact into release/package-trust before building, on $name',
    (run) => {
      const plan = simulate(run)
      const offenders = BUILD_JOBS.flatMap((id) => {
        const executed = plan.steps(id)
        const download = executed.find(({ step }) => isTrustDownload(step))
        const firstBuild = executed.find(({ step }) => isBuilding(step))
        if (download === undefined) return [`${id}: does not download trust-module`]
        const options = record(download.step.with)
        const problems: string[] = []
        if (options.name !== 'trust-module') problems.push(`${id}: downloads ${text(options.name)}`)
        if (normalizedPath(options.path) !== 'release/package-trust') {
          problems.push(`${id}: downloads into ${text(options.path)}`)
        }
        if (firstBuild === undefined || download.index > firstBuild.index) {
          problems.push(`${id}: downloads after building`)
        }
        return problems
      })

      expect(offenders).toEqual([])
    },
  )

  it.each(BRANCH_DISPATCHES)('downloads no trust module on $name', (run) => {
    const plan = simulate(run)
    const offenders = BUILD_JOBS.flatMap((id) =>
      plan
        .steps(id)
        .filter(({ step }) => isTrustDownload(step))
        .map(({ step }) => `${id}: ${str(step.name)}`),
    )

    expect(offenders).toEqual([])
  })

  it.each([TAG_PUSH, BRANCH_DISPATCH])(
    'reads the fuses and scans for trust literals after packaging and before any upload, in every build job, on $name',
    (run) => {
      const plan = simulate(run)
      const offenders = BUILD_JOBS.filter((id) => {
        const executed = plan.steps(id)
        const lastBuild = Math.max(-1, ...executed.filter(({ step }) => isBuilding(step)).map(({ index }) => index))
        const firstUpload = executed.find(({ step }) => isUploadArtifact(step))?.index ?? -1
        const fuses = executed.find(({ step }) => runs('scripts/release/read-fuses.mjs')(step))?.index ?? -1
        const literals = executed.find(({ step }) => runs('scripts/release/scan-trust-literals.mjs')(step))?.index ?? -1
        return [fuses, literals].some((index) => index < 0 || index < lastBuild || index > firstUpload)
      })

      expect(offenders).toEqual([])
    },
  )
})

describe('release.yml: artifact uploads', () => {
  it('fails every upload-artifact step of trust-module and the five build jobs when it finds no file', () => {
    const offenders = ['trust-module', ...BUILD_JOBS].flatMap((id) => {
      const uploads = job(id).steps.filter(isUploadArtifact)
      if (uploads.length === 0) return [`${id}: no upload-artifact step`]
      return uploads
        .map((step) => ({ step, value: record(step.with)['if-no-files-found'] }))
        .filter(({ value }) => value !== 'error')
        .map(({ step, value }) => `${id}: ${str(step.name)} (${value === undefined ? 'unset' : String(value)})`)
    })

    expect(offenders).toEqual([])
  })
})

describe('release.yml: packaged-checks', () => {
  function checks(): Job {
    return job('packaged-checks')
  }

  it('runs on macos-latest, windows-2022 and ubuntu-22.04 through its matrix', () => {
    const runners = strings(record(checks().body.strategy).matrix).filter((value) => RUNNER_LABEL.test(value))

    expect([...new Set(runners)].sort()).toEqual(['macos-latest', 'ubuntu-22.04', 'windows-2022'])
  })

  it('waits for the macOS, Windows x64 and Linux x64 build jobs', () => {
    const needs = needsOf(checks())

    expect(['build-macos', 'build-windows-x64', 'build-linux-x64'].filter((id) => !needs.includes(id))).toEqual([])
  })

  it('runs packaged-checks.mjs with the positive control', () => {
    expect(
      checks().steps.some(
        (step) =>
          str(step.run).includes('scripts/release/packaged-checks.mjs') && str(step.run).includes('--positive-control'),
      ),
    ).toBe(true)
  })

  it('runs packaged-checks.mjs with --allow-prerelease, so a prerelease tag passes its version rule', () => {
    const script = 'scripts/release/packaged-checks.mjs'

    expect(commandWords(stepRunning(checks(), script), script)).toContain('--allow-prerelease')
  })

  it('runs no negative control anywhere in the workflow', () => {
    expect(strings(workflow.doc).filter((value) => value.includes('--negative-control'))).toEqual([])
  })

  it("checks the run's installers, downloaded as artifacts, never a published release", () => {
    const steps = checks().steps
    const fromReleases = steps.filter((step) => /releases\/download\/|gh release download/.test(text(step)))

    expect(steps.some(isDownloadArtifact)).toBe(true)
    expect(fromReleases.map((step) => str(step.name))).toEqual([])
  })
})

describe('release.yml: create-release', () => {
  it('waits for packaged-checks and the five build jobs', () => {
    const needs = needsOf(job('create-release'))

    expect(['packaged-checks', ...BUILD_JOBS].filter((id) => !needs.includes(id))).toEqual([])
  })

  it('runs check-upload-set.mjs before gh release create', () => {
    const entry = job('create-release')
    const check = position(entry, 'scripts/release/check-upload-set.mjs')
    const create = position(entry, 'gh release create')

    expect(check).toBeGreaterThanOrEqual(0)
    expect(create).toBeGreaterThan(check)
  })

  describe('the upload-set check', () => {
    const SCRIPT = 'scripts/release/check-upload-set.mjs'
    const PRERELEASE_INSTALLERS = [
      'OpenPLC.Editor-4.4.0-rc1.AppImage',
      'OpenPLC.Editor-4.4.0-rc1-ARM64.AppImage',
      'OpenPLC.Editor_4.4.0-rc1.exe',
      'OpenPLC.Editor_4.4.0-rc1-ARM64.exe',
      'OpenPLC_Editor_4.4.0-rc1.dmg',
      'OpenPLC_Editor_4.4.0-rc1-ARM.dmg',
    ]

    let dir = ''

    afterEach(() => {
      if (dir !== '') rmSync(dir, { recursive: true, force: true })
      dir = ''
    })

    function uploadSetCheck(): Step {
      return stepRunning(job('create-release'), SCRIPT)
    }

    /**
     * Runs the step's script under bash, as a runner does, with VERSION=4.4.0-rc1 and an `upload` directory holding
     * @p names, beside a link to the repository's scripts/.
     */
    function runUploadSetCheck(names: string[]): { status: number | null; output: string } {
      dir = mkdtempSync(join(realpathSync(tmpdir()), 'release-upload-set-'))
      symlinkSync(join(repo, 'scripts'), join(dir, 'scripts'))
      mkdirSync(join(dir, 'upload'))
      for (const name of names) writeFileSync(join(dir, 'upload', name), `installer ${name}\n`)
      const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', str(uploadSetCheck().run)], {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
          VERSION: '4.4.0-rc1',
        },
        encoding: 'utf8',
      })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    }

    it('runs check-upload-set.mjs with --allow-prerelease', () => {
      expect(commandWords(uploadSetCheck(), SCRIPT)).toContain('--allow-prerelease')
    })

    it('gives check-upload-set.mjs the version through its env, with no ${{ }} in its script', () => {
      const step = uploadSetCheck()
      const words = commandWords(step, SCRIPT)

      expect(str(step.run)).not.toContain('${{')
      expect(words[words.indexOf('--version') + 1]).toBe('$VERSION')
      expect(str(record(step.env).VERSION)).toMatch(/^\$\{\{\s*steps\.version\.outputs\.version\s*\}\}$/)
    })

    stepIt(skipped('passes the six 4.4.0-rc1 installers when run for the tag v4.4.0-rc1'), () => {
      const result = runUploadSetCheck(PRERELEASE_INSTALLERS)

      expect({ status: result.status, output: result.output }).toEqual({
        status: 0,
        output: expect.stringContaining('4.4.0-rc1'),
      })
    })

    stepIt(skipped('fails the six 4.4.0-rc1 installers plus latest.yml, naming it (ABUSE-11)'), () => {
      const result = runUploadSetCheck([...PRERELEASE_INSTALLERS, 'latest.yml'])

      expect(result.status).toBe(1)
      expect(result.output).toContain('latest.yml')
    })
  })

  it('gives gh release create installer globs, none matching update metadata or a blockmap', () => {
    const globs = releaseAssetGlobs()
    const offenders = globs.flatMap(({ where, glob }) =>
      UPDATE_FILES.filter((name) => globMatches(glob, name)).map((name) => `${where}: ${glob} matches ${name}`),
    )

    expect(globs.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })

  it('uploads no update metadata or blockmap as an artifact', () => {
    const offenders = jobs().flatMap((entry) =>
      entry.steps
        .filter((step) => isUploadArtifact(step) && /latest|blockmap/i.test(text(record(step.with).path)))
        .map((step) => `${entry.id}: ${str(step.name)}`),
    )

    expect(offenders).toEqual([])
  })
})

describe('release.yml: cross-seed', () => {
  const CHECK = 'npx ts-node --transpile-only scripts/package-trust/cli.ts cross-seed-check'

  function crossSeed(): Job {
    return job('cross-seed')
  }

  it.each(TAG_RUNS)('runs on $name', (run) => {
    expect(running(run, ['cross-seed'])).toEqual(['cross-seed'])
  })

  it.each(BRANCH_DISPATCHES)('does not run on $name', (run) => {
    expect(running(run, ['cross-seed'])).toEqual([])
  })

  it('is waited for by create-release', () => {
    expect(needsOf(job('create-release'))).toContain('cross-seed')
  })

  it('grants only contents: read, in its own permissions', () => {
    expect(crossSeed().body.permissions).toStrictEqual({ contents: 'read' })
  })

  it('uses no environment and names no secret and no token', () => {
    const raw = text(crossSeed().body)

    expect(environmentOf(crossSeed())).toBeUndefined()
    expect(raw).not.toMatch(/secrets\s*[.[]/)
    expect(raw).not.toMatch(/github\.token|GITHUB_TOKEN|GH_TOKEN/)
  })

  it('checks out the repository keeping no credentials', () => {
    const checkouts = crossSeed().steps.filter((step) => uses(step).startsWith('actions/checkout'))

    expect(checkouts.length).toBeGreaterThanOrEqual(1)
    expect(checkouts.map((step) => record(step.with)['persist-credentials'])).toEqual(checkouts.map(() => false))
  })

  it('sets up Node 22', () => {
    const setup = crossSeed().steps.find((step) => uses(step).startsWith('actions/setup-node'))
    const version = str(record(setup?.with)['node-version'])
    const resolved = /^\$\{\{\s*env\.NODE_VERSION\s*\}\}$/.test(version)
      ? str(record(workflow.doc.env).NODE_VERSION)
      : version

    expect(resolved).toMatch(/^22(\.|$)/)
  })

  it('runs npm ci --ignore-scripts, then npm run setup:strucpp, then cli.ts cross-seed-check', () => {
    const entry = crossSeed()
    const install = position(entry, 'npm ci --ignore-scripts')
    const strucpp = position(entry, 'npm run setup:strucpp')
    const check = position(entry, CHECK)

    expect(install).toBeGreaterThanOrEqual(0)
    expect([install < strucpp, strucpp < check]).toEqual([true, true])
  })

  it('installs its dependencies with npm ci --ignore-scripts only', () => {
    const installs = crossSeed().steps.filter((step) => /\bnpm (ci|install|i)\b|\byarn\b|\bpnpm\b/.test(str(step.run)))

    expect(installs.length).toBeGreaterThanOrEqual(1)
    expect(installs.filter((step) => !str(step.run).includes('npm ci --ignore-scripts'))).toEqual([])
  })

  it('creates no release and uploads nothing', () => {
    const offenders = crossSeed()
      .steps.filter((step) => /\bgh\s+release\b/.test(str(step.run)) || isUploadArtifact(step))
      .map((step) => str(step.name))

    expect(offenders).toEqual([])
  })
})

describe('CLAUDE.md', () => {
  function section(heading: string): string {
    const lines = readFileSync(CLAUDE_MD, 'utf8').split('\n')
    const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
    if (start < 0) return ''
    const end = lines.findIndex((line, index) => index > start && /^##? /.test(line))
    return lines.slice(start + 1, end < 0 ? undefined : end).join('\n')
  }

  it('records the package-trust exception and PackageManagerModule in one paragraph of "Thin adapters (hard rule)"', () => {
    const paragraphs = section('Thin adapters (hard rule)').split(/\n\s*\n/)

    expect(
      paragraphs.some(
        (paragraph) =>
          paragraph.includes('src/backend/editor/package-trust/') && paragraph.includes('PackageManagerModule'),
      ),
    ).toBe(true)
  })
})
