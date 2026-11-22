/**
 * The UI-built LD corpus gives its frozen Structured Text, per POU and per rung, on today's transpiler, and again after
 * every LD rung is laid out by the ladder-layout engine. One test per project and half; a failure lists every
 * POU or rung that differs. `LD_CORPUS_FREEZE=1` writes each missing expected file once and fails.
 * @jest-environment node
 * @vitest-environment node
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { PLCProjectData } from '@root/middleware/shared/ports/types'

import {
  CORPUS_PROJECTS,
  expectedStDir,
  joinStSections,
  ldPouNames,
  programStOf,
  readCorpusProject,
  rungFileName,
  stByPou,
  stByRung,
  transpileDiagnostics,
} from './ld-relayout-corpus/corpus'
import { describeStDifference } from './ld-relayout-corpus/diagnostics'
import { relayoutProject, savedRungs } from './ld-relayout-corpus/relayout'

const FREEZE = process.env.LD_CORPUS_FREEZE === '1'
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

describe.each(CORPUS_PROJECTS)('LD re-layout corpus: %s', (project) => {
  const { projectData: data } = readCorpusProject(project)
  const split = stByPou(data)
  const ldPous = ldPouNames(data)

  // Every expected file of the project, keyed by its path, with the text the project gives for it.
  const dir = expectedStDir(project)
  const expected = { dir, out: new Map<string, string>([[join(dir, '_project.st'), split.rest]]) }
  for (const [pou, text] of split.pous) expected.out.set(join(dir, `${pou}.st`), text)
  for (const pou of ldPous) {
    stByRung(data, pou).forEach((text, index) => expected.out.set(join(dir, pou, rungFileName(index + 1)), text))
  }

  it('transpiles without errors and matches its frozen Structured Text', () => {
    expect(transpileDiagnostics(data).errors).toEqual([])
    expect(joinStSections(split.pous, split.rest)).toBe(programStOf(data))
    const missing: string[] = []
    const differing: string[] = []
    for (const [file, text] of expected.out) {
      const shown = relative(REPO_ROOT, file)
      if (!existsSync(file)) {
        if (FREEZE) {
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, text, { flag: 'wx' })
        }
        missing.push(shown)
      } else if (readFileSync(file, 'utf8') !== text) differing.push(shown)
    }
    if (missing.length > 0) {
      throw new Error(
        `${FREEZE ? 'frozen' : 'missing'}: ${missing.join(', ')}${FREEZE ? '; rerun without LD_CORPUS_FREEZE' : ''}`,
      )
    }
    expect(differing).toEqual([])
  })

  it('gives the same Structured Text after every LD rung is re-laid out, keeping every node', () => {
    const after = relayoutProject(data, ldPous)
    const afterSplit = stByPou(after)
    const differing: string[] = []
    const check = (file: string, text: string | undefined, why: string) => {
      if (existsSync(file) && readFileSync(file, 'utf8') !== text) differing.push(`${relative(REPO_ROOT, file)} ${why}`)
    }
    check(join(expected.dir, '_project.st'), afterSplit.rest, '')
    for (const pou of afterSplit.pous.keys()) {
      const why = ldPous.includes(pou)
        ? describeStDifference(project, pou, savedRungs(data, pou), savedRungs(after, pou))
        : ''
      check(join(expected.dir, `${pou}.st`), afterSplit.pous.get(pou), why)
    }
    for (const pou of ldPous) {
      stByRung(after, pou).forEach((text, index) => check(join(expected.dir, pou, rungFileName(index + 1)), text, ''))
    }
    expect(differing).toEqual([])
    const ids = (source: PLCProjectData) =>
      ldPous.map((pou) => savedRungs(source, pou).map((rung) => rung.nodes.map((node) => node.id)))
    expect(ids(after)).toEqual(ids(data))
  })
})
