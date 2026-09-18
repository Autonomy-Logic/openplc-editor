/**
 * Light-theme token color rules, extracted from
 * `.../monaco/configs/themes/openplc/openplc.ts` so the live editor's theme
 * registration and the PDF export's text renderer (which resolves Monaco/LSP
 * token scopes to colors without a live editor) share one source of truth.
 * Print is light-theme-only, so only the light palette lives here.
 */

export type TokenColorRule = {
  token: string
  foreground: string
  fontStyle?: 'bold' | 'italic'
}

const COLORS = {
  brand: '0464FB',
  brandMedium: '0350C9',
  lightType: '267F99',
  lightString: 'A31515',
  lightNumber: '098658',
  lightComment: '008000',
  lightFunction: '795E26',
  lightVariable: '001080',
  lightEnumMember: '0070C1',
} as const

export const OPENPLC_LIGHT_EDITOR_FOREGROUND = '#000000'

export const OPENPLC_LIGHT_TOKEN_RULES: TokenColorRule[] = [
  // Lexical (Monarch from basic-languages/st + il.ts)
  { token: 'keyword', foreground: COLORS.brand, fontStyle: 'bold' },
  { token: 'type', foreground: COLORS.lightType },
  { token: 'constant', foreground: COLORS.brandMedium },
  { token: 'predefined', foreground: COLORS.lightFunction },
  { token: 'number', foreground: COLORS.lightNumber },
  { token: 'string', foreground: COLORS.lightString },
  { token: 'comment', foreground: COLORS.lightComment, fontStyle: 'italic' },
  { token: 'tag', foreground: COLORS.lightNumber },
  // IL-specific
  { token: 'literalCode', foreground: COLORS.brand },
  { token: 'typeKeyword', foreground: COLORS.lightType },
  { token: 'label.il', foreground: COLORS.brand },
  { token: 'labelValue', foreground: COLORS.lightType },
  { token: 'st.keyword', foreground: COLORS.brand },
  // Semantic (STruC++ LSP)
  { token: 'variable', foreground: COLORS.lightVariable },
  { token: 'parameter', foreground: COLORS.lightVariable, fontStyle: 'italic' },
  { token: 'function', foreground: COLORS.lightFunction },
  { token: 'method', foreground: COLORS.lightFunction },
  { token: 'property', foreground: COLORS.lightVariable },
  { token: 'namespace', foreground: COLORS.lightType, fontStyle: 'bold' },
  { token: 'class', foreground: COLORS.lightType, fontStyle: 'bold' },
  { token: 'interface', foreground: COLORS.lightType, fontStyle: 'bold' },
  { token: 'enum', foreground: COLORS.lightType, fontStyle: 'bold' },
  { token: 'enumMember', foreground: COLORS.lightEnumMember },
]

/**
 * Resolves a Monarch/semantic token scope (e.g. `"keyword.cpp"`) to a color,
 * by longest-prefix match against `OPENPLC_LIGHT_TOKEN_RULES` — the same
 * resolution Monaco itself does against `IStandaloneThemeData.rules`. Falls
 * back to the editor foreground for an unmatched scope.
 */
export function resolveOpenPlcTokenColor(tokenScope: string): string {
  let best: TokenColorRule | undefined
  for (const rule of OPENPLC_LIGHT_TOKEN_RULES) {
    const matches = tokenScope === rule.token || tokenScope.startsWith(`${rule.token}.`)
    if (matches && (!best || rule.token.length > best.token.length)) {
      best = rule
    }
  }
  return best ? `#${best.foreground}` : OPENPLC_LIGHT_EDITOR_FOREGROUND
}
