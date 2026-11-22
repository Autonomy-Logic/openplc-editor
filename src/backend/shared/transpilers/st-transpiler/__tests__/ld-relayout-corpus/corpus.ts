import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { transpileToSt } from '@root/backend/shared/transpilers/st-transpiler'
import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import type { RFRung } from '@root/backend/shared/transpilers/st-transpiler/walker/types'
import { fromPortShape } from '@root/backend/shared/transpilers/transpile-from-port'
import { type ParsedProjectData, parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import type { RawProjectFile } from '@root/middleware/shared/ports/project-port'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'

export type CorpusProjectName = 'ld-corpus-basic' | 'ld-corpus-hard' | 'ld-corpus-imported'

export interface CorpusScenario {
  id: string
  name: string
  project: CorpusProjectName
  pou: string
  rungs: readonly number[] | 'all'
}

export const CORPUS_PROJECTS: readonly CorpusProjectName[] = ['ld-corpus-basic', 'ld-corpus-hard', 'ld-corpus-imported']

/** Projects whose POUs were built rung by rung through the editor's UI; their rung comments name the scenarios. */
export const UI_BUILT_PROJECTS: readonly CorpusProjectName[] = ['ld-corpus-basic', 'ld-corpus-hard']

/**
 * The coverage table of the corpus README, row for row: scenario, project, POU and 1-based rungs in display order.
 * B12 (execution order > 0) is not in the corpus: the editor cannot set it, and `sink-order.test.ts` covers it.
 */
export const CORPUS_COVERAGE: readonly CorpusScenario[] = [
  { id: 'B01', name: 'series-contacts-coil', project: 'ld-corpus-basic', pou: 'Main', rungs: [1] },
  { id: 'B02', name: 'nested-parallel-branches', project: 'ld-corpus-basic', pou: 'Main', rungs: [2] },
  { id: 'B06', name: 'parallel-coils-trailing', project: 'ld-corpus-basic', pou: 'Main', rungs: [3] },
  { id: 'B07', name: 'set-reset-edge-coils', project: 'ld-corpus-basic', pou: 'Main', rungs: [4] },
  { id: 'B11', name: 'long-names', project: 'ld-corpus-basic', pou: 'Main', rungs: [5] },
  { id: 'B03', name: 'block-en-eno-outputs', project: 'ld-corpus-basic', pou: 'Blocks', rungs: [1] },
  { id: 'B04', name: 'ctud-handle-branches', project: 'ld-corpus-basic', pou: 'Blocks', rungs: [2] },
  { id: 'B05', name: 'in-out-pins', project: 'ld-corpus-basic', pou: 'Blocks', rungs: [3] },
  { id: 'B08', name: 'block-then-coil-same-band', project: 'ld-corpus-basic', pou: 'Blocks', rungs: [4] },
  { id: 'B09', name: 'pin-variable-row0-vs-coil', project: 'ld-corpus-basic', pou: 'Blocks', rungs: [5] },
  { id: 'B10', name: 'multi-rung-boundary-sinks', project: 'ld-corpus-basic', pou: 'Aux', rungs: [1, 2, 3, 4] },
  { id: 'H01', name: 'ctu-cu-r-separate-networks', project: 'ld-corpus-hard', pou: 'Counters', rungs: [1] },
  { id: 'H02', name: 'ctud-four-input-networks', project: 'ld-corpus-hard', pou: 'Counters', rungs: [2] },
  { id: 'H03', name: 'sr-rs-separate-networks', project: 'ld-corpus-hard', pou: 'Counters', rungs: [3, 4] },
  { id: 'H04', name: 'ton-deep-nested-pin-network', project: 'ld-corpus-hard', pou: 'Counters', rungs: [5] },
  { id: 'H05', name: 'two-blocks-parallel-branches', project: 'ld-corpus-hard', pou: 'Parallel', rungs: [1] },
  { id: 'H06', name: 'three-blocks-parallel-branches', project: 'ld-corpus-hard', pou: 'Parallel', rungs: [2] },
  { id: 'H09', name: 'blocks-feed-across-parallel', project: 'ld-corpus-hard', pou: 'Parallel', rungs: [3] },
  { id: 'H07', name: 'block-feeds-block', project: 'ld-corpus-hard', pou: 'Chains', rungs: [1] },
  { id: 'H08', name: 'block-chain-three', project: 'ld-corpus-hard', pou: 'Chains', rungs: [2] },
  { id: 'H10', name: 'multi-pou-hard-mix', project: 'ld-corpus-hard', pou: 'Mixed', rungs: [1, 2, 3] },
  { id: 'B13', name: 'motor-ladder', project: 'ld-corpus-imported', pou: 'motor_ladder', rungs: 'all' },
  { id: 'B14', name: 'function-block-instance-ld', project: 'ld-corpus-imported', pou: 'main_ld', rungs: 'all' },
]

/** The folder that holds the corpus projects, their expected Structured Text and the README. */
export const CORPUS_ROOT = join(__dirname, '..', 'fixtures', 'ld-relayout-corpus')

const POU_FOLDERS = ['pous/functions', 'pous/function-blocks', 'pous/programs'] as const
const POU_EXTENSIONS = ['.st', '.il', '.ld', '.fbd', '.py', '.cpp', '.json'] as const

/** The saved project folder of a corpus project. */
export function corpusProjectDir(name: CorpusProjectName): string {
  return join(CORPUS_ROOT, name, 'project')
}

/** The folder of a corpus project's expected Structured Text. */
export function expectedStDir(name: CorpusProjectName): string {
  return join(CORPUS_ROOT, name, 'expected-st')
}

/** Reads a text file of the project, or `''` when it does not exist. */
function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** Lists the files under `folder` (relative to `root`, `/`-separated) whose extension is in `extensions`, sorted. */
function collectFiles(root: string, folder: string, extensions: readonly string[]): RawProjectFile[] {
  const base = join(root, ...folder.split('/'))
  if (!existsSync(base)) return []
  const found: RawProjectFile[] = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const relativePath = `${folder}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...collectFiles(root, relativePath, extensions))
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push({ relativePath, content: readFileSync(join(base, entry.name), 'utf8') })
    }
  }
  return found.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
}

/**
 * Reads a saved corpus project from disk into the arguments of the shared `parseProjectFiles`, in the folders the
 * desktop reader uses, and returns the parse result with its warnings.
 * @throws {Error} When the project folder or its `project.json` does not exist.
 */
export function readCorpusProject(name: CorpusProjectName): ParsedProjectData {
  const root = corpusProjectDir(name)
  const projectJson = join(root, 'project.json')
  if (!existsSync(projectJson)) throw new Error(`corpus project ${name} not found: ${projectJson} does not exist`)
  return parseProjectFiles(
    root,
    readFileSync(projectJson, 'utf8'),
    readOptional(join(root, 'devices', 'configuration.json')),
    readOptional(join(root, 'devices', 'pin-mapping.json')),
    POU_FOLDERS.flatMap((folder) => collectFiles(root, folder, POU_EXTENSIONS)),
    collectFiles(root, 'devices/servers', POU_EXTENSIONS),
    collectFiles(root, 'devices/remote', POU_EXTENSIONS),
    readOptional(join(root, 'library.json')),
    collectFiles(root, 'datatypes', ['.dt']),
  )
}

/** Loads a saved corpus project with the shared parseProjectFiles, as the CLI loader does. */
export function loadCorpusProject(name: CorpusProjectName): PLCProjectData {
  return readCorpusProject(name).projectData
}

/** Escapes `text` for literal use inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits a program text into one section per POU and the rest. A POU section runs from its `PROGRAM`,
 * `FUNCTION_BLOCK` or `FUNCTION` header line to the next POU header or the `CONFIGURATION` line; the rest is the text
 * before the first POU (data types) followed by the text from the `CONFIGURATION` line on.
 * @throws {Error} When a POU of `pouNames` has no header after the previous POU's.
 */
export function splitProgramSt(
  programSt: string,
  pouNames: readonly string[],
): { pous: ReadonlyMap<string, string>; rest: string } {
  const starts: { name: string; index: number }[] = []
  let from = 0
  for (const name of pouNames) {
    const header = new RegExp(`^(?:PROGRAM|FUNCTION_BLOCK|FUNCTION) ${escapeRegExp(name)}\\b`, 'm').exec(
      programSt.slice(from),
    )
    if (header === null) throw new Error(`no PROGRAM, FUNCTION_BLOCK or FUNCTION block for POU "${name}"`)
    starts.push({ name, index: from + header.index })
    from += header.index + header[0].length
  }
  const configuration = /^CONFIGURATION\b/m.exec(programSt.slice(from))
  const end = configuration === null ? programSt.length : from + configuration.index
  const pous = new Map<string, string>()
  starts.forEach(({ name, index }, position) => {
    const next: { index: number } | undefined = starts[position + 1]
    pous.set(name, programSt.slice(index, next === undefined ? end : next.index))
  })
  const head = programSt.slice(0, starts.length > 0 ? starts[0].index : end)
  return { pous, rest: head + programSt.slice(end) }
}

/** Joins POU sections (in order) and the rest back into the program text: the POUs go before the `CONFIGURATION` line. */
export function joinStSections(pous: ReadonlyMap<string, string>, rest: string): string {
  const configuration = rest.search(/^CONFIGURATION\b/m)
  const at = configuration === -1 ? rest.length : configuration
  return rest.slice(0, at) + [...pous.values()].join('') + rest.slice(at)
}

/** Splits transpileToSt(fromPortShape(data)).programSt into one section per POU and the rest; joinStSections rebuilds it. */
export function stByPou(data: PLCProjectData): { pous: ReadonlyMap<string, string>; rest: string } {
  const result = transpileToSt(fromPortShape(data))
  return splitProgramSt(result.programSt ?? '', result.pouNames)
}

/** The whole program text, transpileToSt(fromPortShape(data)).programSt, or `''` when no POU compiled. */
export function programStOf(data: PLCProjectData): string {
  return transpileToSt(fromPortShape(data)).programSt ?? ''
}

/** The transpiler's errors and warnings for a project, for a check that the corpus transpiles cleanly. */
export function transpileDiagnostics(data: PLCProjectData): { errors: readonly string[]; warnings: readonly string[] } {
  const result = transpileToSt(fromPortShape(data))
  return { errors: result.errors, warnings: result.warnings }
}

/** Names of the project's LD POUs, in project order. */
export function ldPouNames(data: PLCProjectData): string[] {
  return fromPortShape(data)
    .pous.filter((pou) => pou.body.language === 'ld')
    .map((pou) => pou.name)
}

/**
 * The rungs of an LD POU as the transpiler projects them, in display order.
 * @throws {Error} When the project has no LD POU named `pouName`.
 */
export function ldPouRungs(data: PLCProjectData, pouName: string): readonly RFRung[] {
  const pou = fromPortShape(data).pous.find((candidate) => candidate.name === pouName)
  if (pou === undefined || pou.body.language !== 'ld') throw new Error(`no LD POU named "${pouName}"`)
  return pou.body.value.rungs
}

/** For an LD POU: emitLdBody({ rungs: [rung] }).bodySt for each rung, in display order. */
export function stByRung(data: PLCProjectData, pouName: string): readonly string[] {
  return ldPouRungs(data, pouName).map((rung) => emitLdBody({ rungs: [rung] }).bodySt)
}

/** True when `scenario` covers the 1-based rung `rung`. */
export function coversRung(scenario: CorpusScenario, rung: number): boolean {
  return scenario.rungs === 'all' || scenario.rungs.includes(rung)
}

/** The scenarios of the coverage table that cover a rung, in table order. */
export function scenariosAt(project: CorpusProjectName, pou: string, rung: number): CorpusScenario[] {
  return CORPUS_COVERAGE.filter((s) => s.project === project && s.pou === pou && coversRung(s, rung))
}

/** The comment a UI-built rung carries: each covering scenario as `<ID> <name>`, joined with `; `. */
export function rungComment(project: CorpusProjectName, pou: string, rung: number): string {
  return scenariosAt(project, pou, rung)
    .map((s) => `${s.id} ${s.name}`)
    .join('; ')
}

/** A scenario's rungs as the README writes them: `all`, a range `1-4`, or a comma list. */
export function formatRungs(rungs: CorpusScenario['rungs']): string {
  if (rungs === 'all') return 'all'
  const contiguous = rungs.every((rung, index) => index === 0 || rung === rungs[index - 1] + 1)
  if (rungs.length > 1 && contiguous) return `${rungs[0]}-${rungs[rungs.length - 1]}`
  return rungs.join(', ')
}

/** The file name of a rung's expected Structured Text: `rung-NN.st`, `NN` the 1-based display order on two digits. */
export function rungFileName(rung: number): string {
  return `rung-${String(rung).padStart(2, '0')}.st`
}
