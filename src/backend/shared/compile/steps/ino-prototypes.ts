/**
 * Arduino-style prototype generation for a sketch (`.ino`): every top-level function gets a forward declaration
 * before the first function definition, so the sketch may call a function defined further down. A prototype keeps
 * the preprocessor conditions its definition sits in. Functions with default arguments, templates, operators and
 * methods are left alone, as the Arduino builder does.
 */

const NOT_A_FUNCTION = new Set(['if', 'while', 'for', 'switch', 'return', 'sizeof', 'catch', 'do', 'else', 'case'])
const NOT_A_RETURN_TYPE = /^(?:(?:typedef|struct|class|union|enum|namespace|template|using)\b|extern\s+")/
const HEADER = /^(.*?[\w*&>\s])\s*\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(const\s*)?$/

/** The sketch with comments and string or character literals blanked out, line breaks kept. */
function maskCommentsAndLiterals(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' '
        i++
      }
    } else if (c === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < source.length) {
        out += '  '
        i += 2
      }
    } else if (c === '"' || c === "'") {
      out += c
      i++
      while (i < source.length && source[i] !== c && source[i] !== '\n') {
        out += source[i] === '\\' && i + 1 < source.length ? '  ' : ' '
        i += source[i] === '\\' ? 2 : 1
      }
      if (i < source.length && source[i] === c) {
        out += c
        i++
      }
    } else {
      out += c
      i++
    }
  }
  return out
}

/** One open `#if` group: its opening directive and the `#elif` / `#else` directives seen so far. */
type Condition = string[]

interface Prototype {
  text: string
  conditions: Condition[]
}

const directiveName = (line: string): string => /^#\s*(\w+)/.exec(line.trim())?.[1] ?? ''

/** The function a definition header names, and its prototype when it gets one; `null` when it is no function. */
function functionOf(header: string): { prototype: string | null } | null {
  const normalized = header.replace(/\s+/g, ' ').trim()
  if (NOT_A_RETURN_TYPE.test(normalized)) return null
  const match = HEADER.exec(normalized)
  if (!match) return null
  const [, returnType, name, params, constness] = match
  if (NOT_A_FUNCTION.has(name) || returnType.trim() === '' || /[=;,(){}]/.test(returnType)) return null
  const skipped =
    name === 'setup' ||
    name === 'loop' ||
    params.includes('=') ||
    normalized.includes('::') ||
    /\boperator\b/.test(normalized)
  return { prototype: skipped ? null : `${returnType.trim()} ${name}(${params.trim()})${constness ? ' const' : ''};` }
}

/** Lines that declare `prototype` under the conditions its definition sits in. */
function wrapped(prototype: Prototype): string[] {
  const lines: string[] = []
  for (const condition of prototype.conditions) lines.push(...condition)
  lines.push(prototype.text)
  for (let n = 0; n < prototype.conditions.length; n++) lines.push('#endif')
  return lines
}

/**
 * Returns the sketch with the prototypes inserted before its first function definition, followed by a `#line`
 * directive so compiler messages keep pointing at the sketch's own lines in `fileName`.
 */
export function addInoPrototypes(source: string, fileName: string): string {
  const original = source.split('\n')
  const masked = maskCommentsAndLiterals(source).split('\n')
  const prototypes: Prototype[] = []
  const conditions: Condition[] = []
  let insertAt = -1
  let depth = 0
  let header = ''
  let headerStart = -1
  let headerConditionDepth = 0
  let outermostConditionLine = 0

  for (let index = 0; index < masked.length; index++) {
    const line = masked[index]
    if (line.trim().startsWith('#')) {
      const directiveStart = index
      let directive = original[index].trim()
      while (masked[index].trimEnd().endsWith('\\') && index + 1 < masked.length) {
        index++
        directive += `\n${original[index]}`
      }
      const name = directiveName(directive)
      if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
        if (conditions.length === 0) outermostConditionLine = directiveStart
        conditions.push([directive])
      } else if ((name === 'elif' || name === 'else') && conditions.length > 0)
        conditions[conditions.length - 1].push(directive)
      else if (name === 'endif') conditions.pop()
      if (depth === 0) {
        header = ''
        headerStart = -1
      }
      continue
    }
    for (const c of line) {
      if (depth > 0) {
        if (c === '{') depth++
        else if (c === '}') depth--
        continue
      }
      if (c === ';' || c === '}') {
        header = ''
        headerStart = -1
        continue
      }
      if (c === '{') {
        const definition = headerStart >= 0 ? functionOf(header) : null
        if (definition !== null) {
          if (insertAt < 0) insertAt = headerConditionDepth > 0 ? outermostConditionLine : headerStart
          if (definition.prototype !== null) {
            prototypes.push({ text: definition.prototype, conditions: conditions.map((condition) => [...condition]) })
          }
        }
        depth = 1
        header = ''
        headerStart = -1
        continue
      }
      if (headerStart < 0 && c.trim() !== '') {
        headerStart = index
        headerConditionDepth = conditions.length
      }
      if (headerStart >= 0) header += c
    }
    if (headerStart >= 0) header += ' '
  }

  if (prototypes.length === 0) return source
  const inserted = prototypes.flatMap(wrapped)
  return [
    ...original.slice(0, insertAt),
    ...inserted,
    `#line ${insertAt + 1} "${fileName}"`,
    ...original.slice(insertAt),
  ].join('\n')
}
