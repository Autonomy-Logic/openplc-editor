import * as monaco from 'monaco-editor';

const lightThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'literalCode', foreground: '#D55E6C' }, // Color for literal code in light theme
    { token: 'keyword', foreground: '#007ACC' }, // Color for keywords in light theme
    { token: 'typeKeyword', foreground: '#C64C6F' }, // Color for type keywords in light theme
    { token: 'label.il', foreground: '#3C78D8' }, // Color for label (identifier) in light theme
    { token: 'labelValue', foreground: '#D76D77' } // Color for label (value) in light theme
  ],
  colors: {
    'editor.background': '#FFFFFF', // Editor background color in light theme
    'editor.foreground': '#000000', // Editor foreground color (text color) in light theme
    'editor.selectionBackground': '#B4D0FE', // Color of the editor selection in light theme
    'editorLineNumber.foreground': '#C0C0C0', // Color of the editor line numbers in light theme
    'editorLineNumber.activeForeground': '#007ACC', // Color of the active editor line number in light theme
    'editor.lineHighlightBackground': '#F0F0F0', // Background color of the current line highlight in light theme
    'editorGutter.background': '#FFFFFF', // Color of the editor gutter in light theme
    'editorCursor.foreground': '#000000', // Color of the editor cursor in light theme
  },
};

const darkThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'literalCode', foreground: '#FF9A8B' }, // Color for literal code in dark theme
    { token: 'keyword', foreground: '#9CDCFE' }, // Color for keywords in dark theme
    { token: 'typeKeyword', foreground: '#C586C0' }, // Color for type keywords in dark theme
    { token: 'label.il', foreground: '#569CD6' }, // Color for label (identifier) in dark theme
    { token: 'labelValue', foreground: '#9CDCFE' } // Color for label (value) in dark theme
  ],
  colors: {
    'editor.background': '#121316', // Editor background color in dark theme
    'editor.foreground': '#FFFFFF', // Editor foreground color (text color) in dark theme
    'editor.selectionBackground': '#5E6275', // Color of the editor selection in dark theme
    'editorLineNumber.foreground': '#6A9955', // Color of the editor line numbers in dark theme
    'editorLineNumber.activeForeground': '#9CDCFE', // Color of the active editor line number in dark theme
    'editor.lineHighlightBackground': '#2E3038', // Background color of the current line highlight in dark theme
    'editorGutter.background': '#121316', // Color of the editor gutter in dark theme
    'editorCursor.foreground': '#E8E5E5', // Color of the editor cursor in dark theme
  },
};

export { darkThemeData, lightThemeData };
