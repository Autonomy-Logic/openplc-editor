/**
 * The ladder-layout engine, and every source file it reaches through its imports, loads with no React, no store, no
 * component and no DOM, so it can run in a worker and in the CLI.
 * @jest-environment node
 * @vitest-environment node
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '..', '..', '..', '..', '..')
const BARREL = resolve(__dirname, '..', 'index.ts')

const FORBIDDEN_PACKAGES = ['react', 'react-dom', 'zustand', 'immer', 'electron']
const FORBIDDEN_FOLDERS = [
  'frontend/components/',
  'frontend/store/',
  'frontend/services/',
  'frontend/hooks/',
  'middleware/adapters/',
  'main/',
]
const DOM_GLOBALS = /\b(?:document|window|navigator|localStorage|sessionStorage)\s*\./

/** The source without its comments, so commented-out code and prose are not read as imports. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Every `import … from`, `export … from` and bare `import '…'` statement of a source file, comments removed. */
function importStatements(source: string): { statement: string; specifier: string }[] {
  const found: { statement: string; specifier: string }[] = []
  const fromPattern =
    /^[ \t]*((?:import|export)\b(?:(?!\n[ \t]*(?:import|export)\b)[^;'"])*?\bfrom\s*['"]([^'"]+)['"])/gm
  for (const match of withoutComments(source).matchAll(fromPattern))
    found.push({ statement: match[1], specifier: match[2] })
  for (const match of withoutComments(source).matchAll(/^[ \t]*(import\s*['"]([^'"]+)['"])/gm)) {
    found.push({ statement: match[1], specifier: match[2] })
  }
  return found
}

/** True when the statement brings in types only (`import type`, `export type`, or every specifier marked `type`). */
function isTypeOnly(statement: string): boolean {
  if (/^(?:import|export)\s+type\b/.test(statement)) return true
  const braces = /\{([^}]*)\}/.exec(statement)
  if (braces === null || /^import\s+[\w$]+\s*,/.test(statement) || /\*\s+as\b/.test(statement)) return false
  const names = braces[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  return names.length > 0 && names.every((name) => name.startsWith('type '))
}

/** The source file a local specifier names (`@root/…` or relative), or `undefined` for a package. */
function resolveLocal(fromFile: string, specifier: string): string | undefined {
  let base: string
  if (specifier.startsWith('@root/')) base = join(SRC, specifier.slice('@root/'.length))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return undefined
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate
  }
  throw new Error(`${relative(SRC, fromFile)} imports ${specifier}, which does not resolve to a source file`)
}

/** Walks the value imports from the barrel and lists each rule a reached file breaks. */
function boundaryViolations(): string[] {
  const violations: string[] = []
  const seen = new Set<string>()
  const queue = [BARREL]
  while (queue.length > 0) {
    const file = queue.shift()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    const shown = relative(SRC, file).split('\\').join('/')
    if (file.endsWith('.tsx')) violations.push(`${shown} is a .tsx file`)
    if (FORBIDDEN_FOLDERS.some((folder) => shown.startsWith(folder)))
      violations.push(`${shown} is outside the engine's layers`)
    const source = readFileSync(file, 'utf8')
    if (DOM_GLOBALS.test(withoutComments(source))) violations.push(`${shown} reads a DOM global`)
    for (const { statement, specifier } of importStatements(source)) {
      if (isTypeOnly(statement)) continue
      const local = resolveLocal(file, specifier)
      if (local !== undefined) {
        queue.push(local)
        continue
      }
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      if (FORBIDDEN_PACKAGES.includes(packageName)) violations.push(`${shown} imports ${specifier}`)
      if (packageName === '@xyflow/react') violations.push(`${shown} imports values from @xyflow/react (types only)`)
    }
  }
  return violations
}

describe('ladder-layout engine boundary', () => {
  it('reaches no React, store, component or DOM code from its barrel', () => {
    expect(boundaryViolations()).toEqual([])
  })
})
