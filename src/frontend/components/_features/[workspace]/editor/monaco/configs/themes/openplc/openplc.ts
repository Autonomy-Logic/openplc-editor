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
// The palette keeps OpenPLC's app blue for control-flow keywords
// (IF/WHILE/PROGRAM/…) so the editor still reads as "ours", and
// borrows VS Code's classic role colours for the rest — strings yellow,
// comments green, numbers light green, types teal, functions ochre.
// That balance gives developers the structural cues a single-hue theme
// can't (literal vs identifier vs comment vs flow), without dropping
// the brand colour on the most prominent token class.

const COLORS = {
  // App brand (kept for keyword / constant in both themes)
  brand: '0464FB',
  brandMedium: '0350C9',
  // Dark-theme role palette (VS Code Dark+ inspired)
  darkBrandKeyword: '569CD6', // softer keyword blue for dark backgrounds
  darkType: '4EC9B0', // teal — BOOL/INT/REAL, user types
  darkString: 'CE9178', // yellow-orange
  darkNumber: 'B5CEA8', // light green
  darkComment: '6A9955', // green
  darkFunction: 'DCDCAA', // ochre — predefined + user functions
  darkVariable: '9CDCFE', // light cyan — variables/parameters/properties
  darkEnumMember: '4FC1FF', // bright cyan — enum literals
  // Light-theme role palette
  lightType: '267F99', // teal
  lightString: 'A31515', // classic VS Code red
  lightNumber: '098658', // dark green
  lightComment: '008000', // green
  lightFunction: '795E26', // ochre
  lightVariable: '001080', // dark navy — variables/parameters/properties
  lightEnumMember: '0070C1', // medium blue
} as const

const lightThemeData: Monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    // ───────────── Lexical (Monarch from basic-languages/st + il.ts)
    { token: 'keyword', foreground: COLORS.brand, fontStyle: 'bold' }, // IF/THEN/CASE/FOR/...
    { token: 'type', foreground: COLORS.lightType }, // BOOL/INT/REAL/...
    { token: 'constant', foreground: COLORS.brandMedium }, // TRUE/FALSE/NULL
    { token: 'predefined', foreground: COLORS.lightFunction }, // TO_INT, MOD, ABS, ...
    { token: 'number', foreground: COLORS.lightNumber },
    { token: 'string', foreground: COLORS.lightString },
    { token: 'comment', foreground: COLORS.lightComment, fontStyle: 'italic' },
    { token: 'tag', foreground: COLORS.lightNumber }, // T#/DT#/%I/%Q — literals, share number tone
    // IL-specific (pre-existing rules, kept for IL editors)
    { token: 'literalCode', foreground: COLORS.brand },
    { token: 'typeKeyword', foreground: COLORS.lightType },
    { token: 'label.il', foreground: COLORS.brand },
    { token: 'labelValue', foreground: COLORS.lightType },
    { token: 'st.keyword', foreground: COLORS.brand },

    // ───────────── Semantic (STruC++ LSP)
    { token: 'variable', foreground: COLORS.lightVariable }, // user variables
    { token: 'parameter', foreground: COLORS.lightVariable, fontStyle: 'italic' }, // FB inputs / VAR_IN_OUT
    { token: 'function', foreground: COLORS.lightFunction }, // functions / FB calls
    { token: 'method', foreground: COLORS.lightFunction },
    { token: 'property', foreground: COLORS.lightVariable },
    { token: 'namespace', foreground: COLORS.lightType, fontStyle: 'bold' }, // PROGRAM
    { token: 'class', foreground: COLORS.lightType, fontStyle: 'bold' }, // FUNCTION_BLOCK
    { token: 'interface', foreground: COLORS.lightType, fontStyle: 'bold' },
    { token: 'enum', foreground: COLORS.lightType, fontStyle: 'bold' },
    { token: 'enumMember', foreground: COLORS.lightEnumMember },
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
    { token: 'keyword', foreground: COLORS.darkBrandKeyword, fontStyle: 'bold' }, // IF/THEN/CASE/FOR/...
    { token: 'type', foreground: COLORS.darkType }, // BOOL/INT/REAL/...
    { token: 'constant', foreground: COLORS.darkBrandKeyword }, // TRUE/FALSE/NULL
    { token: 'predefined', foreground: COLORS.darkFunction }, // TO_INT, MOD, ABS, ...
    { token: 'number', foreground: COLORS.darkNumber },
    { token: 'string', foreground: COLORS.darkString },
    { token: 'comment', foreground: COLORS.darkComment, fontStyle: 'italic' },
    { token: 'tag', foreground: COLORS.darkNumber }, // T#/DT#/%I/%Q — literals, share number tone
    // IL-specific (pre-existing rules, kept for IL editors)
    { token: 'literalCode', foreground: COLORS.darkBrandKeyword },
    { token: 'typeKeyword', foreground: COLORS.darkType },
    { token: 'label.il', foreground: COLORS.darkBrandKeyword },
    { token: 'labelValue', foreground: COLORS.darkType },
    { token: 'st.keyword', foreground: COLORS.darkBrandKeyword },

    // ───────────── Semantic (STruC++ LSP)
    { token: 'variable', foreground: COLORS.darkVariable }, // user variables
    { token: 'parameter', foreground: COLORS.darkVariable, fontStyle: 'italic' }, // FB inputs / VAR_IN_OUT
    { token: 'function', foreground: COLORS.darkFunction }, // functions / FB calls
    { token: 'method', foreground: COLORS.darkFunction },
    { token: 'property', foreground: COLORS.darkVariable },
    { token: 'namespace', foreground: COLORS.darkType, fontStyle: 'bold' }, // PROGRAM
    { token: 'class', foreground: COLORS.darkType, fontStyle: 'bold' }, // FUNCTION_BLOCK
    { token: 'interface', foreground: COLORS.darkType, fontStyle: 'bold' },
    { token: 'enum', foreground: COLORS.darkType, fontStyle: 'bold' },
    { token: 'enumMember', foreground: COLORS.darkEnumMember },
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
