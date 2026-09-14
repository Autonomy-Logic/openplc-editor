/**
 * Read the generated ST and say whether the program does anything.
 *
 * `check` answers "does this compile". Every one of these findings compiles
 * perfectly, which is the point: a timer whose input is never driven, a coil
 * written by two rungs, a program that touches no I/O. A graphical body makes
 * all of them easy to draw and impossible to see.
 *
 * The ST is the subject rather than the diagram because the ST is what runs. A
 * rung can look wired and still transpile to a call with the pin missing — that
 * is exactly the shape of the bug this exists to catch.
 *
 * Conservative by construction: every rule here is one that cannot fire on
 * correct code, because a linter an agent learns to ignore is worse than none.
 * Anything ambiguous is left alone.
 */

import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'
import type { PLCPou, PLCVariable } from '@root/middleware/shared/ports/types'

export interface LintFinding {
  severity: 'error' | 'warning'
  /** The POU it was found in, or null for a project-wide finding. */
  pou: string | null
  /** Stable slug, so a caller can filter without matching prose. */
  rule: string
  message: string
}

export interface LintInput {
  st: string
  pous: readonly PLCPou[]
  systemLibraries: readonly SystemLibrary[]
  /** Resource globals, for the I/O reachability rules. */
  globals: readonly PLCVariable[]
}

/** One POU's statements, with its declarations stripped. */
interface PouBody {
  name: string
  statements: string
}

/** `EN`/`ENO` are the editor's, not the block's — they are never the subject. */
const IMPLICIT = new Set(['EN', 'ENO'])

/**
 * Split the ST into POU bodies.
 *
 * `FUNCTION_BLOCK` is matched before `FUNCTION` deliberately: the shorter
 * keyword is a prefix of the longer one, so the other order ends every function
 * block at its first `END_FUNCTION`.
 */
function splitPous(st: string): PouBody[] {
  const bodies: PouBody[] = []
  const pattern = /\b(FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(\w+)([\s\S]*?)\bEND_\1\b/g
  for (const match of st.matchAll(pattern)) {
    bodies.push({ name: match[2], statements: stripDeclarations(match[3]) })
  }
  return bodies
}

/** Drop every `VAR… END_VAR` block, so a declaration never reads as a use. */
function stripDeclarations(body: string): string {
  return body.replace(/\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_EXTERNAL|_GLOBAL|_TEMP)?\b[\s\S]*?\bEND_VAR\b/g, '')
}

/** Strip comments so a name mentioned in prose is not counted as a use. */
function stripComments(text: string): string {
  return text.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/** Regex-safe form of a name read from project data, which is not validated. */
function escapeForRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`\\b${escapeForRegex(name)}\\b`, 'i').test(text)
}

/** The argument list of `name(...)`, scanned for balance so nesting is safe. */
function callArguments(statements: string, name: string): string | null {
  // Escaped: a legacy JSON project can carry an instance name the editor would
  // refuse, and a raw metacharacter here either throws or matches the wrong call.
  const opener = new RegExp(`\\b${escapeForRegex(name)}\\s*\\(`, 'i')
  const found = opener.exec(statements)
  if (!found) return null

  let depth = 0
  const from = found.index + found[0].length - 1
  for (let at = from; at < statements.length; at += 1) {
    if (statements[at] === '(') depth += 1
    else if (statements[at] === ')') {
      depth -= 1
      if (depth === 0) return statements.slice(from + 1, at)
    }
  }
  return null
}

/** The pins a call assigns, by name. */
function assignedPins(argumentList: string): Set<string> {
  const pins = new Set<string>()
  for (const match of argumentList.matchAll(/(\w+)\s*:?=>?/g)) pins.add(match[1].toUpperCase())
  return pins
}

/** Pins whose value the call sends OUT, `pin => target`. */
function outputPins(argumentList: string): Set<string> {
  const pins = new Set<string>()
  for (const match of argumentList.matchAll(/(\w+)\s*=>/g)) pins.add(match[1].toUpperCase())
  return pins
}

/** A block's declared pins, from the installed libraries or the project's own POUs. */
function pinsOf(
  blockType: string,
  systemLibraries: readonly SystemLibrary[],
  pous: readonly PLCPou[],
): { inputs: string[]; outputs: string[] } | null {
  const own = pous.find((pou) => pou.name.toLowerCase() === blockType.toLowerCase())
  if (own) {
    const variables = own.interface?.variables ?? []
    return {
      inputs: variables.filter((v) => v.class === 'input').map((v) => v.name),
      outputs: variables.filter((v) => v.class === 'output').map((v) => v.name),
    }
  }

  for (const library of systemLibraries) {
    const block = library.pous.find((pou) => pou.name.toLowerCase() === blockType.toLowerCase())
    if (!block) continue
    return {
      inputs: block.variables.filter((v) => v.class === 'input').map((v) => v.name),
      outputs: block.variables.filter((v) => v.class === 'output').map((v) => v.name),
    }
  }
  return null
}

/**
 * Names assigned by an UNCONDITIONAL statement, and how often.
 *
 * Depth matters: a SET and a RESET coil on one variable are two assignments and
 * entirely correct, and they transpile to `IF <edge> THEN x := …; END_IF;`. Only
 * assignments at the top level are the double-drive this rule is about.
 */
function unconditionalAssignments(statements: string): Map<string, number> {
  const counts = new Map<string, number>()
  let depth = 0
  // A call's named arguments are written one per line often enough that this
  // is not an edge case — the editor's own SoftMotion bridge does it — and
  // `wStatusWord := x,` inside one reads exactly like an assignment.
  let parenDepth = 0

  for (const rawLine of statements.split('\n')) {
    const line = rawLine.trim()
    const lineStartedInsideCall = parenDepth > 0
    parenDepth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length
    if (parenDepth < 0) parenDepth = 0
    if (line.length === 0 || lineStartedInsideCall) continue

    const closes = (line.match(/\bEND_(IF|CASE|WHILE|FOR|REPEAT)\b/g) ?? []).length
    depth -= closes
    if (depth < 0) depth = 0

    if (depth === 0) {
      const assignment = /^(\w+(?:\.\w+)*)\s*:=/.exec(line)
      // `inst(…)` is a call, not an assignment, and `a.b := …` writes a member
      // rather than the variable — neither is a double drive.
      if (assignment && !assignment[1].includes('.')) {
        const name = assignment[1].toUpperCase()
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }

    const opens = (line.match(/\b(IF|CASE|WHILE|FOR|REPEAT)\b/g) ?? []).length
    const elses = (line.match(/\bELSIF\b/g) ?? []).length
    depth += opens - elses
  }
  return counts
}

export function lintProgram(input: LintInput): LintFinding[] {
  const findings: LintFinding[] = []
  const bodies = splitPous(stripComments(input.st))

  for (const body of bodies) {
    const pou = input.pous.find((entry) => entry.name.toLowerCase() === body.name.toLowerCase())
    const instances = (pou?.interface?.variables ?? []).filter((variable) => variable.type.definition === 'derived')

    for (const instance of instances) {
      const pins = pinsOf(instance.type.value, input.systemLibraries, input.pous)
      if (!pins) continue

      const argumentList = callArguments(body.statements, instance.name)
      if (argumentList === null) continue

      const assigned = assignedPins(argumentList)
      const inputs = pins.inputs.filter((pin) => !IMPLICIT.has(pin.toUpperCase()))
      const outputs = pins.outputs.filter((pin) => !IMPLICIT.has(pin.toUpperCase()))

      // The block's FIRST declared input is the one that drives it — `IN` on a
      // timer, `EXECUTE` on a motion block. Leaving it open while calling the
      // block is the EN/ENO trap: the rung gates the call and nothing drives it.
      const primary = inputs[0]
      if (primary && !assigned.has(primary.toUpperCase())) {
        const gated = assigned.has('EN') ? ' The rung is wired to EN/ENO, which only gates the call.' : ''
        findings.push({
          severity: 'error',
          pou: body.name,
          rule: 'block-primary-input-unassigned',
          message:
            `"${instance.name}" (${instance.type.value}) is called but its "${primary}" input is never assigned, ` +
            `so the block never does anything.${gated}`,
        })
      }

      // An output is read either as `inst.PIN` or by being sent somewhere in the
      // call itself (`PIN => target`), which is the form the editor generates.
      const sent = outputPins(argumentList)
      const anyRead = outputs.some(
        (pin) => sent.has(pin.toUpperCase()) || mentions(body.statements, `${instance.name}.${pin}`),
      )
      if (outputs.length > 0 && !anyRead) {
        findings.push({
          severity: 'warning',
          pou: body.name,
          rule: 'block-outputs-unread',
          message:
            `Nothing reads any output of "${instance.name}" (${instance.type.value}); ` +
            `its result goes nowhere. Its outputs are: ${outputs.join(', ')}.`,
        })
      }
    }

    for (const [name, count] of unconditionalAssignments(body.statements)) {
      if (count < 2) continue
      findings.push({
        severity: 'error',
        pou: body.name,
        rule: 'variable-driven-twice',
        message:
          `"${name}" is assigned by ${count} unconditional statements; only the last one survives the scan. ` +
          'In ladder this is a double coil.',
      })
    }
  }

  findings.push(...lintIo(input, bodies))
  return findings
}

/** Does the program reach the outside world at all? */
function lintIo(input: LintInput, bodies: PouBody[]): LintFinding[] {
  const located = input.globals.filter((global) => (global.location ?? '').trim().length > 0)
  if (located.length === 0) return []

  const everything = bodies.map((body) => body.statements).join('\n')
  const unreferenced = located.filter((global) => !mentions(everything, global.name))

  // Every located global unread AND unwritten means the program cannot see an
  // input or move an output, whatever else it computes.
  if (unreferenced.length === located.length) {
    return [
      {
        severity: 'error',
        pou: null,
        rule: 'no-io-referenced',
        message:
          `No POU references any of the ${located.length} global(s) bound to an IEC address, ` +
          'so this program reads no inputs and drives no outputs.',
      },
    ]
  }

  return unreferenced.map((global) => ({
    severity: 'warning' as const,
    pou: null,
    rule: 'located-global-unreferenced',
    message: `Global "${global.name}" is bound to ${global.location ?? ''} but no POU references it.`,
  }))
}
