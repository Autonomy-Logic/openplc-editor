/**
 * Builds the LD re-layout regression corpus through the editor's UI: three projects, several LD programs each, rungs
 * built the way users build them, saved by the editor and copied to
 * `src/backend/shared/transpilers/st-transpiler/__tests__/fixtures/ld-relayout-corpus/<project>/project/`.
 *
 * Test tooling, not an acceptance test, and not a `debug-*` spec: it runs only when invoked by name, once, against a
 * production build of the starting code (see "Electron e2e" in CLAUDE.md and the corpus README). It refuses to run
 * when a target project folder already exists: the corpus is never regenerated.
 *
 * One `describe.serial` per project; `--grep <project>/` builds one project. `LD_CORPUS_NEGATIVE_CONTROL=1` runs only
 * the negative control: a drop on a marker that does not exist must fail within seconds, quoting the markers shown.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { type EditorSession, freshDirectory, freshProfile } from './helpers/editor-session'
import { shutdown } from './helpers/electron-editor'
import {
  addLdProgram,
  type CoilModifier,
  type ContactModifier,
  copySavedProject,
  createProject,
  deletePou,
  type DropStep,
  LadderBuilder,
  launchOn,
  type Marker,
  openPou,
  openRecentProject,
  type PinStep,
  type PouScript,
  pouFileHolds,
  type Ref,
  type RungScript,
  saveAndWait,
  type Step,
} from './helpers/ladder-builder'

const CORPUS = join(
  __dirname,
  '..',
  'src',
  'backend',
  'shared',
  'transpilers',
  'st-transpiler',
  '__tests__',
  'fixtures',
  'ld-relayout-corpus',
)

type ProjectName = 'ld-corpus-basic' | 'ld-corpus-hard' | 'ld-corpus-imported'

/** The corpus coverage table: scenario, name, project, POU and the 1-based rungs it covers. */
const SCENARIOS: readonly [string, string, ProjectName, string, readonly number[]][] = [
  ['B01', 'series-contacts-coil', 'ld-corpus-basic', 'Main', [1]],
  ['B02', 'nested-parallel-branches', 'ld-corpus-basic', 'Main', [2]],
  ['B06', 'parallel-coils-trailing', 'ld-corpus-basic', 'Main', [3]],
  ['B07', 'set-reset-edge-coils', 'ld-corpus-basic', 'Main', [4]],
  ['B11', 'long-names', 'ld-corpus-basic', 'Main', [5]],
  ['B03', 'block-en-eno-outputs', 'ld-corpus-basic', 'Blocks', [1]],
  ['B04', 'ctud-handle-branches', 'ld-corpus-basic', 'Blocks', [2]],
  ['B05', 'in-out-pins', 'ld-corpus-basic', 'Blocks', [3]],
  ['B08', 'block-then-coil-same-band', 'ld-corpus-basic', 'Blocks', [4]],
  ['B09', 'pin-variable-row0-vs-coil', 'ld-corpus-basic', 'Blocks', [5]],
  ['B10', 'multi-rung-boundary-sinks', 'ld-corpus-basic', 'Aux', [1, 2, 3, 4]],
  ['H01', 'ctu-cu-r-separate-networks', 'ld-corpus-hard', 'Counters', [1]],
  ['H02', 'ctud-four-input-networks', 'ld-corpus-hard', 'Counters', [2]],
  ['H03', 'sr-rs-separate-networks', 'ld-corpus-hard', 'Counters', [3, 4]],
  ['H04', 'ton-deep-nested-pin-network', 'ld-corpus-hard', 'Counters', [5]],
  ['H05', 'two-blocks-parallel-branches', 'ld-corpus-hard', 'Parallel', [1]],
  ['H06', 'three-blocks-parallel-branches', 'ld-corpus-hard', 'Parallel', [2]],
  ['H09', 'blocks-feed-across-parallel', 'ld-corpus-hard', 'Parallel', [3]],
  ['H07', 'block-feeds-block', 'ld-corpus-hard', 'Chains', [1]],
  ['H08', 'block-chain-three', 'ld-corpus-hard', 'Chains', [2]],
  ['H10', 'multi-pou-hard-mix', 'ld-corpus-hard', 'Mixed', [1, 2, 3]],
]

/** A rung's comment: each scenario covering it as `<ID> <name>`, joined with `; ` (as the corpus test expects). */
function comment(project: ProjectName, pou: string, rung: number): string {
  return SCENARIOS.filter(([, , p, q, rungs]) => p === project && q === pou && rungs.includes(rung))
    .map(([id, name]) => `${id} ${name}`)
    .join('; ')
}

const SFB = 'Standard Function Blocks'
const SF = 'Standard Functions'
const OSCAT = 'OSCAT Basic'

const rail: Marker = { rail: 'left' }
const right = (ref: Ref): Marker => ({ right: ref })
const left = (ref: Ref): Marker => ({ left: ref })
const below = (ref: Ref): Marker => ({ below: ref })
const handle = (ref: Ref, pin: string): Marker => ({ handle: ref, pin })
const contact = (as: Ref, at: Marker, name: string, modifier?: ContactModifier): DropStep => ({
  drop: 'contact',
  at,
  as,
  name,
  ...(modifier === undefined ? {} : { modifier }),
})
const coil = (as: Ref, at: Marker, name: string, modifier?: CoilModifier): DropStep => ({
  drop: 'coil',
  at,
  as,
  name,
  ...(modifier === undefined ? {} : { modifier }),
})
const block = (as: Ref, type: string, at: Marker, library = SFB): DropStep => ({
  drop: { block: type, library },
  at,
  as,
})
const pin = (of: Ref, name: string, value: string): PinStep => ({ pin: name, of, value })
const enEno = (ref: Ref): Step => ({ executionControl: ref })

/** Rungs of a POU with their comments, from the coverage table. */
function rungs(project: ProjectName, pou: string, steps: readonly (readonly Step[])[]): RungScript[] {
  return steps.map((each, index) => ({ comment: comment(project, pou, index + 1), steps: each }))
}

const BASIC: readonly PouScript[] = [
  {
    name: 'Main',
    rungs: rungs('ld-corpus-basic', 'Main', [
      [
        contact('a', rail, 'b01_start'),
        coil('y', right('a'), 'b01_motor'),
        contact('b', right('a'), 'b01_permit'),
        contact('c', right('b'), 'b01_guard'),
      ],
      [
        contact('a', rail, 'b02_a'),
        coil('y', right('a'), 'b02_out'),
        contact('b', below('a'), 'b02_b'),
        contact('c', below('b'), 'b02_c'),
        contact('e', right('c'), 'b02_e'),
      ],
      [
        contact('a', rail, 'b06_run'),
        coil('k1', right('a'), 'b06_lamp1'),
        coil('k2', below('k1'), 'b06_lamp2'),
        coil('k3', below('k2'), 'b06_lamp3'),
      ],
      [
        contact('a', rail, 'b07_cmd'),
        coil('s', right('a'), 'b07_latch', 'set'),
        coil('r', below('s'), 'b07_unlatch', 'reset'),
        coil('p', below('r'), 'b07_rise', 'rising edge'),
        coil('n', below('p'), 'b07_fall', 'falling edge'),
      ],
      [
        contact('a', rail, 'b11_conveyor_section_one_upstream_permissive_signal'),
        block('t', 'TON', right('a')),
        coil('y', right('t'), 'b11_conveyor_section_one_downstream_motor_run_command'),
        pin('t', 'PT', 'b11_conveyor_section_one_start_delay_preset_time_value'),
        pin('t', 'ET', 'b11_conveyor_section_one_start_delay_elapsed_time_value'),
      ],
    ]),
  },
  {
    name: 'Blocks',
    rungs: rungs('ld-corpus-basic', 'Blocks', [
      [
        contact('a', rail, 'b03_enable'),
        block('t', 'TON', right('a')),
        enEno('t'),
        coil('y', right('t'), 'b03_done'),
        pin('t', 'IN', 'b03_start'),
        pin('t', 'PT', 'T#2s'),
        pin('t', 'Q', 'b03_q'),
        pin('t', 'ET', 'b03_et'),
      ],
      [
        contact('a', rail, 'b04_up'),
        block('c', 'CTUD', right('a')),
        coil('y', right('c'), 'b04_at_max'),
        contact('d', handle('c', 'CD'), 'b04_down'),
        contact('r', handle('c', 'R'), 'b04_reset'),
        contact('l', handle('c', 'LD'), 'b04_load'),
        pin('c', 'PV', '20'),
        pin('c', 'QD', 'b04_at_min'),
        pin('c', 'CV', 'b04_count'),
      ],
      [
        contact('a', rail, 'b05_run'),
        block('o', 'ONTIME', right('a'), OSCAT),
        coil('y', right('o'), 'b05_eno'),
        pin('o', 'IN', 'b05_in'),
        pin('o', 'RST', 'b05_rst'),
        pin('o', 'SECONDS', 'b05_seconds'),
        pin('o', 'CYCLES', 'b05_cycles'),
      ],
      [
        contact('a', rail, 'b08_go'),
        block('t', 'TON', right('a')),
        coil('y', right('t'), 'b08_q'),
        pin('t', 'PT', 'T#500ms'),
        pin('t', 'ET', 'b08_et'),
      ],
      [
        contact('a', rail, 'b09_go'),
        block('t', 'TON', right('a')),
        enEno('t'),
        coil('y', right('t'), 'b09_eno'),
        pin('t', 'IN', 'b09_in'),
        pin('t', 'PT', 'T#1s'),
        pin('t', 'Q', 'b09_q'),
        pin('t', 'ET', 'b09_et'),
      ],
    ]),
  },
  {
    name: 'Aux',
    rungs: rungs('ld-corpus-basic', 'Aux', [
      [
        contact('a', rail, 'aux_a'),
        block('t', 'TON', right('a')),
        coil('x1', right('t'), 'aux_x1'),
        coil('x2', below('x1'), 'aux_x2'),
        coil('x3', below('x2'), 'aux_x3'),
        pin('t', 'PT', 'T#1s'),
        pin('t', 'ET', 'aux_et1'),
      ],
      [
        contact('b', rail, 'aux_b'),
        block('c', 'CTU', right('b')),
        coil('y1', right('c'), 'aux_y1'),
        pin('c', 'R', 'aux_r2'),
        pin('c', 'PV', '3'),
        pin('c', 'CV', 'aux_cv2'),
      ],
      [
        contact('c', rail, 'aux_c'),
        block('t', 'TOF', right('c')),
        coil('z1', right('t'), 'aux_z1'),
        coil('z2', below('z1'), 'aux_z2'),
        contact('d', below('c'), 'aux_d'),
        pin('t', 'PT', 'T#2s'),
      ],
      [contact('e', rail, 'aux_e'), coil('w1', right('e'), 'aux_w1')],
    ]),
  },
]

const HARD: readonly PouScript[] = [
  {
    name: 'Counters',
    rungs: rungs('ld-corpus-hard', 'Counters', [
      [
        contact('a', rail, 'h01_a'),
        block('c', 'CTU', right('a')),
        coil('q', right('c'), 'h01_q'),
        contact('b', right('a'), 'h01_b'),
        contact('rc', handle('c', 'R'), 'h01_c'),
        contact('rd', below('rc'), 'h01_d'),
        pin('c', 'PV', '10'),
        pin('c', 'CV', 'h01_cv'),
      ],
      [
        contact('a', rail, 'h02_a'),
        block('c', 'CTUD', right('a')),
        coil('qu', right('c'), 'h02_qu'),
        contact('b', right('a'), 'h02_b'),
        contact('cc', below('b'), 'h02_c'),
        contact('d', right('cc'), 'h02_d'),
        contact('e', handle('c', 'CD'), 'h02_e'),
        contact('g', right('e'), 'h02_g'),
        contact('f', below('e'), 'h02_f'),
        contact('h', handle('c', 'R'), 'h02_h'),
        contact('i', handle('c', 'LD'), 'h02_i'),
        contact('k', below('i'), 'h02_k'),
        contact('j', right('i'), 'h02_j'),
        pin('c', 'PV', '30'),
        pin('c', 'QD', 'h02_qd'),
        pin('c', 'CV', 'h02_cv'),
      ],
      [
        contact('a', rail, 'h03_a'),
        block('sr', 'SR', right('a')),
        coil('q1', right('sr'), 'h03_q1'),
        contact('c', right('a'), 'h03_c'),
        contact('b', below('a'), 'h03_b'),
        contact('d', handle('sr', 'R'), 'h03_d'),
      ],
      [
        contact('e', rail, 'h03_e'),
        block('rs', 'RS', right('e')),
        coil('q1', right('rs'), 'h03_q2'),
        contact('f', handle('rs', 'R1'), 'h03_f'),
        contact('h', below('f'), 'h03_h'),
        contact('g', right('f'), 'h03_g'),
      ],
      [
        contact('e', rail, 'h04_e'),
        block('t', 'TON', right('e')),
        coil('q', right('t'), 'h04_q'),
        contact('a', below('e'), 'h04_a'),
        contact('b', right('a'), 'h04_b'),
        contact('cc', below('b'), 'h04_c'),
        contact('d', right('cc'), 'h04_d'),
        pin('t', 'PT', 'T#3s'),
        pin('t', 'ET', 'h04_et'),
      ],
    ]),
  },
  {
    name: 'Parallel',
    rungs: rungs('ld-corpus-hard', 'Parallel', [
      [
        block('t', 'TON', rail),
        coil('y', right('t'), 'h05_out'),
        block('c', 'CTU', below('t')),
        contact('a', left('t'), 'h05_a'),
        contact('b', left('c'), 'h05_b'),
        pin('t', 'PT', 'T#1s'),
        pin('c', 'R', 'h05_r'),
        pin('c', 'PV', '5'),
      ],
      [
        contact('en', rail, 'h06_en'),
        coil('y1', right('en'), 'h06_y1'),
        coil('y2', below('y1'), 'h06_y2'),
        coil('y3', below('y2'), 'h06_y3'),
        coil('y4', below('y3'), 'h06_y4'),
        block('ton', 'TON', left('y1')),
        contact('a1', left('ton'), 'h06_a1'),
        block('tof', 'TOF', left('y2')),
        contact('b1', left('tof'), 'h06_b1'),
        block('ctu', 'CTU', left('y3')),
        contact('c1', left('ctu'), 'h06_c1'),
        pin('ton', 'PT', 'T#1s'),
        pin('tof', 'PT', 'T#2s'),
        pin('ctu', 'R', 'h06_r'),
        pin('ctu', 'PV', '7'),
        pin('ctu', 'CV', 'h06_cv'),
      ],
      [
        block('and', 'AND', rail, SF),
        coil('y', right('and'), 'h09_out'),
        block('ton', 'TON', left('and')),
        block('tof', 'TOF', below('ton')),
        contact('a', left('ton'), 'h09_a'),
        contact('b', left('tof'), 'h09_b'),
        contact('c', handle('and', 'IN2'), 'h09_c'),
        contact('d', below('c'), 'h09_d'),
        pin('ton', 'PT', 'T#1s'),
        pin('tof', 'PT', 'T#2s'),
      ],
    ]),
  },
  {
    name: 'Chains',
    rungs: rungs('ld-corpus-hard', 'Chains', [
      [
        contact('a', rail, 'h07_start'),
        block('ton', 'TON', right('a')),
        block('ctu', 'CTU', right('ton')),
        coil('y', right('ctu'), 'h07_done'),
        contact('r', handle('ctu', 'R'), 'h07_reset'),
        pin('ton', 'PT', 'T#1s'),
        pin('ctu', 'PV', '4'),
        pin('ctu', 'CV', 'h07_count'),
      ],
      [
        contact('a', rail, 'h08_start'),
        block('ton', 'TON', right('a')),
        block('tof', 'TOF', right('ton')),
        block('ctu', 'CTU', right('tof')),
        coil('y', right('ctu'), 'h08_done'),
        contact('r1', handle('ctu', 'R'), 'h08_r1'),
        contact('r2', below('r1'), 'h08_r2'),
        pin('ton', 'PT', 'T#1s'),
        pin('tof', 'PT', 'T#2s'),
        pin('ctu', 'PV', '3'),
        pin('ctu', 'CV', 'h08_count'),
      ],
    ]),
  },
  {
    name: 'Mixed',
    rungs: rungs('ld-corpus-hard', 'Mixed', [
      [
        contact('a', rail, 'h10_a'),
        block('c', 'CTU', right('a')),
        coil('q', right('c'), 'h10_q'),
        contact('r1', handle('c', 'R'), 'h10_r1'),
        contact('r2', below('r1'), 'h10_r2'),
        pin('c', 'PV', '2'),
        pin('c', 'CV', 'h10_cv'),
      ],
      [
        contact('a', rail, 'h10_b'),
        block('t', 'TON', right('a')),
        coil('k1', right('t'), 'h10_k1'),
        coil('k2', below('k1'), 'h10_k2'),
        coil('k3', below('k2'), 'h10_k3'),
        contact('e', below('a'), 'h10_e'),
        pin('t', 'PT', 'T#1s'),
      ],
      [
        contact('s', rail, 'h10_s'),
        block('sr', 'SR', right('s')),
        coil('q1', right('sr'), 'h10_q1'),
        contact('rr', handle('sr', 'R'), 'h10_rr'),
      ],
    ]),
  },
]

const BUILT: readonly { name: ProjectName; pous: readonly PouScript[] }[] = [
  { name: 'ld-corpus-basic', pous: BASIC },
  { name: 'ld-corpus-hard', pous: HARD },
]

const IMPORTED: readonly { file: string; from: string; pou: string; language: 'ld' | 'fbd' }[] = [
  { file: 'motor_ladder.ld', from: join(__dirname, 'fixtures', 'project-search'), pou: 'motor_ladder', language: 'ld' },
  { file: 'main_ld.ld', from: join(__dirname, 'fixtures', 'function-block-instance'), pou: 'main_ld', language: 'ld' },
  {
    file: 'main_fbd.fbd',
    from: join(__dirname, 'fixtures', 'function-block-instance'),
    pou: 'main_fbd',
    language: 'fbd',
  },
]

const NEGATIVE_CONTROL = process.env.LD_CORPUS_NEGATIVE_CONTROL === '1'
/** Fails when the project's corpus folder already exists: the corpus is never regenerated. */
function refuseExisting(project: ProjectName): void {
  const dir = join(CORPUS, project)
  if (existsSync(dir)) throw new Error(`the corpus is never regenerated, and ${dir} already exists`)
}

/** Creates the project through the start screen, deletes the wizard's `main` program and saves. */
async function startProject(session: EditorSession, project: ProjectName): Promise<string> {
  const dir = await createProject(session, freshDirectory(project), project)
  await deletePou(session, 'main')
  await saveAndWait(
    session,
    [],
    () => !existsSync(join(dir, 'pous', 'programs', 'main.ld')),
    `${project}: the default main program deleted`,
  )
  return dir
}

for (const project of BUILT) {
  test.describe.serial(project.name, () => {
    test.skip(NEGATIVE_CONTROL, 'negative control run')
    test.beforeAll(() => refuseExisting(project.name))
    const state: { userData?: string; dir?: string } = {}

    project.pous.forEach((pou, index) => {
      test(`${project.name}/${pou.name}`, async () => {
        test.setTimeout(180_000)
        if (index === 0) state.userData = freshProfile(project.name)
        if (state.userData === undefined) throw new Error(`${project.name}: the first POU test did not run`)
        const session = await launchOn(state.userData)
        try {
          if (index === 0) state.dir = await startProject(session, project.name)
          else await openRecentProject(session, project.name, project.pous[0].name)
          const dir = state.dir
          if (dir === undefined) throw new Error(`${project.name}: no project folder`)
          await addLdProgram(session, pou.name)
          const builder = new LadderBuilder(session.page)
          for (const [rung, script] of pou.rungs.entries()) {
            await builder.buildRung(script, `${project.name}/${pou.name}/rung ${rung + 1}`)
          }
          const comments = pou.rungs.map((rung) => rung.comment)
          await saveAndWait(
            session,
            [pou.name],
            () => pouFileHolds(dir, pou.name, comments),
            `${project.name}/${pou.name}`,
          )
          if (index === project.pous.length - 1) copySavedProject(dir, join(CORPUS, project.name, 'project'))
        } catch (error) {
          await session.page.screenshot({ path: test.info().outputPath('failure.png') }).catch(() => undefined)
          throw error
        } finally {
          await shutdown(session.app)
        }
      })
    })
  })
}

test.describe.serial('ld-corpus-imported', () => {
  test.skip(NEGATIVE_CONTROL, 'negative control run')
  test.beforeAll(() => refuseExisting('ld-corpus-imported'))
  const state: { userData?: string; dir?: string } = {}

  test('ld-corpus-imported: the project is created through the UI', async () => {
    test.setTimeout(180_000)
    state.userData = freshProfile('ld-corpus-imported')
    const session = await launchOn(state.userData)
    try {
      state.dir = await startProject(session, 'ld-corpus-imported')
    } finally {
      await shutdown(session.app)
    }
  })

  test('ld-corpus-imported: the copied POUs are opened and saved by the editor', async () => {
    test.setTimeout(180_000)
    const { userData, dir } = state
    if (userData === undefined || dir === undefined) throw new Error('ld-corpus-imported: the project was not created')
    mkdirSync(join(dir, 'pous', 'programs'), { recursive: true })
    for (const { file, from } of IMPORTED) copyFileSync(join(from, file), join(dir, 'pous', 'programs', file))
    const session = await launchOn(userData)
    try {
      await openRecentProject(session, 'ld-corpus-imported', IMPORTED[0].pou)
      for (const { pou, language } of IMPORTED) await openPou(session, pou, language)
      await saveAndWait(
        session,
        IMPORTED.map(({ pou }) => pou),
        () => IMPORTED.every(({ file }) => existsSync(join(dir, 'pous', 'programs', file))),
        'ld-corpus-imported',
      )
      copySavedProject(dir, join(CORPUS, 'ld-corpus-imported', 'project'))
    } finally {
      await shutdown(session.app)
    }
  })
})

test.describe('negative control', () => {
  test.skip(!NEGATIVE_CONTROL, 'set LD_CORPUS_NEGATIVE_CONTROL=1 to run it')

  test('a drop on a marker that does not exist fails within seconds, quoting the markers shown', async () => {
    test.setTimeout(180_000)
    const session = await launchOn(freshProfile('ld-corpus-negative'))
    try {
      await startProject(session, 'ld-corpus-basic')
      await addLdProgram(session, 'Probe')
      const builder = new LadderBuilder(session.page)
      const started = Date.now()
      const failure = await builder
        .buildRung(
          {
            comment: 'negative control',
            steps: [contact('a', rail, 'probe_a'), contact('b', handle('a', 'NOPE'), 'x')],
          },
          'negative control',
        )
        .then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
      const elapsed = Date.now() - started
      test.info().annotations.push({ type: 'negative control', description: `${elapsed} ms: ${failure ?? ''}` })
      expect(failure).toMatch(/no drop marker on pin NOPE of a; markers shown: .*placeholder_/)
      expect(elapsed).toBeLessThan(30_000)
    } finally {
      await shutdown(session.app)
    }
  })
})
