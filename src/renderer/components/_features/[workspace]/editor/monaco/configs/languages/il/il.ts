import { languages } from 'monaco-editor';

export const conf: languages.LanguageConfiguration = {
  /**
   * Define the block comments settings
   */
  autoClosingPairs: [{ open: '(*', close: '*)' }],
  comments: {
    blockComment: ['(*', '*)'],
  },
  brackets: [], // Remove support for brackets
};

export const language: languages.IMonarchLanguage = {
  ignoreCase: true, // Remove case sensitivity
  tokenizer: {
    root: [
      /**
       * Review this!!!
       */
      [/[a-zA-Z]{3,}: /, 'label'], // Match any sequence of 3 or more non-digit characters followed by a colon followed by a whitespace and a non interrupt sequence of characters

      // Recognize the & symbol as a keyword or special character
      [/&/, 'keyword'], // Match & symbol as a keyword

      // Match keywords or identifiers
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        },
      ],
      { include: '@whitespace' },

      // Operators (excluding & symbol)
      [/[=><!~?:|+\-*/^%]/, 'operator'], // Removed '&' from operators

      // Numbers
      // Adjusted regex to support both comma and dot as decimal separators
      [/\d+([.,]\d+)?([eE][-+]?\d+)?/, 'number'], // Tokenize integer and floating-point numbers with comma or dot

      // Comments
      [/\(\*[\s\S]*?\*\)/, 'comment'], // Tokenize block comments

      // Remove strings
      // Removing support for quotes (strings or characters)
      [/"/, 'invalid'], // Treat anything inside quotes as invalid
      [/'/, 'invalid'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'], // Tokenize whitespace (spaces, tabs, line breaks)
    ],
  },
  keywords: [
    'LD', 'LDN', 'ST', 'STN', 'S', 'R', 'AND', 'ANDN', '&', '&N', 'OR', 'ORN',
    'XOR', 'XORN', 'NOT', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'GT', 'GE', 'EQ',
    'NE', 'LE', 'LT', 'JMP', 'JMPC', 'JMPN', 'CAL', 'CALC', 'CALN', 'RET',
    'RETC', 'RETN',
  ],
  brackets: [], // Ensure brackets are not recognized
};
