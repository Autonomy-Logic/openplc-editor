import type * as Monaco from 'monaco-editor'

// Monaco token-rule palette.  Two tokenisation layers feed the
// renderer and the rules below cover both:
//
//   1. **Lexical (Monarch)** — Monaco ships a built-in
//      `basic-languages/st` Monarch tokenizer that auto-registers when
//      the package loads.  It classifies words against fixed lists:
//      `keyword` (IF/THEN/CASE/…), `type` (BOOL/INT/REAL/…),
//      `constant` (TRUE/FALSE/NULL), `predefined` (TO_*, MOD, ABS, …),
//      `number`, `string`, `comment`, `tag` (T#/DT#/%I*), `identifier`
//      (everything else).  IL keeps its own scopes (`literalCode`,
//      `label.il`, `labelValue`).
//
//   2. **Semantic (LSP)** — The STruC++ LSP worker emits semantic
//      tokens for the entries Monarch can't see — user-declared
//      variables / parameters / functions / types / namespaces /
//      enum members.  Monaco overlays these on top of the Monarch
//      colours; a semantic-token rule wins for the range it covers.
//
// Colours stay inside OpenPLC's design tokens — primary blues from
// `globals.css` and the neutral grays from `tailwind.config.ts` —
// rather than borrowing VS Code's palette.  Brand alignment matters
// more than per-token rainbow distinction; structure carries through
// position (primary blue = action / declaration; lighter shades =
// reference / value; neutral gray = comment).

const COLORS = {
  // Primary blue scale (light → dark)
  primaryLight: 'B4D0FE',
  primary: '0464FB',
  primaryMedium: '0350C9',
  primaryMediumDark: '023C97',
  primaryDark: '011E4B',
  // Neutrals
  neutral600: '868CA5',
  neutral700: '7D8297',
  neutral300: 'C8D0D9',
} as const

const lightThemeData: Monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    // ───────────── Lexical (Monarch from basic-languages/st + il.ts)
    { token: 'keyword', foreground: COLORS.primary, fontStyle: 'bold' }, // IF/THEN/CASE/FOR/...
    { token: 'type', foreground: COLORS.primaryMediumDark }, // BOOL/INT/REAL/...
    { token: 'constant', foreground: COLORS.primaryMedium }, // TRUE/FALSE/NULL
    { token: 'predefined', foreground: COLORS.primary }, // TO_INT, MOD, ABS, ...
    { token: 'number', foreground: COLORS.primaryMedium },
    { token: 'string', foreground: COLORS.primaryDark },
    { token: 'comment', foreground: COLORS.neutral700, fontStyle: 'italic' },
    { token: 'tag', foreground: COLORS.primaryMediumDark }, // T#/DT#/%I/%Q
    // IL-specific (pre-existing rules, kept for IL editors)
    { token: 'literalCode', foreground: COLORS.primary },
    { token: 'typeKeyword', foreground: COLORS.primaryMediumDark },
    { token: 'label.il', foreground: COLORS.primary },
    { token: 'labelValue', foreground: COLORS.primaryMediumDark },
    { token: 'st.keyword', foreground: COLORS.primary },

    // ───────────── Semantic (STruC++ LSP)
    { token: 'variable', foreground: COLORS.primaryMediumDark }, // user variables
    { token: 'parameter', foreground: COLORS.primaryMediumDark, fontStyle: 'italic' }, // FB inputs / VAR_IN_OUT
    { token: 'function', foreground: COLORS.primary }, // functions / FB calls
    { token: 'method', foreground: COLORS.primary },
    { token: 'property', foreground: COLORS.primaryMediumDark },
    { token: 'namespace', foreground: COLORS.primaryDark, fontStyle: 'bold' }, // PROGRAM
    { token: 'class', foreground: COLORS.primaryDark, fontStyle: 'bold' }, // FUNCTION_BLOCK
    { token: 'interface', foreground: COLORS.primaryDark, fontStyle: 'bold' },
    { token: 'enum', foreground: COLORS.primaryDark, fontStyle: 'bold' },
    { token: 'enumMember', foreground: COLORS.primaryMedium },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#000000',
    'editor.selectionBackground': '#B4D0FE',
    'editorLineNumber.foreground': '#0464FB',
    'editorLineNumber.activeForeground': '#023C97',
    'editor.lineHighlightBackground': '#E8F0FE',
    'editorGutter.background': '#FFFFFF',
    'editorCursor.foreground': '#0464FB',
  },
}

const darkThemeData: Monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    // ───────────── Lexical (Monarch from basic-languages/st + il.ts)
    { token: 'keyword', foreground: COLORS.primary, fontStyle: 'bold' }, // IF/THEN/CASE/FOR/...
    { token: 'type', foreground: COLORS.primaryLight }, // BOOL/INT/REAL/...
    { token: 'constant', foreground: COLORS.primaryLight }, // TRUE/FALSE/NULL
    { token: 'predefined', foreground: COLORS.primary }, // TO_INT, MOD, ABS, ...
    { token: 'number', foreground: COLORS.primaryLight },
    { token: 'string', foreground: COLORS.neutral300 },
    { token: 'comment', foreground: COLORS.neutral600, fontStyle: 'italic' },
    { token: 'tag', foreground: COLORS.primaryLight }, // T#/DT#/%I/%Q
    // IL-specific (pre-existing rules, kept for IL editors)
    { token: 'literalCode', foreground: COLORS.primary },
    { token: 'typeKeyword', foreground: COLORS.primaryMediumDark },
    { token: 'label.il', foreground: COLORS.primary },
    { token: 'labelValue', foreground: COLORS.primaryMediumDark },
    { token: 'st.keyword', foreground: COLORS.primary },

    // ───────────── Semantic (STruC++ LSP)
    { token: 'variable', foreground: COLORS.primaryLight }, // user variables
    { token: 'parameter', foreground: COLORS.primaryLight, fontStyle: 'italic' }, // FB inputs / VAR_IN_OUT
    { token: 'function', foreground: COLORS.primary }, // functions / FB calls
    { token: 'method', foreground: COLORS.primary },
    { token: 'property', foreground: COLORS.primaryLight },
    { token: 'namespace', foreground: COLORS.primaryLight, fontStyle: 'bold' }, // PROGRAM
    { token: 'class', foreground: COLORS.primaryLight, fontStyle: 'bold' }, // FUNCTION_BLOCK
    { token: 'interface', foreground: COLORS.primaryLight, fontStyle: 'bold' },
    { token: 'enum', foreground: COLORS.primaryLight, fontStyle: 'bold' },
    { token: 'enumMember', foreground: COLORS.primaryLight },
  ],
  colors: {
    'editor.background': '#121316',
    'editor.foreground': '#D4D4D4',
    'editor.selectionBackground': '#0350C9',
    'editorLineNumber.foreground': '#0464FB',
    'editorLineNumber.activeForeground': '#023C97',
    'editor.lineHighlightBackground': '#2E2E2E',
    'editorGutter.background': '#121316',
    'editorCursor.foreground': '#0464FB',
  },
}

export { darkThemeData, lightThemeData }
