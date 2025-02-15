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
       * Tokenize the label (sequence of characters followed by ':')
       */
      [/[^\s]+:/, { token: 'label' }], // Match any label ending with ':'

      // Recognize the & and &N symbols as keywords or special characters
      [/&N/, 'keyword'], // Match &N symbol as a keyword
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

      // Operators (excluding & and &N symbols)
      [/[=><!~?:|+\-*/^%]/, 'operator'], // Removed '&' and '&N' from operators

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
