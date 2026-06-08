/**
 * Split the monolithic `program.st` produced by xml2st into one
 * synthetic source file per POU, plus auxiliary files for the project-
 * level sections (`_types.st`, `_globals.st`, `_config.st`).  The
 * editor feeds the result to strucpp via `additionalSources`, so error
 * reports come back with `error.file === '<pouName>.st'` instead of a
 * generic `program.st` line.
 *
 * Why post-process here instead of changing xml2st: xml2st is being
 * abandoned, and Runtime v3 (MatIEC era) ingests the monolithic
 * `program.st` verbatim — splitting upstream would break that target.
 * The editor already knows the project's POU list (it produced the XML
 * the splitter consumes), so the operation is name-anchored and
 * deterministic, not a generic ST parse.
 *
 * Failure mode is graceful: any anomaly (POU not found, duplicate
 * header, overlap, orphan END) returns `null` and the caller falls
 * back to monolithic compilation.  Worst case is unchanged from
 * today's behaviour — error line numbers won't match the editor's POU
 * view, but the build itself never breaks because of the splitter.
 */

export interface KnownPou {
  /** POU name as the user knows it.  Strucpp uppercases internally; we
   *  match case-insensitively against xml2st output. */
  name: string
  kind: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
  /**
   * Source language for the POU.  Used to pick the right file
   *  extension when emitting per-POU files: `.il` for Instruction
   *  List, `.st` for everything else.  Strucpp's IL→ST transpiler
   *  detects IL by content regardless of extension, so this is
   *  documentation more than dispatch — but it makes on-disk
   *  artefacts self-describing and matches what humans expect when
   *  inspecting the build directory.
   */
  language?: 'il' | 'st' | 'ld' | 'fbd' | 'sfc' | 'python' | 'cpp'
}

export interface SplitProgramSt {
  /** Per-file map.  Keys are synthetic filenames (`<PouName>.st` for
   *  POUs, `_types.st` / `_globals.st` / `_config.st` for the
   *  project-level sections).  Values are raw ST suitable for
   *  strucpp's `additionalSources`. */
  files: Map<string, string>
  /** For each POU: where its declaration starts in the original
   *  `program.st`.  Useful for back-mapping diagnostics that come
   *  back referring to the monolithic file (e.g. iec2c on Runtime
   *  v3). */
  pouOffsets: Map<string, { kind: KnownPou['kind']; startLine: number; endLine: number }>
}

interface RangeMatch {
  name: string
  kind: KnownPou['kind']
  startLine: number // 1-indexed
  endLine: number // 1-indexed
  language?: KnownPou['language']
}

/**
 * Find the line index (1-indexed, inclusive) where a POU header for
 * `(name, kind)` starts in `lines`.  Returns -1 when no match is found.
 *
 * The header pattern is intentionally tight: xml2st always emits the
 * keyword at column 0 followed by the POU name and either a colon
 * (functions return-type), whitespace, or end-of-line.  This rules out
 * matches on identifiers that contain the POU name as a substring
 * (`MAIN_LOOP` matching when looking for `MAIN`).
 */
function findPouHeader(lines: string[], start: number, pou: KnownPou): number {
  // Anchor to start-of-line so an indented `function_block manual_override`
  // inside a comment string never matches.  Word boundary at the end so
  // `Manual` doesn't match `Manual_Override`.
  const re = new RegExp(`^${pou.kind}\\s+${escapeRegex(pou.name)}\\b`, 'i')
  for (let i = start; i < lines.length; i++) {
    if (re.test(lines[i])) return i
  }
  return -1
}

/**
 * Find the matching `END_*` for a POU declaration that starts at
 * `headerLine`.  Returns -1 if no closing keyword appears before EOF
 * or before another POU header.
 */
function findPouEnd(lines: string[], headerLine: number, kind: KnownPou['kind']): number {
  const endRe = new RegExp(`^END_${kind}\\b`, 'i')
  // Bail out if a new top-level keyword appears before the closing
  // keyword — implies a malformed file or a POU we didn't expect.
  const otherStartRe = /^(PROGRAM|FUNCTION|FUNCTION_BLOCK|TYPE|CONFIGURATION|VAR_GLOBAL)\b/i
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (endRe.test(lines[i])) return i
    if (otherStartRe.test(lines[i])) return -1
  }
  return -1
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Locate `TYPE..END_TYPE`, `VAR_GLOBAL..END_VAR`, and
 * `CONFIGURATION..END_CONFIGURATION` blocks in document order.
 * These don't have a "name" the editor knows up-front — there's at
 * most one of each per project — so the splitter discovers them
 * generically and groups them into the auxiliary buckets.
 */
function findGenericBlocks(lines: string[]): RangeMatch[] {
  const blocks: RangeMatch[] = []
  const startRe = /^(TYPE|CONFIGURATION|VAR_GLOBAL)\b/i
  const endByKw: Record<string, RegExp> = {
    TYPE: /^END_TYPE\b/i,
    CONFIGURATION: /^END_CONFIGURATION\b/i,
    VAR_GLOBAL: /^END_VAR\b/i,
  }
  let i = 0
  while (i < lines.length) {
    const m = startRe.exec(lines[i])
    if (!m) {
      i++
      continue
    }
    const kw = m[1].toUpperCase()
    const endRe = endByKw[kw]
    let j = i + 1
    while (j < lines.length && !endRe.test(lines[j])) {
      j++
    }
    if (j >= lines.length) {
      // Unclosed top-level block — treat as anomaly so the caller
      // falls back to monolithic compilation.
      throw new Error(`unclosed top-level block: ${kw} at line ${i + 1}`)
    }
    blocks.push({ name: kw, kind: 'PROGRAM', startLine: i + 1, endLine: j + 1 }) // kind ignored for non-POU
    i = j + 1
  }
  return blocks
}

/**
 * Split `program.st` into per-POU files.  Returns `null` on any
 * anomaly so the caller can fall back to monolithic compilation.
 */
export function splitProgramSt(source: string, knownPous: KnownPou[]): SplitProgramSt | null {
  if (knownPous.length === 0) return null

  // Strip trailing newline split artefact for a clean line array.
  const lines = source.split('\n')

  const pouRanges: RangeMatch[] = []
  for (const pou of knownPous) {
    const headerIdx = findPouHeader(lines, 0, pou)
    if (headerIdx === -1) {
      // POU advertised by the project model isn't in the ST output —
      // strucpp would never see this POU either, so falling back
      // doesn't help.  Bail.
      return null
    }
    const endIdx = findPouEnd(lines, headerIdx, pou.kind)
    if (endIdx === -1) return null
    pouRanges.push({
      name: pou.name,
      kind: pou.kind,
      startLine: headerIdx + 1,
      endLine: endIdx + 1,
      ...(pou.language ? { language: pou.language } : {}),
    })
  }

  // POUs must be in strictly increasing order with no overlaps.  An
  // overlap means the regex matched the wrong header (e.g. two POUs
  // with the same name, or a header inside a string literal).
  const sorted = [...pouRanges].sort((a, b) => a.startLine - b.startLine)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startLine <= sorted[i - 1].endLine) return null
  }

  // Generic blocks (TYPE / VAR_GLOBAL / CONFIGURATION) — must not
  // overlap with any POU range.
  let genericBlocks: RangeMatch[]
  try {
    genericBlocks = findGenericBlocks(lines)
  } catch {
    return null
  }
  for (const gb of genericBlocks) {
    for (const pr of sorted) {
      if (gb.startLine <= pr.endLine && gb.endLine >= pr.startLine) return null
    }
  }

  // Build per-file content.  Each per-POU file ends with a newline so
  // strucpp's parser sees a clean trailing line.  IL POUs get a `.il`
  // extension to match the language they actually contain — strucpp's
  // detector keys off content rather than extension, so this is purely
  // self-documenting (and helps anyone debugging the build dir).
  const files = new Map<string, string>()
  for (const r of sorted) {
    const content = lines.slice(r.startLine - 1, r.endLine).join('\n') + '\n'
    const ext = r.language === 'il' ? 'il' : 'st'
    files.set(`${r.name}.${ext}`, content)
  }

  // Bucket generic blocks by keyword.  Multiple TYPE blocks (rare)
  // concatenate within the same file.
  const auxByKey = new Map<string, string[]>()
  const keyByKw: Record<string, string> = {
    TYPE: '_types.st',
    VAR_GLOBAL: '_globals.st',
    CONFIGURATION: '_config.st',
  }
  for (const gb of genericBlocks) {
    const key = keyByKw[gb.name]
    if (!key) continue
    const content = lines.slice(gb.startLine - 1, gb.endLine).join('\n')
    const list = auxByKey.get(key) ?? []
    list.push(content)
    auxByKey.set(key, list)
  }
  for (const [key, parts] of auxByKey) {
    files.set(key, parts.join('\n\n') + '\n')
  }

  const pouOffsets = new Map<string, { kind: KnownPou['kind']; startLine: number; endLine: number }>()
  for (const r of sorted) {
    pouOffsets.set(r.name, { kind: r.kind, startLine: r.startLine, endLine: r.endLine })
  }

  return { files, pouOffsets }
}
