/**
 * Dev helper: run the editor's own project parse + ST transpile on a project
 * directory and print the Structured Text it would hand to strucpp.
 *
 * Usage:
 *   npx ts-node scripts/dev-transpile-project.ts "<path to project dir>" [out.st]
 *
 * Not part of the build — a manual verification aid for the compile pipeline.
 */

import fs from 'fs'
import path from 'path'

import { fromSchemaShape, transpileToSt } from '../src/backend/shared/transpilers/st-transpiler'
import { parseProjectFiles } from '../src/backend/shared/utils/parse-project-files'
import type { RawProjectFile } from '../src/middleware/shared/ports/project-port'

function collect(dir: string, exts: string[]): RawProjectFile[] {
  if (!fs.existsSync(dir)) return []
  const out: RawProjectFile[] = []
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (exts.includes(path.extname(entry.name).toLowerCase())) {
        out.push({ relativePath: path.relative(projectDir, full), content: fs.readFileSync(full, 'utf-8') })
      }
    }
  }
  walk(dir)
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

const projectDir = process.argv[2]
if (!projectDir) {
  console.error('usage: dev-transpile-project.ts <project-dir> [out.st]')
  process.exit(1)
}
const outPath = process.argv[3]

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '')

const parsed = parseProjectFiles(
  projectDir,
  read(path.join(projectDir, 'project.json')),
  read(path.join(projectDir, 'devices', 'configuration.json')),
  read(path.join(projectDir, 'devices', 'pin-mapping.json')),
  collect(path.join(projectDir, 'pous'), ['.st', '.il', '.ld', '.fbd', '.py', '.cpp', '.json']),
  collect(path.join(projectDir, 'devices', 'servers'), ['.json']),
  collect(path.join(projectDir, 'devices', 'remote'), ['.json']),
  '',
  collect(path.join(projectDir, 'datatypes'), ['.dt']),
)

for (const w of parsed.warnings ?? []) console.error(`[warn] ${w}`)

// Same projection `compiler-adapter.toIpcProjectData` applies before handing
// the project to the transpiler: flat port POUs become the discriminated
// { type, data } form, and `configurations` is renamed to `configuration`.
/* eslint-disable @typescript-eslint/no-explicit-any */
const pd = parsed.projectData as any
const ipc = {
  dataTypes: pd.dataTypes,
  pous: (pd.pous ?? []).map((pou: any) => ({
    type: pou.pouType,
    data: {
      name: pou.name,
      variables: pou.interface?.variables ?? [],
      ...(pou.interface?.returnType ? { returnType: pou.interface.returnType } : {}),
      body: pou.body,
      documentation: pou.documentation ?? '',
    },
  })),
  configuration: pd.configurations,
  libraries: pd.libraries,
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const result = transpileToSt(fromSchemaShape(ipc as never))

for (const w of result.warnings) console.error(`[transpile warn] ${w}`)
for (const e of result.errors) console.error(`[transpile ERROR] ${e}`)

if (!result.programSt) {
  console.error('No ST produced')
  process.exit(1)
}
if (outPath) {
  fs.writeFileSync(outPath, result.programSt)
  console.error(`wrote ${outPath} (POUs: ${result.pouNames.join(', ')})`)
} else {
  process.stdout.write(result.programSt)
}
