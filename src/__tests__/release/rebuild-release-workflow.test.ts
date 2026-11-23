/**
 * The structure of `.github/workflows/rebuild-release.yml`, read with the `yaml` package: its inputs, permissions,
 * environments, where the seed secret is visible, the order of the checks around the asset replacement, and the job
 * that runs the abuse checks on the installed builds. The asset replacement, the digest read-back and the trust-module
 * artifact check also run as bash scripts against a fake `gh`, `curl` and `sleep` that keep a release in a JSON file.
 * @jest-environment node
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'
import { parse } from 'yaml'

const repo = join(__dirname, '..', '..', '..')
const WORKFLOW = join(repo, '.github', 'workflows', 'rebuild-release.yml')

type Step = Record<string, unknown>

/** One job of the workflow, with its id and its steps in order. */
type Job = { id: string; body: Record<string, unknown>; steps: Step[] }

/** Steps that change a release: an asset upload or delete, a body edit, or an action that can do either. */
const MUTATION =
  /gh release (upload|delete-asset|edit)|uploads\.github\.com|(-X|--method|--request)[ =]?(DELETE|POST|PATCH|PUT)\b|actions\/github-script|upload-release-asset|action-gh-release/

/** A reference to the seed secret, in dot or bracket form. */
const SECRET_REFERENCE = /secrets\s*(\.\s*TRUST_SEED_SECRET|\[\s*['"]TRUST_SEED_SECRET['"]\s*\])/

let loaded: { raw: string; doc: Record<string, unknown> } | undefined

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function text(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

/** Every string value of a parsed YAML node, keys excluded, so YAML comments are never read. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  return Object.values(record(value)).flatMap(strings)
}

function workflow(): { raw: string; doc: Record<string, unknown> } {
  if (loaded === undefined) {
    const raw = readFileSync(WORKFLOW, 'utf8')
    loaded = { raw, doc: record(parse(raw)) }
  }
  return loaded
}

function jobs(): Job[] {
  return Object.entries(record(workflow().doc.jobs)).map(([id, body]) => ({
    id,
    body: record(body),
    steps: list(record(body).steps).map(record),
  }))
}

function job(id: string): Job {
  const found = jobs().find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`rebuild-release.yml has no job "${id}"`)
  return found
}

function needsOf(entry: Job): string[] {
  const needs = entry.body.needs
  return typeof needs === 'string' ? [needs] : list(needs).map(String)
}

/** The five build jobs: the ones that wait for the trust module they package. */
function buildJobs(): Job[] {
  return jobs().filter((entry) => needsOf(entry).includes('trust-module'))
}

function uses(step: Step): string {
  return str(step.uses)
}

function stepIndex(entry: Job, predicate: (step: Step) => boolean): number {
  return entry.steps.findIndex(predicate)
}

function lastStepIndex(entry: Job, predicate: (step: Step) => boolean): number {
  return entry.steps.reduce((last, step, index) => (predicate(step) ? index : last), -1)
}

function mentions(fragment: string): (step: Step) => boolean {
  return (step) => text(step).includes(fragment)
}

function isMutation(step: Step): boolean {
  return MUTATION.test(text(step))
}

function isUploadArtifact(step: Step): boolean {
  return uses(step).startsWith('actions/upload-artifact')
}

function isCheckout(step: Step, path: string): boolean {
  const checkoutPath = str(record(step.with).path).replace(/^\.\//, '').replace(/\/$/, '')
  return uses(step).startsWith('actions/checkout') && checkoutPath === path
}

function environmentOf(entry: Job): string | undefined {
  const environment = entry.body.environment
  if (environment === undefined) return undefined
  return typeof environment === 'string' ? environment : str(record(environment).name)
}

function contentsPermission(entry: Job): unknown {
  return record(entry.body.permissions).contents
}

/** Every job the given job waits for, directly or through another job. */
function upstream(entry: Job): Set<string> {
  const seen = new Set<string>()
  const pending = [...needsOf(entry)]
  while (pending.length > 0) {
    const id = pending.pop() ?? ''
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...needsOf(job(id)))
  }
  return seen
}

function inputs(): Record<string, Record<string, unknown>> {
  const dispatch = record(record(workflow().doc.on).workflow_dispatch)
  return Object.fromEntries(Object.entries(record(dispatch.inputs)).map(([name, value]) => [name, record(value)]))
}

const REPOSITORY = 'Autonomy-Logic/openplc-editor'
const RELEASE = 'v4.3.5-rehearsal'
const RELEASE_ID = 777
const VERSION = '4.3.5'
const REF = 'feature/ABC-1-backport-v4.3.5'
const RUN_ID = '4242'
const SHA = '0123456789abcdef0123456789abcdef01234567'

const NAMES = [
  `OpenPLC.Editor-${VERSION}.AppImage`,
  `OpenPLC.Editor-${VERSION}-ARM64.AppImage`,
  `OpenPLC.Editor_${VERSION}.exe`,
  `OpenPLC.Editor_${VERSION}-ARM64.exe`,
  `OpenPLC_Editor_${VERSION}.dmg`,
  `OpenPLC_Editor_${VERSION}-ARM.dmg`,
]

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function rebuilt(name: string): string {
  return `rebuilt ${name}\n`
}

const ORIGINAL = Object.fromEntries(NAMES.map((name) => [name, sha256(`original ${name}\n`)]))
const BUILT = Object.fromEntries(NAMES.map((name) => [name, sha256(rebuilt(name))]))

/** An asset of the fake release; a `pending` asset shows `digest: null` while `reads <= pendingReads`. */
type FakeAsset = { id: number; name: string; sha: string; pending?: boolean }

/** An artifact of the run the fake Actions API lists. */
type FakeArtifact = { id: number; name: string; expired: boolean }

/** The fake GitHub: one release, one workflow run's artifacts, and the upload name to refuse. */
type FakeState = {
  releaseId: number
  runId: string
  assets: FakeAsset[]
  artifacts: FakeArtifact[]
  nextId: number
  reads: number
  pendingReads: number
  failUpload?: string
}

/** One call the fake recorded: an upload, a refused upload, a delete, a rename or a sleep. */
type Call = Record<string, unknown>

/** A temporary directory a step runs in, with the fake tools in `bin/` and `tooling/` linked to this checkout. */
type Sandbox = { dir: string; bin: string; state: string; log: string; temp: string }

type StepResult = { status: number; output: string }

/**
 * The fake `gh api`, `curl` upload and `sleep`. It serves the routes the workflow uses over a JSON state file, applies
 * `--jq` with the jq binary, refuses an upload under a name the release already holds, as GitHub does, and logs each
 * change.
 */
const FAKE_GITHUB = String.raw`
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const [tool, ...args] = process.argv.slice(2)
const statePath = process.env.FAKE_GITHUB_STATE
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const repo = 'repos/' + process.env.GITHUB_REPOSITORY + '/'

function log(entry) {
  appendFileSync(process.env.FAKE_GITHUB_LOG, JSON.stringify(entry) + '\n')
}

function save() {
  writeFileSync(statePath, JSON.stringify(state))
}

function fail(message, code) {
  save()
  process.stderr.write(message + '\n')
  process.exit(code)
}

function view(asset) {
  const pending = asset.pending === true && state.reads <= state.pendingReads
  return { id: asset.id, name: asset.name, size: 1, digest: pending ? null : 'sha256:' + asset.sha }
}

function respond(body, jq, out) {
  const json = JSON.stringify(body)
  const text = jq === undefined ? json + '\n' : execFileSync('jq', ['-r', jq], { input: json, encoding: 'utf8' })
  if (out === undefined) process.stdout.write(text)
  else if (out !== '/dev/null') writeFileSync(out, text)
}

function gh() {
  if (args[0] !== 'api') fail('fake gh: unsupported command: ' + args.join(' '), 2)
  let method
  let jq
  let path
  const fields = {}
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '-X' || arg === '--method') method = args[++i]
    else if (arg.startsWith('--method=')) method = arg.slice(9)
    else if (arg === '--jq' || arg === '-q') jq = args[++i]
    else if (arg === '-H' || arg === '--header') i += 1
    else if (arg === '--paginate' || arg === '--silent') continue
    else if (['-f', '-F', '--field', '--raw-field'].includes(arg)) {
      const field = args[++i]
      fields[field.slice(0, field.indexOf('='))] = field.slice(field.indexOf('=') + 1)
    } else if (!arg.startsWith('-') && path === undefined) path = arg
    else fail('fake gh: unsupported argument ' + arg, 2)
  }
  method = (method ?? (Object.keys(fields).length > 0 ? 'POST' : 'GET')).toUpperCase()
  const [route, query = ''] = String(path).replace(/^\//, '').split('?')
  if (!route.startsWith(repo)) fail('fake gh: unexpected path ' + path, 2)
  const parts = route.slice(repo.length).split('/')
  const key = method + ' ' + parts.map((part, index) => (index > 0 && /^\d+$/.test(part) ? ':id' : part)).join('/')
  if (key === 'GET releases/:id' || key === 'GET releases/:id/assets') {
    if (Number(parts[1]) !== state.releaseId) fail('gh: Not Found (HTTP 404)', 1)
    state.reads += 1
    const assets = state.assets.map(view)
    respond(parts.length === 2 ? { id: state.releaseId, tag_name: 'tag', body: '', assets } : assets, jq)
  } else if (/^(GET|DELETE|PATCH) releases\/assets\/:id$/.test(key)) {
    const asset = state.assets.find((entry) => entry.id === Number(parts[2]))
    if (asset === undefined) fail('gh: Not Found (HTTP 404)', 1)
    if (method === 'DELETE') {
      state.assets = state.assets.filter((entry) => entry !== asset)
      log({ op: 'delete', id: asset.id, name: asset.name })
    } else if (method === 'PATCH') {
      if (typeof fields.name !== 'string') fail('fake gh: PATCH of an asset without a name field', 2)
      if (state.assets.some((entry) => entry !== asset && entry.name === fields.name)) {
        fail('gh: Validation Failed (HTTP 422): already_exists', 1)
      }
      log({ op: 'rename', id: asset.id, from: asset.name, to: fields.name })
      asset.name = fields.name
      respond(view(asset), jq)
    } else respond(view(asset), jq)
  } else if (key === 'GET actions/runs/:id/artifacts') {
    if (parts[2] !== state.runId) fail('gh: Not Found (HTTP 404)', 1)
    const name = new URLSearchParams(query).get('name')
    const artifacts = state.artifacts.filter((entry) => name === null || entry.name === name)
    respond({ total_count: artifacts.length, artifacts }, jq)
  } else fail('fake gh: unsupported route ' + method + ' ' + path, 2)
  save()
}

function curl() {
  const switches = ['-s', '-S', '-sS', '-Ss', '--silent', '--show-error', '--fail', '-f', '--fail-with-body', '-L']
  let method
  let url
  let file
  let out
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (switches.includes(arg)) continue
    else if (arg === '-X' || arg === '--request') method = args[++i]
    else if (arg === '-H' || arg === '--header') i += 1
    else if (arg === '-o' || arg === '--output') out = args[++i]
    else if (arg === '--data-binary') file = args[++i].replace(/^@/, '')
    else if (arg === '-T' || arg === '--upload-file') file = args[++i]
    else if (arg.startsWith('https://')) url = arg
    else fail('fake curl: unsupported argument ' + arg, 2)
  }
  const target = new URL(url)
  const expected = '/' + repo + 'releases/' + state.releaseId + '/assets'
  if (target.host !== 'uploads.github.com' || target.pathname !== expected || (method ?? 'POST') !== 'POST') {
    fail('fake curl: unsupported request ' + (method ?? 'POST') + ' ' + url, 2)
  }
  const name = target.searchParams.get('name')
  if (name === state.failUpload) {
    log({ op: 'upload-failed', name })
    fail('curl: (22) The requested URL returned error: 502', 22)
  }
  if (state.assets.some((entry) => entry.name === name)) {
    log({ op: 'upload-refused', name })
    fail('curl: (22) The requested URL returned error: 422', 22)
  }
  const asset = { id: state.nextId, name, sha: createHash('sha256').update(readFileSync(file)).digest('hex') }
  state.nextId += 1
  state.assets.push(asset)
  log({ op: 'upload', id: asset.id, name })
  respond(view(asset), undefined, out)
  save()
}

if (tool === 'gh') gh()
else if (tool === 'curl') curl()
else if (tool === 'sleep') log({ op: 'sleep', args })
else fail('fake github: unknown tool ' + tool, 2)
`

const sandboxes: string[] = []

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function releaseState(assets: FakeAsset[]): FakeState {
  return { releaseId: RELEASE_ID, runId: RUN_ID, assets, artifacts: [], nextId: 900, reads: 0, pendingReads: 0 }
}

function writeState(box: Sandbox, state: FakeState): void {
  writeFileSync(box.state, JSON.stringify(state))
}

function readState(box: Sandbox): FakeState {
  const state = record(JSON.parse(readFileSync(box.state, 'utf8')))
  return {
    releaseId: Number(state.releaseId),
    runId: str(state.runId),
    assets: list(state.assets)
      .map(record)
      .map((asset) => ({
        id: Number(asset.id),
        name: str(asset.name),
        sha: str(asset.sha),
        pending: asset.pending === true,
      })),
    artifacts: list(state.artifacts)
      .map(record)
      .map((artifact) => ({ id: Number(artifact.id), name: str(artifact.name), expired: artifact.expired === true })),
    nextId: Number(state.nextId),
    reads: Number(state.reads),
    pendingReads: Number(state.pendingReads),
    failUpload: typeof state.failUpload === 'string' ? state.failUpload : undefined,
  }
}

function readCalls(box: Sandbox): Call[] {
  return readFileSync(box.log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): Call => record(JSON.parse(line)))
}

/** A new sandbox with the fake tools, `tooling/` linked to this checkout and an empty release. */
function sandbox(): Sandbox {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'rebuild-release-'))
  sandboxes.push(dir)
  const box = {
    dir,
    bin: join(dir, 'bin'),
    state: join(dir, 'fake-github.json'),
    log: join(dir, 'fake-github.log'),
    temp: join(dir, 'runner-temp'),
  }
  mkdirSync(box.temp, { recursive: true })
  write(join(box.bin, 'fake-github.mjs'), FAKE_GITHUB)
  for (const tool of ['gh', 'curl', 'sleep']) {
    const wrapper = join(box.bin, tool)
    write(
      wrapper,
      `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} "$(dirname "$0")/fake-github.mjs" ${tool} "$@"\n`,
    )
    chmodSync(wrapper, 0o755)
  }
  symlinkSync(repo, join(dir, 'tooling'))
  write(box.log, '')
  writeState(box, releaseState([]))
  return box
}

/**
 * Runs one `run` step as the runner does (`bash --noprofile --norc -eo pipefail`), with the workflow, job and step
 * `env`, each `${{ }}` expression replaced by its test value, and the fake tools first on the PATH.
 */
function runStep(entry: Job, step: Step, box: Sandbox): StepResult {
  const values: Record<string, string> = {
    'github.token': 'fake-token',
    'github.sha': SHA,
    'inputs.mode': 'rebuild',
    'inputs.ref': REF,
    'inputs.release': RELEASE,
    'inputs.run_id': RUN_ID,
    'inputs.negative_controls': 'false',
    'needs.resolve.outputs.version': VERSION,
    'needs.resolve.outputs.sha': SHA,
    'needs.resolve.outputs.release_id': String(RELEASE_ID),
    'steps.sha.outputs.sha': SHA,
    'steps.version.outputs.version': VERSION,
    'steps.release.outputs.release_id': String(RELEASE_ID),
    'steps.manifest.outputs.version': VERSION,
    'steps.manifest.outputs.sha': SHA,
    'steps.manifest.outputs.release_id': String(RELEASE_ID),
    'runner.temp': box.temp,
    'env.NODE_VERSION': '22.x',
  }
  const evaluate = (value: unknown): string =>
    String(value).replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_match, expression: string) => {
      const replacement = values[expression]
      if (replacement === undefined) throw new Error(`no test value for the expression ${expression}`)
      return replacement
    })
  const declared = { ...record(workflow().doc.env), ...record(entry.body.env), ...record(step.env) }
  const script = join(box.dir, 'step.sh')
  write(script, evaluate(str(step.run)))
  const ran = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd: join(box.dir, str(step['working-directory'])),
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: [box.bin, dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
      HOME: box.dir,
      LANG: 'C',
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_WORKSPACE: box.dir,
      GITHUB_OUTPUT: join(box.dir, 'output.txt'),
      GITHUB_STEP_SUMMARY: join(box.dir, 'summary.md'),
      RUNNER_TEMP: box.temp,
      FAKE_GITHUB_STATE: box.state,
      FAKE_GITHUB_LOG: box.log,
      ...Object.fromEntries(Object.entries(declared).map(([name, value]) => [name, evaluate(value)])),
    },
  })
  return { status: ran.status ?? -1, output: `${ran.stdout}${ran.stderr}` }
}

describe('rebuild-release.yml: trigger and inputs', () => {
  it('is started only by hand', () => {
    expect(Object.keys(record(workflow().doc.on))).toEqual(['workflow_dispatch'])
  })

  it('takes exactly mode, ref, release, negative_controls and run_id, and no version input', () => {
    expect(Object.keys(inputs()).sort()).toEqual(['mode', 'negative_controls', 'ref', 'release', 'run_id'])
  })

  it('offers the modes rebuild, dry-run, verify and seed-audit, with rebuild by default', () => {
    const mode = inputs().mode

    expect({ type: mode.type, options: list(mode.options).map(String).sort(), default: mode.default }).toEqual({
      type: 'choice',
      options: ['dry-run', 'rebuild', 'seed-audit', 'verify'],
      default: 'rebuild',
    })
  })

  it('keeps the negative controls off by default', () => {
    const controls = inputs().negative_controls

    expect({ type: controls.type, default: controls.default }).toEqual({ type: 'boolean', default: false })
  })

  it('never reads a version from the inputs', () => {
    expect(workflow().raw).not.toMatch(/inputs\.version\b/)
  })
})

describe('rebuild-release.yml: permissions and concurrency', () => {
  it('grants only contents: read at the top level', () => {
    expect(workflow().doc.permissions).toStrictEqual({ contents: 'read' })
  })

  it('runs one rebuild per release at a time, never cancelling a running one', () => {
    expect(workflow().doc.concurrency).toStrictEqual({
      group: 'rebuild-${{ inputs.release }}',
      'cancel-in-progress': false,
    })
  })

  it('grants contents: write to resolve, publish, verify and seed-audit, which read or replace release assets', () => {
    const writers = ['resolve', 'publish', 'verify', 'seed-audit']

    expect(writers.map((id) => contentsPermission(job(id)))).toEqual(writers.map(() => 'write'))
  })

  it('grants contents: write to no build job and not to trust-module', () => {
    const offenders = [...buildJobs(), job('trust-module')]
      .filter((entry) => contentsPermission(entry) === 'write' || text(entry.body.permissions) === '"write-all"')
      .map((entry) => entry.id)

    expect(buildJobs()).toHaveLength(5)
    expect(offenders).toEqual([])
  })

  it('lets seed-audit read the Actions logs and caches', () => {
    expect(record(job('seed-audit').body.permissions).actions).toBe('read')
  })

  it('uses the release-trust environment in trust-module and seed-audit only', () => {
    const environments = Object.fromEntries(
      jobs()
        .filter((entry) => environmentOf(entry) !== undefined)
        .map((entry) => [entry.id, environmentOf(entry)]),
    )

    expect(environments).toStrictEqual({ 'trust-module': 'release-trust', 'seed-audit': 'release-trust' })
  })
})

describe('rebuild-release.yml: the seed secret', () => {
  function secretLocations(): string[] {
    const named = (value: unknown): boolean => SECRET_REFERENCE.test(text(value))
    const { jobs: _jobs, ...top } = workflow().doc
    const locations = named(top) ? ['workflow'] : []
    for (const entry of jobs()) {
      const { steps: _steps, ...rest } = entry.body
      if (named(rest)) locations.push(entry.id)
      entry.steps.forEach((step, index) => {
        if (named(step)) locations.push(`${entry.id}#${index}`)
      })
    }
    return locations
  }

  function secretStep(id: string): Step {
    return job(id).steps.find((step) => SECRET_REFERENCE.test(text(step))) ?? {}
  }

  it('names the secret in exactly one step of trust-module and one step of seed-audit, and nowhere else', () => {
    const locations = secretLocations()

    expect(locations.map((location) => location.replace(/#\d+$/, '#step')).sort()).toEqual([
      'seed-audit#step',
      'trust-module#step',
    ])
  })

  it('gives the secret as OPENPLC_TRUST_SEED_SECRET to the step that generates the trust module', () => {
    const step = secretStep('trust-module')

    expect(record(step.env).OPENPLC_TRUST_SEED_SECRET).toBe('${{ secrets.TRUST_SEED_SECRET }}')
    expect(str(step.run)).toContain('scripts/package-trust/cli.ts generate-release')
  })

  it('gives the secret as OPENPLC_TRUST_SEED_SECRET to the step that runs seed-audit.mjs', () => {
    const step = secretStep('seed-audit')

    expect(record(step.env).OPENPLC_TRUST_SEED_SECRET).toBe('${{ secrets.TRUST_SEED_SECRET }}')
    expect(str(step.run)).toContain('tooling/scripts/release/seed-audit.mjs')
  })
})

describe('rebuild-release.yml: checkouts', () => {
  it('checks out the workflow commit to tooling/ in every job', () => {
    const offenders = jobs()
      .filter(
        (entry) =>
          !entry.steps.some(
            (step) =>
              isCheckout(step, 'tooling') && str(record(step.with).ref).replace(/\s/g, '') === '${{github.sha}}',
          ),
      )
      .map((entry) => entry.id)

    expect(offenders).toEqual([])
  })

  it('runs every release script from tooling/, never from the built tree', () => {
    const values = strings(workflow().doc)
    const offenders = values.filter((value) =>
      [...value.matchAll(/scripts\/release\//g)].some((match) => !value.slice(0, match.index).endsWith('tooling/')),
    )

    expect(values.some((value) => value.includes('tooling/scripts/release/'))).toBe(true)
    expect(offenders).toEqual([])
  })

  it('checks out the built tree at the commit resolve found, in trust-module and in every build job', () => {
    const offenders = [job('trust-module'), ...buildJobs()]
      .filter(
        (entry) =>
          !entry.steps.some(
            (step) => isCheckout(step, 'tree') && str(record(step.with).ref).includes('needs.resolve.outputs.'),
          ),
      )
      .map((entry) => entry.id)

    expect(offenders).toEqual([])
  })
})

describe('rebuild-release.yml: resolve', () => {
  it('checks the version and records the original digests before any build', () => {
    const resolve = job('resolve')

    expect(resolve.steps.some(mentions('tooling/scripts/release/check-version.mjs'))).toBe(true)
    expect(resolve.steps.some(mentions('tooling/scripts/release/release-digests.mjs before'))).toBe(true)
    expect(resolve.steps.some((step) => isUploadArtifact(step) && record(step.with).name === 'rebuild-manifest')).toBe(
      true,
    )
  })

  it('is waited for by trust-module and by every build job', () => {
    const offenders = [job('trust-module'), ...buildJobs()]
      .filter((entry) => !upstream(entry).has('resolve'))
      .map((entry) => entry.id)

    expect(offenders).toEqual([])
  })
})

describe('rebuild-release.yml: trust-module', () => {
  it('uses no cache: no actions/cache step and no setup-node cache', () => {
    const offenders = job('trust-module')
      .steps.filter((step) => uses(step).startsWith('actions/cache') || record(step.with).cache !== undefined)
      .map((step) => str(step.name) || uses(step))

    expect(offenders).toEqual([])
  })

  it('generates the module, then runs the check-site test without the secret, then uploads it', () => {
    const trust = job('trust-module')
    const generate = stepIndex(trust, mentions('scripts/package-trust/cli.ts generate-release'))
    const check = stepIndex(
      trust,
      (step) => text(step).includes('OPENPLC_TRUST_MODULE_UNDER_TEST') && text(step).includes('check-sites.test.ts'),
    )
    const upload = stepIndex(trust, isUploadArtifact)

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

describe('rebuild-release.yml: build jobs', () => {
  it('builds on the five release.yml runners', () => {
    expect(
      buildJobs()
        .map((entry) => str(entry.body['runs-on']))
        .sort(),
    ).toEqual(['macos-latest', 'ubuntu-22.04', 'ubuntu-24.04-arm', 'windows-2022', 'windows-2022'])
  })

  it('runs every build and package step with OPENPLC_RELEASE_BUILD=1', () => {
    const topEnv = record(workflow().doc.env)
    const building = (step: Step): boolean => /npm run (build|package)\b|electron-builder/.test(str(step.run))
    const flagged = (entry: Job, step: Step): boolean =>
      String({ ...topEnv, ...record(entry.body.env), ...record(step.env) }.OPENPLC_RELEASE_BUILD) === '1' ||
      /OPENPLC_RELEASE_BUILD=1\b/.test(str(step.run))

    const withoutBuild = buildJobs()
      .filter((entry) => !entry.steps.some(building))
      .map((entry) => entry.id)
    const offenders = buildJobs().flatMap((entry) =>
      entry.steps
        .filter((step) => building(step) && !flagged(entry, step))
        .map((step) => `${entry.id}: ${str(step.run)}`),
    )

    expect(withoutBuild).toEqual([])
    expect(offenders).toEqual([])
  })

  it('downloads the trust module into tree/release/package-trust/ in every build job', () => {
    const offenders = buildJobs()
      .filter(
        (entry) =>
          !entry.steps.some(
            (step) =>
              uses(step).startsWith('actions/download-artifact') &&
              record(step.with).name === 'trust-module' &&
              str(record(step.with).path).replace(/\/$/, '') === 'tree/release/package-trust',
          ),
      )
      .map((entry) => entry.id)

    expect(offenders).toEqual([])
  })

  it('reads the fuses and scans for trust literals before any upload, in every build job', () => {
    const offenders = buildJobs()
      .filter((entry) => {
        const upload = stepIndex(entry, isUploadArtifact)
        const fuses = stepIndex(entry, mentions('tooling/scripts/release/read-fuses.mjs'))
        const literals = stepIndex(entry, mentions('tooling/scripts/release/scan-trust-literals.mjs'))
        return fuses < 0 || literals < 0 || upload < 0 || fuses > upload || literals > upload
      })
      .map((entry) => entry.id)

    expect(offenders).toEqual([])
  })

  it('fails every installer and digest upload when its files are absent', () => {
    const offenders = buildJobs().flatMap((entry) =>
      entry.steps
        .filter((step) => isUploadArtifact(step) && record(step.with)['if-no-files-found'] !== 'error')
        .map((step) => `${entry.id}: ${str(step.name)}`),
    )

    expect(offenders).toEqual([])
  })

  it('runs the fuse readout over the original installer as a negative control on Windows', () => {
    const controls = buildJobs().filter(
      (entry) =>
        str(entry.body['runs-on']) === 'windows-2022' &&
        entry.steps.some(
          (step) =>
            str(step.if).includes('negative_controls') && text(step).includes('tooling/scripts/release/read-fuses.mjs'),
        ),
    )

    expect(controls).toHaveLength(1)
  })
})

describe('rebuild-release.yml: publish', () => {
  it('runs only in rebuild mode, after every build job', () => {
    const publish = job('publish')

    expect(str(publish.body.if)).toMatch(/inputs\.mode\s*==\s*'rebuild'/)
    expect(buildJobs().filter((entry) => !needsOf(publish).includes(entry.id))).toEqual([])
  })

  it('checks the upload set before any step that changes the release', () => {
    const publish = job('publish')
    const check = lastStepIndex(publish, mentions('tooling/scripts/release/check-upload-set.mjs'))
    const firstChange = stepIndex(publish, isMutation)

    expect(firstChange).toBeGreaterThanOrEqual(0)
    expect(check).toBeGreaterThanOrEqual(0)
    expect(check).toBeLessThan(firstChange)
  })

  it('proves, when the negative controls are on, that a set with latest.yml fails the check, before the real check', () => {
    const publish = job('publish')
    const controls = publish.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => str(step.if).includes('negative_controls'))
    const realCheck = lastStepIndex(publish, mentions('tooling/scripts/release/check-upload-set.mjs'))

    expect(text(controls.map(({ step }) => step))).toContain('latest.yml')
    expect(controls.some(({ step }) => text(step).includes('tooling/scripts/release/check-upload-set.mjs'))).toBe(true)
    expect(controls.every(({ index }) => index < realCheck)).toBe(true)
  })

  it('reads the replaced assets back with release-digests.mjs after, then edits the notes with release-notes.mjs', () => {
    const publish = job('publish')
    const firstChange = stepIndex(publish, isMutation)
    const digests = stepIndex(publish, mentions('tooling/scripts/release/release-digests.mjs after'))
    const notes = stepIndex(publish, mentions('tooling/scripts/release/release-notes.mjs'))

    expect(digests).toBeGreaterThan(firstChange)
    expect(notes).toBeGreaterThan(digests)
  })
})

describe('rebuild-release.yml: verify and seed-audit', () => {
  it.each([
    ['verify', 'verify'],
    ['seed-audit', 'seed-audit'],
  ])('runs %s only in %s mode', (id, mode) => {
    expect(str(job(id).body.if)).toMatch(new RegExp(`inputs\\.mode\\s*==\\s*'${mode}'`))
  })

  it('verify reads the rebuild manifest and checks the release with release-digests.mjs after', () => {
    const verify = job('verify')

    expect(verify.steps.some(mentions('rebuild-manifest'))).toBe(true)
    expect(verify.steps.some(mentions('tooling/scripts/release/release-digests.mjs after'))).toBe(true)
  })
})

describe('rebuild-release.yml: what it never does', () => {
  it.each([
    'gh release create',
    '--clobber',
    'package:test',
    'OPENPLC_TEST_PACKAGE',
    'toJSON(secrets)',
    'secrets: inherit',
  ])('never uses %s', (token) => {
    expect(workflow().raw).not.toContain(token)
  })

  it('finds and replaces assets by release id, never through the tag endpoint or gh release upload', () => {
    const raw = workflow().raw

    expect(
      ['releases/tags/', 'gh release upload', 'gh release delete-asset'].filter((token) => raw.includes(token)),
    ).toEqual([])
  })

  it('passes --allow-prerelease in no step, so every release script keeps the x.y.z version rule', () => {
    const offenders = jobs().flatMap((entry) =>
      entry.steps
        .filter((step) => text(step).includes('--allow-prerelease'))
        .map((step) => `${entry.id}: ${str(step.name)}`),
    )

    expect(offenders).toEqual([])
  })

  it('never uploads update metadata or blockmaps to the release or as an artifact', () => {
    const offenders = jobs().flatMap((entry) =>
      entry.steps
        .filter((step) => isMutation(step) || isUploadArtifact(step))
        .filter((step) => {
          const touched = isUploadArtifact(step) ? text(record(step.with).path) : text(step)
          return /latest|blockmap/i.test(touched)
        })
        .map((step) => `${entry.id}: ${str(step.name)}`),
    )

    expect(offenders).toEqual([])
  })
})

describe('rebuild-release.yml: packaged-checks', () => {
  const FX3U_FIXTURE = 'src/backend/editor/package-trust/__tests__/fixtures/com.openplc.fx3u-compatible-2.1.0.vpp'
  const TRUSTED_KEYS = 'src/backend/shared/utils/vpp/trusted-keys.ts'
  const RUNNER_LABEL = /^(macos|windows|ubuntu)-[\w.]+$/

  function checks(): Job {
    return job('packaged-checks')
  }

  function runsPackagedChecks(step: Step): boolean {
    return str(step.run).includes('node tooling/scripts/release/packaged-checks.mjs')
  }

  function negativeControlGated(step: Step): boolean {
    return str(step.if).includes('negative_controls')
  }

  it('runs on macos-latest, windows-2022 and ubuntu-22.04 through its matrix', () => {
    const entry = checks()
    const runners = strings(record(entry.body.strategy).matrix).filter((value) => RUNNER_LABEL.test(value))

    expect(str(entry.body['runs-on'])).toContain('matrix.')
    expect([...new Set(runners)].sort()).toEqual(['macos-latest', 'ubuntu-22.04', 'windows-2022'])
  })

  it('tests the Apple silicon DMG, the x64 Windows installer and the x64 AppImage, never an ARM64 installer', () => {
    const raw = text(checks().body)

    expect(['-ARM.dmg', '.exe', '.AppImage'].filter((suffix) => !raw.includes(suffix))).toEqual([])
    expect(raw).not.toContain('ARM64')
  })

  it('downloads the installers the macOS, Windows x64 and Linux x64 build jobs uploaded', () => {
    const entry = checks()
    const raw = text(entry.body)

    expect(entry.steps.some((step) => uses(step).startsWith('actions/download-artifact'))).toBe(true)
    expect(
      ['installers-macos', 'installers-windows-x64', 'installers-linux-x64'].filter((name) => !raw.includes(name)),
    ).toEqual([])
  })

  it('waits for resolve and for the macOS, Windows x64 and Linux x64 build jobs', () => {
    const needs = needsOf(checks())

    expect(
      ['resolve', 'build-macos', 'build-windows-x64', 'build-linux-x64'].filter((id) => !needs.includes(id)),
    ).toEqual([])
  })

  it('is waited for by publish', () => {
    expect(needsOf(job('publish'))).toContain('packaged-checks')
  })

  it('runs with contents: read only, by its own permissions or the top-level ones', () => {
    const own = checks().body.permissions

    expect(own === undefined ? workflow().doc.permissions : own).toStrictEqual({ contents: 'read' })
  })

  it('names no secret and no token', () => {
    const raw = text(checks().body)

    expect(raw).not.toMatch(/secrets\s*[.[]/)
    expect(raw).not.toMatch(/github\.token|GITHUB_TOKEN|GH_TOKEN/)
  })

  it('installs no dependency: no npm ci, npm install, yarn or pnpm', () => {
    const offenders = checks()
      .steps.filter((step) => /\bnpm (ci|install|i)\b|\byarn\b|\bpnpm\b/.test(str(step.run)))
      .map((step) => str(step.name) || str(step.run))

    expect(offenders).toEqual([])
  })

  it('checks out from the built tree only the fx3u fixture and trusted-keys.ts, at the commit resolve found', () => {
    const treeCheckouts = checks().steps.filter((step) => isCheckout(step, 'tree'))
    const options = record(treeCheckouts[0]?.with)
    const files = str(options['sparse-checkout'])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .sort()

    expect(treeCheckouts).toHaveLength(1)
    expect({
      ref: str(options.ref).replace(/\s/g, ''),
      files,
      coneMode: options['sparse-checkout-cone-mode'],
    }).toEqual({ ref: '${{needs.resolve.outputs.sha}}', files: [FX3U_FIXTURE, TRUSTED_KEYS].sort(), coneMode: false })
  })

  it('reads no other file of the built tree', () => {
    const allowed = new Set([FX3U_FIXTURE, TRUSTED_KEYS])
    const offenders = strings(checks().body)
      .flatMap((value) => [...value.matchAll(/(?<![\w./-])tree\/([^\s"'`]+)/g)].map((match) => match[1]))
      .filter((path) => !allowed.has(path))

    expect(offenders).toEqual([])
  })

  it("runs packaged-checks.mjs on the run's installer with the fx3u positive control, the trusted keys and a report", () => {
    const entry = checks()
    const own = entry.steps.filter((step) => runsPackagedChecks(step) && !str(step.run).includes('--negative-control'))
    const options = ['--platform', '--installer', '--version', '--positive-control', '--trusted-keys', '--report']

    expect(own.length).toBeGreaterThanOrEqual(1)
    expect(own.flatMap((step) => options.filter((option) => !str(step.run).includes(option)))).toEqual([])
    expect(own.filter(negativeControlGated)).toEqual([])
    expect([`tree/${FX3U_FIXTURE}`, `tree/${TRUSTED_KEYS}`].filter((path) => !text(entry.body).includes(path))).toEqual(
      [],
    )
  })

  it('runs the checks under xvfb-run on Linux', () => {
    expect(checks().steps.some((step) => runsPackagedChecks(step) && str(step.run).includes('xvfb-run'))).toBe(true)
  })

  it('runs packaged-checks.mjs --negative-control on the published installer when the negative controls are on', () => {
    const controls = checks().steps.filter(negativeControlGated)

    expect(controls.some((step) => runsPackagedChecks(step) && str(step.run).includes('--negative-control'))).toBe(true)
    expect(
      controls.some((step) =>
        text(step).includes('https://github.com/Autonomy-Logic/openplc-editor/releases/download/v'),
      ),
    ).toBe(true)
  })

  it('runs --negative-control and downloads a published installer only when the negative controls are on', () => {
    const offenders = checks()
      .steps.filter((step) => text(step).includes('--negative-control') || text(step).includes('releases/download/'))
      .filter((step) => !negativeControlGated(step))
      .map((step) => str(step.name))

    expect(offenders).toEqual([])
  })

  it('downloads the original installer by the version resolve read, never by the release input', () => {
    const downloads = checks().steps.filter((step) => text(step).includes('releases/download/'))

    expect(downloads.length).toBeGreaterThanOrEqual(1)
    expect(downloads.filter((step) => text(step).includes('inputs.release')).map((step) => str(step.name))).toEqual([])
  })

  it('uploads the reports', () => {
    expect(checks().steps.some(isUploadArtifact)).toBe(true)
  })
})

describe('rebuild-release.yml: the branch to build', () => {
  const CHECK_REF = 'tooling/scripts/release/check-ref.mjs'

  function touchesTree(step: Step): boolean {
    return isCheckout(step, 'tree') || /\bgit\b[^\n]*\b(fetch|checkout|clone)\b/.test(str(step.run))
  }

  it('names the ref, the release and the mode in the run name', () => {
    const name = str(workflow().doc['run-name'])
    const named = (input: string): boolean => new RegExp(`\\$\\{\\{\\s*inputs\\.${input}\\s*\\}\\}`).test(name)

    expect(['ref', 'release', 'mode'].filter((input) => !named(input))).toEqual([])
  })

  it('runs check-ref.mjs in resolve after checking out tooling/ and before any fetch or checkout of tree/', () => {
    const resolve = job('resolve')
    const tooling = stepIndex(resolve, (step) => isCheckout(step, 'tooling'))
    const check = stepIndex(resolve, mentions(CHECK_REF))
    const tree = stepIndex(resolve, touchesTree)

    expect(tooling).toBeGreaterThanOrEqual(0)
    expect(check).toBeGreaterThan(tooling)
    expect(tree).toBeGreaterThan(check)
  })

  it('gives check-ref.mjs the ref and the release through env only, never through ${{ }} in its script', () => {
    const step = job('resolve').steps.find(mentions(CHECK_REF)) ?? {}
    const env = Object.values(record(step.env)).map(str)
    const script = str(step.run)

    expect({
      ref: env.some((value) => /\$\{\{\s*inputs\.ref\s*\}\}/.test(value)),
      release: env.some((value) => /\$\{\{\s*inputs\.release\s*\}\}/.test(value)),
      options: ['--ref', '--release'].every((option) => script.includes(option)),
      inlineExpression: script.includes('${{'),
    }).toEqual({ ref: true, release: true, options: true, inlineExpression: false })
  })

  it('writes the ref and the resolved commit to the step summary of resolve', () => {
    const box = sandbox()
    const resolve = job('resolve')
    const summarySteps = resolve.steps.filter((step) => str(step.run).includes('GITHUB_STEP_SUMMARY'))
    const failed = summarySteps.map((step) => runStep(resolve, step, box)).filter((result) => result.status !== 0)

    expect(summarySteps.length).toBeGreaterThanOrEqual(1)
    expect(failed).toEqual([])
    expect([REF, SHA].filter((value) => !readFileSync(join(box.dir, 'summary.md'), 'utf8').includes(value))).toEqual([])
  })
})

describe('rebuild-release.yml: STruC++ in trust-module', () => {
  /** The step index of the first step of @p entry whose script holds @p fragment, and the fragment's offset in it. */
  function position(entry: Job, fragment: string): [number, number] {
    const index = stepIndex(entry, (step) => str(step.run).includes(fragment))
    return [index, index < 0 ? -1 : str(entry.steps[index].run).indexOf(fragment)]
  }

  function precedes(a: [number, number], b: [number, number]): boolean {
    return a[0] >= 0 && (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  }

  it('runs npm run setup:strucpp in tree/ after npm ci --ignore-scripts and before the check-site Jest run', () => {
    const trust = job('trust-module')
    const install = position(trust, 'npm ci --ignore-scripts')
    const strucpp = position(trust, 'npm run setup:strucpp')
    const jest = position(trust, 'check-sites.test.ts')

    expect(strucpp[0]).toBeGreaterThanOrEqual(0)
    expect(str(trust.steps[strucpp[0]]?.['working-directory'])).toBe('tree')
    expect([precedes(install, strucpp), precedes(strucpp, jest)]).toEqual([true, true])
  })
})

describe('rebuild-release.yml: publish uploads each installer before deleting the one it replaces', () => {
  const STALE = 'OpenPLC.Editor_4.3.5.exe.uploading'
  const STALE_ID = 106

  function replaceStep(): Step {
    return job('publish').steps.find((step) => str(step.run).includes('uploads.github.com')) ?? {}
  }

  /** A sandbox with the six rebuilt installers in upload/ and a release holding the six originals and a stale upload. */
  function replacing(failUpload?: string): Sandbox {
    const box = sandbox()
    for (const name of NAMES) write(join(box.dir, 'upload', name), rebuilt(name))
    const originals = NAMES.map((name, index) => ({ id: 100 + index, name, sha: ORIGINAL[name] }))
    writeState(box, {
      ...releaseState([...originals, { id: STALE_ID, name: STALE, sha: sha256('a partial upload') }]),
      failUpload,
    })
    return box
  }

  it('leaves exactly the six installers, each holding its rebuilt file, and no .uploading asset', () => {
    const box = replacing()
    const result = runStep(job('publish'), replaceStep(), box)
    const assets = readState(box).assets

    expect(result.status).toBe(0)
    expect(assets.map((asset) => asset.name).sort()).toEqual([...NAMES].sort())
    expect(assets.filter((asset) => asset.sha !== BUILT[asset.name]).map((asset) => asset.name)).toEqual([])
  })

  it('uploads each installer as <name>.uploading, then deletes its old asset, then renames the upload to <name>', () => {
    const box = replacing()
    runStep(job('publish'), replaceStep(), box)
    const calls = readCalls(box)
    const at = (predicate: (call: Call) => boolean): number => calls.findIndex(predicate)

    const offenders = NAMES.filter((name, index) => {
      const upload = at((call) => call.op === 'upload' && call.name === `${name}.uploading`)
      const remove = at((call) => call.op === 'delete' && call.id === 100 + index)
      const rename = at((call) => call.op === 'rename' && call.to === name)
      return upload < 0 || !(upload < remove && remove < rename)
    })

    expect(offenders).toEqual([])
    expect(calls.filter((call) => call.op === 'upload' && NAMES.includes(str(call.name)))).toEqual([])
  })

  it('deletes a stale .uploading asset left by an earlier attempt before uploading that installer', () => {
    const box = replacing()
    runStep(job('publish'), replaceStep(), box)
    const calls = readCalls(box)
    const removed = calls.findIndex((call) => call.op === 'delete' && call.id === STALE_ID)
    const uploaded = calls.findIndex((call) => call.op === 'upload' && call.name === STALE)

    expect(removed).toBeGreaterThanOrEqual(0)
    expect(uploaded).toBeGreaterThan(removed)
  })

  it.each(['OpenPLC.Editor-4.3.5-ARM64.AppImage', 'OpenPLC_Editor_4.3.5.dmg'])(
    'fails and keeps the original %s in the release when its upload fails',
    (name) => {
      const box = replacing(`${name}.uploading`)
      const result = runStep(job('publish'), replaceStep(), box)
      const assets = readState(box).assets

      expect(result.status).not.toBe(0)
      expect(readCalls(box).some((call) => call.op === 'upload-failed')).toBe(true)
      expect(assets.find((asset) => asset.name === name)?.sha).toBe(ORIGINAL[name])
      expect(NAMES.filter((entry) => !assets.some((asset) => asset.name === entry))).toEqual([])
    },
  )
})

describe.each(['publish', 'verify'])('rebuild-release.yml: %s reads the digests back', (id) => {
  const PENDING = 'OpenPLC_Editor_4.3.5-ARM.dmg'

  function readBackStep(): Step {
    return job(id).steps.find(mentions('tooling/scripts/release/release-digests.mjs after')) ?? {}
  }

  function rebuiltAssets(): FakeAsset[] {
    return NAMES.map((name, index) => ({ id: 500 + index, name, sha: BUILT[name], pending: name === PENDING }))
  }

  /** A sandbox with the run's manifest and digests and a release holding @p assets. */
  function readingBack(assets: FakeAsset[], pendingReads: number): Sandbox {
    const box = sandbox()
    const manifest = { release: RELEASE, release_id: String(RELEASE_ID), version: VERSION, sha: SHA }
    writeJson(join(box.dir, 'manifest', 'manifest.json'), manifest)
    writeJson(join(box.dir, 'manifest', 'original.json'), ORIGINAL)
    writeJson(join(box.dir, 'digests', 'built-all.json'), BUILT)
    writeJson(join(box.dir, 'built.json'), BUILT)
    writeState(box, { ...releaseState(assets), pendingReads })
    return box
  }

  function attempts(box: Sandbox): { reads: number; sleeps: string[] } {
    const sleeps = readCalls(box)
      .filter((call) => call.op === 'sleep')
      .map((call) => list(call.args).map(String).join(' '))
    return { reads: readState(box).reads, sleeps }
  }

  it('re-reads the release while a digest is pending, 10 s apart, and passes once GitHub fills it', () => {
    const box = readingBack(rebuiltAssets(), 2)
    const result = runStep(job(id), readBackStep(), box)

    expect(result.status).toBe(0)
    expect(attempts(box)).toEqual({ reads: 3, sleeps: ['10', '10'] })
  })

  it('stops after 6 attempts, 10 s apart, and fails naming the asset still without a digest', () => {
    const box = readingBack(rebuiltAssets(), 1000)
    const result = runStep(job(id), readBackStep(), box)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain(PENDING)
    expect(attempts(box)).toEqual({ reads: 6, sleeps: ['10', '10', '10', '10', '10'] })
  })

  it('never retries a failure other than a pending digest', () => {
    const missing = 'OpenPLC.Editor_4.3.5-ARM64.exe'
    const box = readingBack(
      rebuiltAssets().filter((asset) => asset.name !== missing),
      1000,
    )
    const result = runStep(job(id), readBackStep(), box)

    expect(result.status).not.toBe(0)
    expect(attempts(box)).toEqual({ reads: 1, sleeps: [] })
  })
})

describe('rebuild-release.yml: seed-audit and the trust-module artifact', () => {
  const MANIFEST: FakeArtifact = { id: 1, name: 'rebuild-manifest', expired: false }

  function searchIndex(): number {
    return stepIndex(job('seed-audit'), mentions('tooling/scripts/release/seed-audit.mjs'))
  }

  /** The first `run` step of seed-audit that names the trust-module artifact; it must come before the search. */
  function artifactCheck(): Step {
    const audit = job('seed-audit')
    const index = stepIndex(audit, (step) => str(step.run).includes('trust-module'))
    if (index < 0 || index > searchIndex()) {
      throw new Error('seed-audit checks no trust-module artifact before the search')
    }
    return audit.steps[index]
  }

  function checking(artifacts: FakeArtifact[]): StepResult {
    const box = sandbox()
    writeState(box, { ...releaseState([]), artifacts })
    return runStep(job('seed-audit'), artifactCheck(), box)
  }

  it('downloads the trust-module artifact of run_id by name before the search', () => {
    const audit = job('seed-audit')
    const download = stepIndex(
      audit,
      (step) =>
        uses(step).startsWith('actions/download-artifact') &&
        record(step.with).name === 'trust-module' &&
        /\$\{\{\s*inputs\.run_id\s*\}\}/.test(str(record(step.with)['run-id'])),
    )

    expect(download).toBeGreaterThanOrEqual(0)
    expect(download).toBeLessThan(searchIndex())
    expect(audit.steps[download]?.['continue-on-error']).toBeUndefined()
  })

  it.each([
    ['missing', [MANIFEST]],
    ['expired', [MANIFEST, { id: 2, name: 'trust-module', expired: true }]],
  ])(
    'fails when the trust-module artifact is %s, naming it, the run id and the one-day retention',
    (_state, artifacts) => {
      const result = checking(artifacts)

      expect(result.status).not.toBe(0)
      expect({
        artifact: result.output.includes('trust-module'),
        run: result.output.includes(RUN_ID),
        retention: /\b(one|1)[ -]day\b/i.test(result.output),
      }).toEqual({ artifact: true, run: true, retention: true })
    },
  )

  it('passes when the trust-module artifact of the run has not expired', () => {
    const result = checking([MANIFEST, { id: 2, name: 'trust-module', expired: false }])

    expect(result.status).toBe(0)
  })
})

describe('rebuild-release.yml: cross-seed', () => {
  const CHECK = 'npx ts-node --transpile-only scripts/package-trust/cli.ts cross-seed-check'
  const MODES = ['rebuild', 'dry-run', 'verify', 'seed-audit']

  function crossSeed(): Job {
    return job('cross-seed')
  }

  /** The modes an `if:` names in `inputs.mode == '<mode>'` comparisons; every mode when there is no `if:`. */
  function namedModes(condition: unknown): string[] {
    const source = str(condition)
    if (source === '') return MODES
    return MODES.filter((mode) => new RegExp(`inputs\\.mode\\s*==\\s*'${mode}'`).test(source))
  }

  /** The step index of the first step of @p entry whose script holds @p fragment, and the fragment's offset in it. */
  function position(entry: Job, fragment: string): [number, number] {
    const index = stepIndex(entry, (step) => str(step.run).includes(fragment))
    return [index, index < 0 ? -1 : str(entry.steps[index].run).indexOf(fragment)]
  }

  function precedes(a: [number, number], b: [number, number]): boolean {
    return a[0] >= 0 && (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  }

  /** The directory a step runs in: its working-directory, or the one its script changes to first. */
  function directoryOf(step: Step): string {
    const changed = /^\s*cd\s+(\S+?)\/?\s*(&&|\n|$)/.exec(str(step.run))
    return str(step['working-directory']).replace(/\/$/, '') || (changed ? changed[1] : '')
  }

  it('waits for resolve only', () => {
    expect(needsOf(crossSeed())).toEqual(['resolve'])
  })

  it('runs in the rebuild and dry-run modes only, as resolve does, and only when resolve succeeded', () => {
    const own = str(crossSeed().body.if)
    const modes = namedModes(job('resolve').body.if).filter((mode) => namedModes(own).includes(mode))

    expect(modes.sort()).toEqual(['dry-run', 'rebuild'])
    expect(own).not.toMatch(/\b(always|cancelled|failure)\s*\(/)
  })

  it('is waited for by publish', () => {
    expect(needsOf(job('publish'))).toContain('cross-seed')
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

  it('checks out tooling/ at the workflow commit and tree/ at the commit resolve found, keeping no credentials', () => {
    const checkouts = crossSeed().steps.filter((step) => uses(step).startsWith('actions/checkout'))
    const refOf = (path: string): string =>
      str(record(checkouts.find((step) => isCheckout(step, path))?.with).ref).replace(/\s/g, '')

    expect({ tooling: refOf('tooling'), tree: refOf('tree') }).toEqual({
      tooling: '${{github.sha}}',
      tree: '${{needs.resolve.outputs.sha}}',
    })
    expect(checkouts.map((step) => record(step.with)['persist-credentials'])).toEqual(checkouts.map(() => false))
  })

  it('sets up Node 22', () => {
    const setup = crossSeed().steps.find((step) => uses(step).startsWith('actions/setup-node'))
    const version = str(record(setup?.with)['node-version'])
    const resolved = /^\$\{\{\s*env\.NODE_VERSION\s*\}\}$/.test(version)
      ? str(record(workflow().doc.env).NODE_VERSION)
      : version

    expect(resolved).toMatch(/^22(\.|$)/)
  })

  it('runs npm ci --ignore-scripts, then npm run setup:strucpp, then cli.ts cross-seed-check, each in tree/', () => {
    const entry = crossSeed()
    const install = position(entry, 'npm ci --ignore-scripts')
    const strucpp = position(entry, 'npm run setup:strucpp')
    const check = position(entry, CHECK)
    const directories = [install, strucpp, check].map(([index]) => directoryOf(entry.steps[index] ?? {}))

    expect([precedes(install, strucpp), precedes(strucpp, check)]).toEqual([true, true])
    expect(directories).toEqual(['tree', 'tree', 'tree'])
  })

  it("runs the built tree's own cli.ts, never the one in tooling/", () => {
    const offenders = crossSeed()
      .steps.filter((step) => str(step.run).includes('cross-seed-check') && str(step.run).includes('tooling/'))
      .map((step) => str(step.name))

    expect(offenders).toEqual([])
  })

  it('installs its dependencies with npm ci --ignore-scripts only', () => {
    const installs = crossSeed().steps.filter((step) => /\bnpm (ci|install|i)\b|\byarn\b|\bpnpm\b/.test(str(step.run)))

    expect(installs.length).toBeGreaterThanOrEqual(1)
    expect(installs.filter((step) => !str(step.run).includes('npm ci --ignore-scripts'))).toEqual([])
  })

  it('changes nothing in the release and uploads nothing', () => {
    const offenders = crossSeed()
      .steps.filter((step) => isMutation(step) || isUploadArtifact(step))
      .map((step) => str(step.name))

    expect(offenders).toEqual([])
  })
})
