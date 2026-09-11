import type { AICompletionLanguage } from '../../../middleware/shared/ports/ai-port'
import type { openPLCStoreBase } from '../../store'

type StoreState = ReturnType<typeof openPLCStoreBase.getState>

/** Options for `collectFullProjectContext`. An object rather than positional
 *  params so a future addition can't be silently mistaken for the previous
 *  numeric token-budget argument this function used to take. */
export type CollectFullProjectContextOptions = {
  /** Formatting dialect for comments and variable blocks. */
  language?: AICompletionLanguage
  /** POU name -> transpiled ST, for POUs whose stored body is a flow graph. */
  graphicalSt?: ReadonlyMap<string, string>
}

/** Languages whose stored `body.value` is an XYFlow graph, not source text. */
export function isGraphicalLanguage(language: string): boolean {
  return language === 'ld' || language === 'fbd' || language === 'sfc'
}

/**
 * Collect project-level context for AI completion requests.
 * Gathers variables, globals, referenced FBs, data types, and sibling POUs
 * in priority order, truncating to fit within the token budget.
 *
 * When language is Python or C++, context is formatted in the target language's
 * native style (comments + type hints) rather than IEC 61131-3 syntax.
 *
 * ~4 chars ≈ 1 token, so maxChars = maxTokenBudget * 4
 */
export function collectProjectContext(
  state: StoreState,
  currentPouName: string,
  maxTokenBudget: number,
  language: AICompletionLanguage = 'st',
): string {
  const maxChars = maxTokenBudget * 4
  const pous = state.project.data.pous
  const pou = pous.find((p) => p.name === currentPouName)
  if (!pou) return ''

  const fmt = getFormatter(language)
  const sections: string[] = []
  let totalLength = 0

  const addSection = (content: string): boolean => {
    if (totalLength + content.length > maxChars) return false
    sections.push(content)
    totalLength += content.length
    return true
  }

  // 1. Current POU variables (always included — most important context)
  const pouVariables = pou.interface?.variables ?? []
  if (pouVariables.length > 0) {
    const varBlock = fmt.vars(pouVariables)
    addSection(`${fmt.comment(`Current POU: ${pou.name} [${pou.pouType}]`)}\n${varBlock}`)
  }

  // 2. Global variables
  const globals = state.project.data.configurations.resource.globalVariables
  if (globals && globals.length > 0) {
    addSection(`${fmt.comment('Global Variables')}\n${fmt.globals(globals)}`)
  }

  // 3. Referenced function blocks — full variable declarations
  const derivedTypeNames = pouVariables.filter((v) => v.type.definition === 'user-data-type').map((v) => v.type.value)

  if (derivedTypeNames.length > 0) {
    const fbPous = pous.filter((p) => p.pouType === 'function-block' && derivedTypeNames.includes(p.name))
    for (const fb of fbPous) {
      const vars = fmt.vars(fb.interface?.variables ?? [])
      const body = getTextualBody(fb)
      const bodySection = body ? `\n\n${body.substring(0, 500)}` : ''
      if (!addSection(`${fmt.comment(`Referenced: FUNCTION_BLOCK ${fb.name}`)}\n${vars}${bodySection}`)) break
    }
  }

  // 4. User-defined data types
  const dataTypes = state.project.data.dataTypes
  if (dataTypes.length > 0) {
    const dtLines = dataTypes
      .slice(0, 10)
      .map((dt) => fmt.dataType(dt))
      .filter(Boolean)

    if (dtLines.length > 0) {
      addSection(`${fmt.comment('User Data Types')}\n${dtLines.join('\n')}`)
    }
  }

  // 5. Sibling POUs — signatures with variable declarations and body snippet
  const siblings = pous.filter((p) => p.name !== currentPouName)
  const truncComment = language === 'python' ? '\n# ...' : language === 'cpp' ? '\n// ...' : '\n(* ... *)'
  for (const sib of siblings.slice(0, 5)) {
    const varBlock = fmt.vars(sib.interface?.variables ?? [])
    const body = getTextualBody(sib)
    const bodySnippet = body ? `\n\n${body.substring(0, 300)}${body.length > 300 ? truncComment : ''}` : ''
    const header = `${sib.pouType.toUpperCase()} ${sib.name}`
    if (!addSection(`${fmt.comment(header)}\n${varBlock}${bodySnippet}`)) break
  }

  return sections.join('\n\n')
}

/**
 * Collect full project context for AI chat requests (project-scoped).
 *
 * **Project code is never truncated.** Source the model is asked to reason
 * about is not a thing to ration: it either sees the code or it cannot
 * answer.
 *
 * Graphical POUs (LD / FBD / SFC) store an XYFlow graph, not source, so they
 * are represented by their transpiled ST equivalent, supplied by the caller
 * via `options.graphicalSt` (one whole-project transpile per send, keyed by
 * POU name). With no ST available the entry says so and points at
 * `read_pou_body` rather than silently omitting the body.
 */
export function collectFullProjectContext(
  state: StoreState,
  activeEditorPouName: string | null,
  options: CollectFullProjectContextOptions = {},
): string {
  const { language = 'st', graphicalSt } = options
  const pous = state.project.data.pous
  const fmt = getFormatter(language)
  const sections: string[] = []

  const bodyFor = (pou: (typeof pous)[number]): string => {
    if (isGraphicalLanguage(pou.body.language)) {
      const st = graphicalSt?.get(pou.name)
      if (st && st.trim()) {
        return `\n\n${fmt.comment(`${pou.body.language.toUpperCase()} diagram — transpiled ST equivalent`)}\n${st.trim()}`
      }
      return `\n${fmt.comment(`${pou.body.language.toUpperCase()} diagram — ST equivalent unavailable; call read_pou_body("${pou.name}")`)}`
    }
    const body = getTextualBody(pou)
    return body ? `\n\n${body}` : ''
  }

  // 1. Active editor POU — full body + all variables (highest priority, and
  //    first so the model reads the POU the user is looking at before the rest)
  if (activeEditorPouName) {
    const activePou = pous.find((p) => p.name === activeEditorPouName)
    if (activePou) {
      const vars = activePou.interface?.variables ?? []
      const varBlock = vars.length > 0 ? `\n${fmt.vars(vars)}` : ''
      sections.push(
        `${fmt.comment(`Active POU: ${activePou.name} [${activePou.pouType}] language=${activePou.body.language}`)}${varBlock}${bodyFor(activePou)}`,
      )
    }
  }

  // 2. Global variables
  const globals = state.project.data.configurations.resource.globalVariables
  if (globals && globals.length > 0) {
    sections.push(`${fmt.comment('Global Variables')}\n${fmt.globals(globals)}`)
  }

  // 3. Every other POU — variable declarations + full body
  for (const pou of pous) {
    if (pou.name === activeEditorPouName) continue
    const vars = pou.interface?.variables ?? []
    const varBlock = vars.length > 0 ? `\n${fmt.vars(vars)}` : ''
    const header = `${pou.pouType.toUpperCase()} ${pou.name} [${pou.body.language}]`
    sections.push(`${fmt.comment(header)}${varBlock}${bodyFor(pou)}`)
  }

  // 4. User-defined data types
  const dataTypes = state.project.data.dataTypes
  if (dataTypes.length > 0) {
    const dtLines = dataTypes.map((dt) => fmt.dataType(dt)).filter(Boolean)
    if (dtLines.length > 0) {
      sections.push(`${fmt.comment('User Data Types')}\n${dtLines.join('\n')}`)
    }
  }

  // 5. Configuration summary
  const config = state.project.data.configurations
  if (config.resource.tasks.length > 0) {
    const taskSummary = config.resource.tasks.map((t) => `${t.name} (${t.triggering})`).join(', ')
    sections.push(`${fmt.comment(`Tasks: ${taskSummary}`)}`)
  }

  return sections.join('\n\n')
}

/**
 * Group variables into proper IEC 61131-3 variable sections.
 * Returns a string like:
 *   VAR_INPUT\n  x : INT;\n  END_VAR\nVAR_OUTPUT\n  y : BOOL;\n  END_VAR\nVAR\n  local : REAL;\nEND_VAR
 */
export function formatIecVariables(variables: VarLike[]): string {
  const sectionMap: Record<string, string> = {
    input: 'VAR_INPUT',
    output: 'VAR_OUTPUT',
    inOut: 'VAR_IN_OUT',
    external: 'VAR_EXTERNAL',
    temp: 'VAR_TEMP',
    local: 'VAR',
  }

  const grouped = new Map<string, string[]>()
  for (const v of variables) {
    const section = sectionMap[v.class ?? 'local'] ?? 'VAR'
    if (!grouped.has(section)) grouped.set(section, [])
    grouped.get(section)!.push(`  ${v.name} : ${v.type.value};`)
  }

  return Array.from(grouped.entries())
    .map(([section, lines]) => `${section}\n${lines.join('\n')}\nEND_VAR`)
    .join('\n')
}

/** Extract the textual body of a POU (ST, IL, Python, C++) if available */
function getTextualBody(pou: { body: { language: string; value: unknown } }): string | null {
  const { language, value } = pou.body
  if (
    (language === 'st' || language === 'il' || language === 'python' || language === 'cpp') &&
    typeof value === 'string' &&
    value.trim()
  ) {
    return value.trim()
  }
  return null
}

// ---------------------------------------------------------------------------
// Multi-language formatters
// ---------------------------------------------------------------------------

type VarLike = { name: string; class?: string; type: { value: string } }
type GlobalLike = { name: string; type: { value: string } }
type DataTypeLike = {
  name: string
  derivation: string
  values?: { description: string }[]
  variable?: { name: string; type: { value: string } }[]
  dimensions?: { dimension: string }[]
  baseType?: { value: string }
}

/**
 * Format variables as Python-style type-hinted comments.
 */
export function formatPythonVariables(variables: VarLike[]): string {
  const sectionMap: Record<string, string> = {
    input: 'Inputs',
    output: 'Outputs',
    inOut: 'In/Out',
    external: 'External',
    temp: 'Temp',
    local: 'Local',
  }

  const grouped = new Map<string, string[]>()
  for (const v of variables) {
    const section = sectionMap[v.class ?? 'local'] ?? 'Local'
    if (!grouped.has(section)) grouped.set(section, [])
    grouped.get(section)!.push(`#   ${v.name}: ${v.type.value}`)
  }

  return Array.from(grouped.entries())
    .map(([section, lines]) => `# ${section}:\n${lines.join('\n')}`)
    .join('\n')
}

/** Format variables as C++ style comments */
function formatCppVariables(variables: VarLike[]): string {
  const sectionMap: Record<string, string> = {
    input: 'Inputs',
    output: 'Outputs',
    inOut: 'In/Out',
    external: 'External',
    temp: 'Temp',
    local: 'Local',
  }

  const grouped = new Map<string, string[]>()
  for (const v of variables) {
    const section = sectionMap[v.class ?? 'local'] ?? 'Local'
    if (!grouped.has(section)) grouped.set(section, [])
    grouped.get(section)!.push(`//   ${v.name}: ${v.type.value}`)
  }

  return Array.from(grouped.entries())
    .map(([section, lines]) => `// ${section}:\n${lines.join('\n')}`)
    .join('\n')
}

/** Language-specific formatters for project context */
type ContextFormatter = {
  comment: (text: string) => string
  vars: (variables: VarLike[]) => string
  globals: (globals: GlobalLike[]) => string
  dataType: (dt: DataTypeLike) => string
}

function getFormatter(language: AICompletionLanguage): ContextFormatter {
  if (language === 'python') {
    return {
      comment: (text) => `# ${text}`,
      vars: formatPythonVariables,
      globals: (globals) => globals.map((v) => `# ${v.name}: ${v.type.value}`).join('\n'),
      dataType: (dt) => {
        if (dt.derivation === 'enumerated') {
          return `# Enum ${dt.name}: ${dt.values?.map((v) => v.description).join(', ')}`
        }
        if (dt.derivation === 'structure') {
          const fields = dt.variable?.map((v) => `${v.name}: ${v.type.value}`).join(', ')
          return `# Struct ${dt.name}: { ${fields} }`
        }
        if (dt.derivation === 'array') {
          return `# Array ${dt.name}: ${dt.baseType?.value}[${dt.dimensions?.map((d) => d.dimension).join(', ')}]`
        }
        return ''
      },
    }
  }

  if (language === 'cpp') {
    return {
      comment: (text) => `// ${text}`,
      vars: formatCppVariables,
      globals: (globals) => globals.map((v) => `// ${v.name}: ${v.type.value}`).join('\n'),
      dataType: (dt) => {
        if (dt.derivation === 'enumerated') {
          return `// Enum ${dt.name}: ${dt.values?.map((v) => v.description).join(', ')}`
        }
        if (dt.derivation === 'structure') {
          const fields = dt.variable?.map((v) => `${v.name}: ${v.type.value}`).join(', ')
          return `// Struct ${dt.name}: { ${fields} }`
        }
        if (dt.derivation === 'array') {
          return `// Array ${dt.name}: ${dt.baseType?.value}[${dt.dimensions?.map((d) => d.dimension).join(', ')}]`
        }
        return ''
      },
    }
  }

  // ST / IL — IEC 61131-3 syntax (default)
  return {
    comment: (text) => `(* ${text} *)`,
    vars: formatIecVariables,
    globals: (globals) => {
      const lines = globals.map((v) => `  ${v.name} : ${v.type.value};`).join('\n')
      return `VAR_GLOBAL\n${lines}\nEND_VAR`
    },
    dataType: (dt) => {
      if (dt.derivation === 'enumerated') {
        return `TYPE ${dt.name} : (${dt.values?.map((v) => v.description).join(', ')}); END_TYPE`
      }
      if (dt.derivation === 'structure') {
        const fields = dt.variable?.map((v) => `${v.name} : ${v.type.value}`).join('; ')
        return `TYPE ${dt.name} : STRUCT ${fields}; END_STRUCT; END_TYPE`
      }
      if (dt.derivation === 'array') {
        return `TYPE ${dt.name} : ARRAY [${dt.dimensions?.map((d) => d.dimension).join(', ')}] OF ${dt.baseType?.value}; END_TYPE`
      }
      return ''
    },
  }
}
