import type { openPLCStoreBase } from '../../store'

type StoreState = ReturnType<typeof openPLCStoreBase.getState>

/**
 * Collect project-level context for AI completion requests.
 * Gathers variables, globals, referenced FBs, data types, and sibling POUs
 * in priority order, truncating to fit within the token budget.
 *
 * ~4 chars ≈ 1 token, so maxChars = maxTokenBudget * 4
 */
export function collectProjectContext(state: StoreState, currentPouName: string, maxTokenBudget: number): string {
  const maxChars = maxTokenBudget * 4
  const pous = state.project.data.pous
  const pou = pous.find((p) => p.name === currentPouName)
  if (!pou) return ''

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
    const varLines = pouVariables
      .map((v) => {
        const cls = v.class ? `${v.class} ` : ''
        return `  ${cls}${v.name} : ${v.type.value};`
      })
      .join('\n')
    addSection(`(* Current POU: ${pou.name} [${pou.pouType}] *)\nVAR\n${varLines}\nEND_VAR`)
  }

  // 2. Global variables
  const globals = state.project.data.configurations.resource.globalVariables
  if (globals && globals.length > 0) {
    const globalLines = globals.map((v) => `  ${v.name} : ${v.type.value};`).join('\n')
    addSection(`(* Global Variables *)\nVAR_GLOBAL\n${globalLines}\nEND_VAR`)
  }

  // 3. Referenced function blocks — signatures only
  const derivedTypeNames = pouVariables
    .filter((v) => v.type.definition === 'user-data-type')
    .map((v) => v.type.value)

  if (derivedTypeNames.length > 0) {
    const fbPous = pous.filter((p) => p.pouType === 'function-block' && derivedTypeNames.includes(p.name))
    if (fbPous.length > 0) {
      const fbSigs = fbPous.map((fb) => {
        const vars = (fb.interface?.variables ?? [])
          .filter((v) => v.class === 'input' || v.class === 'output' || v.class === 'inOut')
          .map((v) => `${v.class?.toUpperCase()} ${v.name} : ${v.type.value}`)
          .join(', ')
        return `FUNCTION_BLOCK ${fb.name} (* ${vars} *)`
      })
      addSection(`(* Referenced Function Blocks *)\n${fbSigs.join('\n')}`)
    }
  }

  // 4. User-defined data types
  const dataTypes = state.project.data.dataTypes
  if (dataTypes.length > 0) {
    const dtLines = dataTypes
      .slice(0, 10)
      .map((dt) => {
        if (dt.derivation === 'enumerated') {
          return `TYPE ${dt.name} : (${dt.values.map((v) => v.description).join(', ')}); END_TYPE`
        }
        if (dt.derivation === 'structure') {
          const fields = dt.variable.map((v) => `${v.name} : ${v.type.value}`).join('; ')
          return `TYPE ${dt.name} : STRUCT ${fields}; END_STRUCT; END_TYPE`
        }
        if (dt.derivation === 'array') {
          return `TYPE ${dt.name} : ARRAY [${dt.dimensions.map((d) => d.dimension).join(', ')}] OF ${dt.baseType.value}; END_TYPE`
        }
        return ''
      })
      .filter(Boolean)

    if (dtLines.length > 0) {
      addSection(`(* User Data Types *)\n${dtLines.join('\n')}`)
    }
  }

  // 5. Sibling POU signatures (limited to 5)
  const siblings = pous
    .filter((p) => p.name !== currentPouName)
    .slice(0, 5)
    .map((p) => {
      const params = (p.interface?.variables ?? [])
        .filter((v) => v.class === 'input' || v.class === 'output')
        .map((v) => `${v.class?.toUpperCase()} ${v.name} : ${v.type.value}`)
        .join(', ')
      return `${p.pouType.toUpperCase()} ${p.name}${params ? ` (* ${params} *)` : ''}`
    })

  if (siblings.length > 0) {
    addSection(`(* Other POUs *)\n${siblings.join('\n')}`)
  }

  return sections.join('\n\n')
}
