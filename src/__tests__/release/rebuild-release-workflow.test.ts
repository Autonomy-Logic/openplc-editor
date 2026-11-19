/**
 * The structure of `.github/workflows/rebuild-release.yml`, read with the `yaml` package: its inputs, permissions,
 * environments, where the seed secret is visible, the order of the checks around the asset replacement, and the job
 * that runs the abuse checks on the installed builds.
 * @jest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from '@jest/globals'
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

  it('runs on macos-14, windows-2022 and ubuntu-22.04 through its matrix', () => {
    const entry = checks()
    const runners = strings(record(entry.body.strategy).matrix).filter((value) => RUNNER_LABEL.test(value))

    expect(str(entry.body['runs-on'])).toContain('matrix.')
    expect([...new Set(runners)].sort()).toEqual(['macos-14', 'ubuntu-22.04', 'windows-2022'])
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
