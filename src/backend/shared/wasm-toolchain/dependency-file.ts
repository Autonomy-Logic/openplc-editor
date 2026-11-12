/**
 * Reads the dependency file clang writes with `-MD -MF <file>`: a Makefile rule, `object: source header ...`,
 * continued over lines with a trailing backslash, with `\ `, `\#` and `$$` escaping a space, `#` and `$` in names.
 */

/** Normalises a path clang printed: drops `./`, folds `dir/..`, and leaves absolute paths absolute. */
function normalise(path: string): string {
  const absolute = path.startsWith('/')
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else out.push(part)
  }
  return (absolute ? '/' : '') + out.join('/')
}

/**
 * The files a compiled object depends on, in the order clang listed them, or `null` when the text is not a
 * dependency rule.
 */
export function parseDependencyFile(text: string): string[] | null {
  const joined = text.replace(/\\\r?\n/g, ' ')
  const colon = joined.search(/:(\s|$)/)
  if (colon < 0) return null
  const tokens: string[] = []
  let current = ''
  const rest = joined.slice(colon + 1)
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]
    const next = rest[i + 1]
    if (c === '\\' && (next === ' ' || next === '#' || next === '\\')) {
      // clang escapes a space, `#` and a backslash before them with a backslash.
      current += next
      i++
    } else if (c === '$' && next === '$') {
      // ... and writes `$` as `$$`.
      current += '$'
      i++
    } else if (/\s/.test(c)) {
      if (current !== '') tokens.push(current)
      current = ''
    } else {
      current += c
    }
  }
  if (current !== '') tokens.push(current)
  return tokens.map(normalise)
}
