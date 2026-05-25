// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Register the Structured Text language with Monaco.
 *
 * Unlike every other language in this folder, ST does NOT install a
 * Monarch tokenizer — colorisation comes from the STruC++ LSP
 * worker via the semantic-tokens protocol (booted in
 * `src/frontend/services/st-lsp/boot.ts`).  Keeping the language
 * registered (with bracket / comment / indentation rules) lets the
 * Monaco editor mount before the worker is ready; tokens appear as
 * soon as the LSP responds.
 *
 * The previous hand-written Monarch tokenizer + dynamic
 * `updateLocalVariablesInTokenizer` / `updateDataTypeVariablesInTokenizer`
 * / `updateEnumValuesInTokenizer` machinery is gone — LSP semantic
 * tokens cover what they were doing (and a great deal more).
 */

import * as monaco from 'monaco-editor'

const LANGUAGE_ID = 'st'

const conf: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
    blockComment: ['(*', '*)'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '(*', close: '*)', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string'] },
    { open: '/*', close: '*/', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: "'", close: "'" },
  ],
  wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/,
  indentationRules: {
    increaseIndentPattern: /^\s*(IF|FOR|WHILE|REPEAT|CASE|FUNCTION|FUNCTION_BLOCK|PROGRAM|VAR|STRUCT|CLASS|METHOD)\b/i,
    decreaseIndentPattern:
      /^\s*(END_IF|END_FOR|END_WHILE|END_REPEAT|END_CASE|END_FUNCTION|END_FUNCTION_BLOCK|END_PROGRAM|END_VAR|END_STRUCT|END_CLASS|END_METHOD)\b/i,
  },
}

if (!monaco.languages.getLanguages().some((l) => l.id === LANGUAGE_ID)) {
  monaco.languages.register({
    id: LANGUAGE_ID,
    extensions: ['.st'],
    aliases: ['Structured Text', 'st'],
    mimetypes: ['text/structured-text'],
  })
}
monaco.languages.setLanguageConfiguration(LANGUAGE_ID, conf)
