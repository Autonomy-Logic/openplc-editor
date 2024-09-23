import * as monaco from 'monaco-editor';

const lightThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'literalCode', foreground: '#0464FB' }, // Primary color for literal code in light theme
    { token: 'keyword', foreground: '#0346A6' }, // Darker shade for keywords in light theme
    { token: 'typeKeyword', foreground: '#023C97' }, // Slightly darker shade for type keywords in light theme
    { token: 'label.il', foreground: '#0464FB' }, // Primary color for label (identifier) in light theme
    { token: 'labelValue', foreground: '#023C97' } // Slightly darker shade for label (value) in light theme
  ],
  colors: {
    'editor.background': '#FFFFFF', // Editor background color in light theme
    'editor.foreground': '#000000', // Editor foreground color (text color) in light theme
    'editor.selectionBackground': '#B4D0FE', // Light blue for selection background in light theme
    'editorLineNumber.foreground': '#0464FB', // Primary color for line numbers in light theme
    'editorLineNumber.activeForeground': '#023C97', // Slightly darker shade for active line number in light theme
    'editor.lineHighlightBackground': '#E8F0FE', // Light blue for current line highlight in light theme
    'editorGutter.background': '#FFFFFF', // Editor gutter background color in light theme
    'editorCursor.foreground': '#0464FB', // Primary color for cursor in light theme
  },
};

const darkThemeData: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'literalCode', foreground: '#0464FB' }, // Primary color for literal code in dark theme
    { token: 'keyword', foreground: '#0099FF' }, // Darker shade for keywords in dark theme
    { token: 'typeKeyword', foreground: '#023C97' }, // Slightly darker shade for type keywords in dark theme
    { token: 'label.il', foreground: '#0464FB' }, // Primary color for label (identifier) in dark theme
    { token: 'labelValue', foreground: '#023C97' } // Slightly darker shade for label (value) in dark theme
  ],
  colors: {
    'editor.background': '#121316', // Darker background color in dark theme
    'editor.foreground': '#D4D4D4', // Light gray for text color in dark theme
    'editor.selectionBackground': '#0350C9', // Dark blue for selection background in dark theme
    'editorLineNumber.foreground': '#0464FB', // Primary color for line numbers in dark theme
    'editorLineNumber.activeForeground': '#023C97', // Slightly darker shade for active line number in dark theme
    'editor.lineHighlightBackground': '#2E2E2E', // Dark gray for current line highlight in dark theme
    'editorGutter.background': '#121316', // Editor gutter background color in dark theme
    'editorCursor.foreground': '#0464FB', // Primary color for cursor in dark theme
  },
};

export { darkThemeData, lightThemeData };
