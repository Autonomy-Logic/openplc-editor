import * as monaco from 'monaco-editor';

const lightThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.foreground': '#333333',
    'editor.background': '#F9F9F9',
    'editorCursor.foreground': '#000000',
    'editor.lineHighlightBackground': '#E5E5E5',
    'editor.highlightBackground': '#FFFF00',
    'editorLineNumber.foreground': '#666666',
    'editor.selectionBackground': '#B0B0B0',
    'editorGutter.background': '#F9F9F9',
    'editorLineNumber.activeForeground': '#818181',
  },
};

const darkThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'variable', foreground: '#FFD700' },
    { token: 'operators', foreground: '#0EFE03' },
    { token: 'type', foreground: '#0EFE03' },
    { token: 'comment', foreground: '#377534' },
    { token: 'block-comment', foreground: '#377534' },
  ],
  colors: {
    'editor.background': '#1F2635', // editor background
    'editorCursor.foreground': '#E8E5E5', // cursor color
    'editor.lineHighlightBorder': '#FFFFFF', // current line highlight border color
    'editor.highlightBackground': '#00FF00',
    'editorLineNumber.foreground': '#A09AA0', // line number color without highlight
    'editor.selectionBackground': '#565F68', // selected content color, e.g., ctrl + a
    'editorLineNumber.activeForeground': '#FFFFFF', // highlighted line number color
    'editorBracketPairGuide.activeBackground1': '#2DD6B5',
  },
};

export { darkThemeData,lightThemeData };
