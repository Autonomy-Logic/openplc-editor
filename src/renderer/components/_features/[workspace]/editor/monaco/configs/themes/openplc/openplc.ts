import * as monaco from 'monaco-editor'

const lightThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#FFFFFF', // Editor background color.
    'editor.foreground': '#030303', // Editor foreground color <! The text that appears in the editor !>.
    'editor.selectionBackground': '#E5E5E5', // Color of the editor selection.
    'editorLineNumber.foreground': '#B4D0FE', // Color of the editor line numbers.
    'editorLineNumber.activeForeground': '#0464fb', // Color of the active editor line number.
    'editor.lineHighlightBackground': '#F9F9F9', // Background color of the current line highlight.
    'editorGutter.background': '#FFFFFF', // Color of the editor gutter <! The place where the line numbers go. Must be the same color as editor.background. !>.
    'editorCursor.foreground': '#000000', // Color of the editor cursor.
  },
}

const darkThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  /**
   * Review this!!!
   */
  rules: [{ token: 'label.il', foreground: '#023C97' }],
  colors: {
    'editor.background': '#121316', // Editor background color.
    'editor.foreground': '#FFFFFF', // Editor foreground color <! The text that appears in the editor !>.
    'editor.selectionBackground': '#5E6275', // Color of the editor selection.
    'editorLineNumber.foreground': '#023C97', // Color of the editor line numbers.
    'editorLineNumber.activeForeground': '#0464fb', // Color of the active editor line number.
    'editor.lineHighlightBackground': '#2E3038', // Background color of the current line highlight.
    'editorGutter.background': '#121316', // Color of the editor gutter <! The place where the line numbers go. Must be the same color as editor.background. !>.
    'editorCursor.foreground': '#E8E5E5', // Color of the editor cursor.
  },
}

export { darkThemeData, lightThemeData }
