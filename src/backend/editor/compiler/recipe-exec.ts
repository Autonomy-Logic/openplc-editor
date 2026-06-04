/**
 * Tokenize + execute arduino-cli recipe strings as argv arrays.
 *
 * Why this exists: arduino-cli's `--show-properties=expanded` returns
 * `recipe.cpp.o.pattern` / `recipe.c.o.pattern` / `recipe.ar.pattern`
 * as POSIX-shell-quoted command lines (e.g. `'-DUSB_PRODUCT="Arduino
 * Leonardo"'`). Passing that to Node's `exec()` works on macOS/Linux
 * (where `sh -c` consumes the quoting) but breaks on Windows because
 * `cmd.exe` doesn't understand single quotes — the argv reaches gcc
 * with literal quote characters and gcc treats it as a missing file.
 *
 * Tokenizing the recipe to argv up-front and spawning the process
 * directly (no shell) makes the invocation platform-agnostic. The
 * tokenizer covers the subset of POSIX quoting arduino-cli actually
 * emits: whitespace-separated tokens, optional single-quoted segments
 * (literal), optional double-quoted segments (literal — arduino-cli
 * does not emit backslash escapes inside double quotes), and mixed
 * tokens that concatenate quoted and unquoted parts (`-DFOO="bar"`).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Parse a POSIX-shell-quoted recipe into a flat argv array, preserving
 * any embedded quote characters that were inside an outer single-quote
 * segment (the typical Leonardo / Arduino USB descriptor shape:
 * `'-DUSB_PRODUCT="Arduino Leonardo"'` → token
 * `-DUSB_PRODUCT="Arduino Leonardo"`).
 *
 * Throws on unterminated quote. Does NOT support backslash escapes,
 * shell operators (`|`, `>`, `&&`), env-var expansion, or subshells —
 * arduino-cli recipes contain none of those.
 */
export function tokenizeRecipe(recipe: string): string[] {
  const tokens: string[] = []
  let i = 0
  const n = recipe.length

  while (i < n) {
    // Skip inter-token whitespace.
    while (i < n && isWhitespace(recipe[i])) i++
    if (i >= n) break

    let token = ''
    while (i < n && !isWhitespace(recipe[i])) {
      const ch = recipe[i]
      if (ch === "'") {
        // Single-quoted segment: literal until next single quote.
        i++
        while (i < n && recipe[i] !== "'") {
          token += recipe[i]
          i++
        }
        if (i >= n) {
          throw new Error(`tokenizeRecipe: unterminated single quote in recipe near position ${i}`)
        }
        i++ // skip closing '
      } else if (ch === '"') {
        // Double-quoted segment: literal until next double quote.
        i++
        while (i < n && recipe[i] !== '"') {
          token += recipe[i]
          i++
        }
        if (i >= n) {
          throw new Error(`tokenizeRecipe: unterminated double quote in recipe near position ${i}`)
        }
        i++ // skip closing "
      } else {
        token += ch
        i++
      }
    }
    tokens.push(token)
  }

  return tokens
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

/**
 * Replace placeholder tokens (e.g. `{source_file}`, `{object_file}`,
 * `{includes}`) in an argv array with concrete values. A scalar
 * replacement substitutes 1-for-1; an array replacement expands into
 * multiple argv entries (used for `{includes}` which becomes
 * `-I<srcDir> -I<baremetalDir>`).
 *
 * Partial matches are honored — `"{source_file}"` arriving as a single
 * token after tokenization (when the recipe wrote `"{source_file}"`)
 * is treated as the bare placeholder by checking equality first; if
 * the token contains the placeholder as a substring (e.g.
 * `-o{object_file}.tmp`, which arduino-cli does not emit but is
 * theoretically possible), the placeholder is substituted via string
 * replace and the token kept as a single entry. Array replacements
 * are only allowed for exact-equality matches; substring expansion
 * with an array would silently corrupt the argv.
 */
export function substitutePlaceholders(
  argv: ReadonlyArray<string>,
  replacements: Readonly<Record<string, string | ReadonlyArray<string>>>,
): string[] {
  const out: string[] = []

  for (const token of argv) {
    let handled = false

    for (const [placeholder, value] of Object.entries(replacements)) {
      if (token === placeholder) {
        if (Array.isArray(value)) {
          out.push(...value)
        } else {
          out.push(value as string)
        }
        handled = true
        break
      }
      if (token.includes(placeholder)) {
        if (Array.isArray(value)) {
          throw new Error(
            `substitutePlaceholders: placeholder "${placeholder}" appears as substring in token "${token}", but the replacement is an array. Array expansion is only safe for exact-match tokens.`,
          )
        }
        out.push(token.split(placeholder).join(value as string))
        handled = true
        break
      }
    }

    if (!handled) {
      out.push(token)
    }
  }

  return out
}

/**
 * Spawn a child process with the given argv (no shell). Resolves with
 * captured stdout/stderr; rejects with the standard Node ExecException
 * augmented with stdout/stderr on non-zero exit. Same surface as
 * `promisify(exec)` so the migration is mechanical at call sites.
 *
 * `argv[0]` is the executable; the rest are arguments. Both are passed
 * literally to the OS — no shell expansion, no quoting concerns.
 */
export async function execRecipeArgv(
  argv: ReadonlyArray<string>,
  options: { maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  if (argv.length === 0) {
    throw new Error('execRecipeArgv: empty argv')
  }
  const [command, ...args] = argv
  const result = await execFileAsync(command, args, {
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  })
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}
