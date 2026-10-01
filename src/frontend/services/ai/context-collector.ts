import type { AICompletionLanguage } from '../../../middleware/shared/ports/ai-port'
import type { openPLCStoreBase } from '../../store'

type StoreState = ReturnType<typeof openPLCStoreBase.getState>

export type CollectFullProjectContextOptions = {
  language?: AICompletionLanguage
  /** POU name -> transpiled ST, for POUs whose stored body is a flow graph. */
  graphicalSt?: ReadonlyMap<string, string>
}

/** Languages whose stored `body.value` is an XYFlow graph, not source text. */
export function isGraphicalLanguage(language: string): boolean {
  return language === 'ld' || language === 'fbd' || language === 'sfc'
}

export function collectProjectContext(
  state: StoreState,
  currentPouName: string,
  maxTokenBudget: number,
  language: AICompletionLanguage = 'st',
): string {
  const maxChars = maxTokenBudget * 4 // ~4 chars per token
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

  // Sections are added in priority order and stop once the budget is exhausted.
  const pouVariables = pou.interface?.variables ?? []
  if (pouVariables.length > 0) {
    const varBlock = fmt.vars(pouVariables)
    addSection(`${fmt.comment(`Current POU: ${pou.name} [${pou.pouType}]`)}\n${varBlock}`)
  }

  const globals = state.project.data.configurations.resource.globalVariables
  if (globals && globals.length > 0) {
    addSection(`${fmt.comment('Global Variables')}\n${fmt.globals(globals)}`)
  }

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

/** Graphical POUs use transpiled ST, or a `read_pou_body` pointer when that is unavailable. */
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

  const globals = state.project.data.configurations.resource.globalVariables
  if (globals && globals.length > 0) {
    sections.push(`${fmt.comment('Global Variables')}\n${fmt.globals(globals)}`)
  }

  for (const pou of pous) {
    if (pou.name === activeEditorPouName) continue
    const vars = pou.interface?.variables ?? []
    const varBlock = vars.length > 0 ? `\n${fmt.vars(vars)}` : ''
    const header = `${pou.pouType.toUpperCase()} ${pou.name} [${pou.body.language}]`
    sections.push(`${fmt.comment(header)}${varBlock}${bodyFor(pou)}`)
  }

  const dataTypes = state.project.data.dataTypes
  if (dataTypes.length > 0) {
    const dtLines = dataTypes.map((dt) => fmt.dataType(dt)).filter(Boolean)
    if (dtLines.length > 0) {
      sections.push(`${fmt.comment('User Data Types')}\n${dtLines.join('\n')}`)
    }
  }

  const config = state.project.data.configurations
  if (config.resource.tasks.length > 0) {
    const taskSummary = config.resource.tasks.map((t) => `${t.name} (${t.triggering})`).join(', ')
    sections.push(`${fmt.comment(`Tasks: ${taskSummary}`)}`)
  }

  return sections.join('\n\n')
}

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
