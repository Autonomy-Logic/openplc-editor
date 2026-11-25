/**
 * Font faces an HMI build can draw with, found from the ST text of its screens and of the blocks they reach. The
 * analysis is conservative: a face it cannot rule out is kept, and a font value it cannot follow keeps every face.
 */

import { HMI_FONT_COUNT } from './vetted-fonts'

/** One ST source file. */
export interface HmiFaceSource {
  name: string
  source: string
}

/** Inputs of the face analysis. */
export interface HmiFaceAnalysisInput {
  /** Sources always built: screens, the generated glue and main program. */
  roots: readonly HmiFaceSource[]
  /** Sources whose POUs count only once a reached source names them: libraries and widget blocks. */
  pool: readonly HmiFaceSource[]
  /** POUs (upper case) reached only once a reached source matches the pattern (not global), e.g. a call opening them. */
  gates?: ReadonlyMap<string, RegExp>
}

/** HMI_FONT enumerators by face id, as declared in the StandardWidgets types. */
const FACE_NAMES: readonly string[] = ['REGULAR', 'BOLD']

/** Every face id. */
export const HMI_ALL_FACES: readonly number[] = Array.from({ length: HMI_FONT_COUNT }, (_, i) => i)

/** The source with comments, strings and pragmas blanked out, so their text never counts. */
function code(source: string): string {
  return source.replace(
    /\(\*[\s\S]*?\*\)|\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\$.|[^'$])*'|"(?:\$.|[^"$])*"|\{[^}]*\}/g,
    (m) => m.replace(/[^\n]/g, ' '),
  )
}

/**
 * A top-level block of a source: its name in upper case, or null for code that is always reached (TYPE blocks, and the
 * text outside every POU, such as VAR_GLOBAL and CONFIGURATION), and its code.
 */
interface Pou {
  name: string | null
  body: string
}

function pous(source: string): Pou[] {
  const out: Pou[] = []
  const block = /\b(FUNCTION_BLOCK|FUNCTION|PROGRAM|INTERFACE|TYPE)\b([\s\S]*?)\bEND_\1\b/gi
  const text = code(source)
  for (const m of text.matchAll(block)) {
    const kind = m[1].toUpperCase()
    const name =
      kind === 'TYPE' ? null : (/^\s*(?:(?:ABSTRACT|FINAL|PUBLIC|INTERNAL)\s+)*(\w+)/i.exec(m[2])?.[1] ?? null)
    out.push({ name: name?.toUpperCase() ?? null, body: m[0] })
  }
  const outside = text.replace(block, (m) => m.replace(/[^\n]/g, ' '))
  if (outside.trim() !== '') out.push({ name: null, body: outside })
  return out
}

/** Faces one block of code can draw with; 'all' when a font value comes from something other than a literal. */
function facesOf(block: string): Set<number> | 'all' {
  const body = block.replace(/\bHMI_FONT\s*:\s*\([^)]*\)/gi, ' ')
  const faces = new Set<number>()
  const face = (name: string): boolean => {
    const id = FACE_NAMES.indexOf(name.toUpperCase())
    if (id < 0) return false
    faces.add(id)
    return true
  }
  for (const m of body.matchAll(/\b(\w*HMI_FONT\w*)\b(\s*#\s*(\w+))?/gi)) {
    if (m[1].toUpperCase() !== 'HMI_FONT') return 'all'
    if (m[3] !== undefined) {
      if (!face(m[3])) return 'all'
      continue
    }
    const before = body.slice(0, m.index)
    const after = body.slice((m.index ?? 0) + m[0].length)
    if (/\bOF\s*$/i.test(before)) faces.add(0)
    else if (/:\s*$/.test(before)) {
      if (!/^\s*:=/.test(after)) faces.add(0)
    } else return 'all'
  }
  for (const m of body.matchAll(/(^|[^#\w])(REGULAR|BOLD)\b/gi)) face(m[2])
  return faces
}

/** Face ids the build needs, ascending; every face when the analysis cannot follow a font value. */
export function hmiUsedFontFaces(input: HmiFaceAnalysisInput): number[] {
  const byName = new Map<string, string>()
  const faces = new Set<number>()
  const add = (found: Set<number> | 'all'): boolean => {
    if (found === 'all') return false
    for (const id of found) faces.add(id)
    return true
  }
  for (const file of input.pool) {
    for (const pou of pous(file.source)) {
      if (pou.name !== null) byName.set(pou.name, pou.body)
      else if (!add(facesOf(pou.body))) return [...HMI_ALL_FACES]
    }
  }
  const reached = new Set<string>()
  const pending: string[] = []
  const texts: string[] = []
  const visit = (text: string): boolean => {
    texts.push(text)
    for (const m of text.matchAll(/\b[A-Za-z_]\w*\b/g)) {
      const name = m[0].toUpperCase()
      if (byName.has(name) && !reached.has(name)) {
        reached.add(name)
        pending.push(name)
      }
    }
    return add(facesOf(text))
  }
  for (const root of input.roots) {
    for (const pou of pous(root.source)) {
      if (!(pou.name === null ? add(facesOf(pou.body)) : visit(pou.body))) return [...HMI_ALL_FACES]
    }
  }
  const gated = new Set<string>()
  for (;;) {
    while (pending.length > 0) {
      const name = pending.pop() ?? ''
      const gate = input.gates?.get(name)
      if (gate && !texts.some((t) => gate.test(t))) {
        gated.add(name)
        continue
      }
      if (!visit(byName.get(name) ?? '')) return [...HMI_ALL_FACES]
    }
    const opened = [...gated].filter((name) => texts.some((t) => input.gates?.get(name)?.test(t) ?? false))
    if (opened.length === 0) break
    for (const name of opened) {
      gated.delete(name)
      pending.push(name)
    }
  }
  return [...faces].sort((a, b) => a - b)
}
