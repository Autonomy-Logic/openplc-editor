/**
 * The UI-built LD corpus gives its frozen Structured Text, per POU and per rung, on today's transpiler.
 * `LD_CORPUS_FREEZE=1` writes each missing expected file once and fails, so a freeze never passes as a run.
 * @jest-environment node
 * @vitest-environment node
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { PLCProjectData } from '@root/middleware/shared/ports/types'

import {
  CORPUS_COVERAGE,
  CORPUS_PROJECTS,
  CORPUS_ROOT,
  type CorpusProjectName,
  expectedStDir,
  formatRungs,
  joinStSections,
  ldPouNames,
  ldPouRungs,
  programStOf,
  readCorpusProject,
  rungComment,
  rungFileName,
  scenariosAt,
  stByPou,
  stByRung,
  transpileDiagnostics,
  UI_BUILT_PROJECTS,
} from './ld-relayout-corpus/corpus'

const FREEZE = process.env.LD_CORPUS_FREEZE === '1'
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

const EXPECTED_IDS = [
  ...Array.from({ length: 14 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`).filter((id) => id !== 'B12'),
  ...Array.from({ length: 10 }, (_, index) => `H${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, index) => `W${String(index + 1).padStart(2, '0')}`),
]

/**
 * Compares `actual` with the frozen file. With `LD_CORPUS_FREEZE=1` a missing file is written (never overwritten)
 * and the check fails, naming it; without it a missing file fails.
 */
function expectFrozen(file: string, actual: string): void {
  const shown = relative(REPO_ROOT, file)
  if (existsSync(file)) {
    expect(actual).toBe(readFileSync(file, 'utf8'))
    return
  }
  if (!FREEZE) throw new Error(`missing ${shown}; run once with LD_CORPUS_FREEZE=1 to freeze it`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, actual, { flag: 'wx' })
  throw new Error(`frozen ${shown}; rerun without LD_CORPUS_FREEZE`)
}

/** The scenario IDs a test name carries, as `[B01 B02]`, or `[]` when none covers it. */
function idTag(ids: readonly string[]): string {
  return `[${[...new Set(ids)].join(' ')}]`
}

/** Loads a corpus project at collection time, keeping the error so a missing project fails as a test. */
function tryLoad(project: CorpusProjectName): { data: PLCProjectData; warnings: readonly string[] } | Error {
  try {
    const parsed = readCorpusProject(project)
    return { data: parsed.projectData, warnings: parsed.warnings ?? [] }
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/** The README's coverage rows: ID, scenario, project, POU and rungs, as written. */
function readmeCoverageRows(): string[][] {
  const readme = readFileSync(join(CORPUS_ROOT, 'README.md'), 'utf8')
  return readme
    .split('\n')
    .filter((line) => /^\|\s*[BHW]\d{2}\s*\|/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, 6)
        .map((cell) => cell.trim()),
    )
}

const loaded = new Map(CORPUS_PROJECTS.map((project) => [project, tryLoad(project)] as const))

describe('LD re-layout corpus: frozen Structured Text', () => {
  for (const project of CORPUS_PROJECTS) {
    const entry = loaded.get(project)
    if (entry === undefined || entry instanceof Error) {
      it(`${project} loads`, () => {
        throw entry ?? new Error(`${project} was not loaded`)
      })
      continue
    }
    const { data } = entry
    const split = stByPou(data)

    it(`${project} transpiles without errors`, () => {
      expect(transpileDiagnostics(data).errors).toEqual([])
    })

    for (const [pou, section] of split.pous) {
      const ids = CORPUS_COVERAGE.filter((s) => s.project === project && s.pou === pou).map((s) => s.id)
      it(`${project}/${pou} ${idTag(ids)}`, () => {
        expectFrozen(join(expectedStDir(project), `${pou}.st`), section)
      })
    }

    for (const pou of ldPouNames(data)) {
      stByRung(data, pou).forEach((rungSt, index) => {
        const ids = scenariosAt(project, pou, index + 1).map((s) => s.id)
        it(`${project}/${pou}/rung ${index + 1} ${idTag(ids)}`, () => {
          expectFrozen(join(expectedStDir(project), pou, rungFileName(index + 1)), rungSt)
        })
      })
    }

    it(`${project}/_project`, () => {
      expectFrozen(join(expectedStDir(project), '_project.st'), split.rest)
    })

    it(`${project}: the POU sections and the rest rebuild programSt exactly`, () => {
      expect(joinStSections(split.pous, split.rest)).toBe(programStOf(data))
    })
  }
})

describe('LD re-layout corpus: coverage table', () => {
  it('CORPUS_COVERAGE holds exactly B01-B11, B13, B14, H01-H10 and W01-W08', () => {
    const ids = CORPUS_COVERAGE.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(EXPECTED_IDS)
  })

  it('the README coverage table equals CORPUS_COVERAGE', () => {
    expect(readmeCoverageRows()).toEqual(
      CORPUS_COVERAGE.map((s) => [s.id, s.name, s.project, s.pou, formatRungs(s.rungs)]),
    )
  })

  it('the README traces B12 to sink-order.test.ts', () => {
    const readme = readFileSync(join(CORPUS_ROOT, 'README.md'), 'utf8')
    expect(readme).toMatch(/^- B12 execution-order-mixed: [^\n]*\n?[^\n]*sink-order\.test\.ts/m)
  })

  for (const scenario of CORPUS_COVERAGE) {
    it(`${scenario.id}: ${scenario.project}/${scenario.pou} rungs ${formatRungs(scenario.rungs)} exist`, () => {
      const entry = loaded.get(scenario.project)
      if (entry === undefined || entry instanceof Error) throw entry ?? new Error(`${scenario.project} not loaded`)
      expect(ldPouNames(entry.data)).toContain(scenario.pou)
      const count = ldPouRungs(entry.data, scenario.pou).length
      const wanted = scenario.rungs === 'all' ? [1] : scenario.rungs
      for (const rung of wanted) expect(rung).toBeLessThanOrEqual(count)
    })
  }

  for (const project of UI_BUILT_PROJECTS) {
    it(`${project} loads without parser warnings`, () => {
      const entry = loaded.get(project)
      if (entry === undefined || entry instanceof Error) throw entry ?? new Error(`${project} not loaded`)
      expect(entry.warnings).toEqual([])
    })

    it(`${project}: every rung carries the scenarios that cover it as its comment`, () => {
      const entry = loaded.get(project)
      if (entry === undefined || entry instanceof Error) throw entry ?? new Error(`${project} not loaded`)
      const comments = ldPouNames(entry.data).flatMap((pou) =>
        ldPouRungs(entry.data, pou).map((rung, index) => ({
          rung: `${pou}/rung ${index + 1}`,
          comment: rung.comment ?? '',
          expected: rungComment(project, pou, index + 1),
        })),
      )
      expect(comments.map(({ rung, comment }) => ({ rung, comment }))).toEqual(
        comments.map(({ rung, expected }) => ({ rung, comment: expected })),
      )
      expect(comments.filter(({ expected }) => expected === '').map(({ rung }) => rung)).toEqual([])
    })
  }
})
