/**
 * Project-level POU emission order, mirroring python's lazy /
 * on-reference scheme.
 *
 * Python's `PLCGenerator.GeneratePouProgram(pou_name)` is recursive
 * (PLCGenerator.py:302):
 *
 *   1. Iterate `project.getpous()` in source order.
 *   2. For each POU, mark it computed BEFORE descending so cycles
 *      don't infinite-loop.
 *   3. While generating the POU's body, every block / variable
 *      reference that resolves to another project POU triggers
 *      `GeneratePouProgram(dep)` to emit that dependency to the
 *      shared `self.Program` list FIRST.
 *
 * Net effect: a depth-first post-order traversal where dependencies
 * are emitted ahead of dependents.  This module recreates that order
 * up-front so the driver loop is a single linear walk — no callback
 * threading required through the per-POU generator.
 *
 * Dependency extraction (mirrors PLCGenerator.py call sites):
 *   - `block.typeName` for blocks in `LdBody.instances`
 *     (PLCGenerator.py:1384, 1827).
 *   - Variable `type` of `derived` / `user-data-type` definitions
 *     matching a project POU name (FB instance variables,
 *     PLCGenerator.py:900).
 *   - Textual body text scanned with python's identifier regex
 *     `(?:^|[^0-9^A-Z])NAME(?:$|[^0-9^A-Z])` against UPPER(body)
 *     (PLCGenerator.py:327-331 `GeneratePouProgramInText`).
 */

import type { TranspilePou, TranspileProject } from './types'

export function buildPouEmissionOrder(pous: readonly TranspilePou[]): TranspilePou[] {
  const byName = new Map<string, TranspilePou>()
  for (const p of pous) byName.set(p.name, p)
  const pouNames = new Set(byName.keys())

  const emitted = new Set<string>()
  const order: TranspilePou[] = []

  const visit = (name: string): void => {
    if (emitted.has(name)) return
    emitted.add(name) // mark BEFORE recursion (cycle-safe; matches python)
    const pou = byName.get(name)
    if (!pou) return
    for (const dep of extractPouDeps(pou, pouNames)) visit(dep)
    order.push(pou)
  }

  for (const p of pous) visit(p.name)
  return order
}

function extractPouDeps(pou: TranspilePou, pouNames: ReadonlySet<string>): string[] {
  const deps = new Set<string>()

  // Variable references: a `derived` / `user-data-type` variable
  // whose type name matches another project POU is an FB instance
  // declaration — emit the FB definition first.
  for (const v of pou.interface?.variables ?? []) {
    const def = v.type.definition
    if (def === 'derived' || def === 'user-data-type') {
      const tname = (v.type as { value: string }).value
      if (tname !== pou.name && pouNames.has(tname)) deps.add(tname)
    }
  }

  // Body references — graphical bodies iterate React Flow nodes;
  // textual bodies regex-match POU names in the source text.
  if (pou.body.language === 'ld') {
    for (const rung of pou.body.value.rungs) {
      for (const node of rung.nodes) {
        if (node.type !== 'block') continue
        const typeName = readBlockTypeName(node.data)
        if (typeName && typeName !== pou.name && pouNames.has(typeName)) deps.add(typeName)
      }
    }
  } else if (pou.body.language === 'fbd') {
    for (const node of pou.body.value.rung.nodes) {
      if (node.type !== 'block') continue
      const typeName = readBlockTypeName(node.data)
      if (typeName && typeName !== pou.name && pouNames.has(typeName)) deps.add(typeName)
    }
  } else if (
    pou.body.language === 'st' ||
    pou.body.language === 'il' ||
    pou.body.language === 'python' ||
    pou.body.language === 'cpp'
  ) {
    // Textual body — port of python's `GeneratePouProgramInText`.
    // Explicit narrowing because editor's tsconfig doesn't infer
    // `body.value` from the negation of the graphical-language list
    // above (web's tsconfig does).
    const upper = pou.body.value.toUpperCase()
    for (const name of pouNames) {
      if (name === pou.name) continue
      const re = new RegExp(`(?:^|[^0-9^A-Z])${escapeRegex(name.toUpperCase())}(?:$|[^0-9^A-Z])`)
      if (re.test(upper)) deps.add(name)
    }
  }

  return [...deps]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Read the block's referenced POU/function type name from the React
 *  Flow `data` payload.  Editor stores this at `data.variant.name`. */
function readBlockTypeName(data: Record<string, unknown>): string | null {
  const variant = data['variant']
  if (!isRecord(variant)) return null
  const name = variant['name']
  return typeof name === 'string' ? name : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/* Re-export for callers that want to query just the order, e.g.
 * for diagnostics or alternative walk schemes. */
export function emissionOrder(project: TranspileProject): string[] {
  return buildPouEmissionOrder(project.pous).map((p) => p.name)
}
