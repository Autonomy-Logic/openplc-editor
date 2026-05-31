import { TextDocument } from 'vscode';

export class SyntaxHighlighter {
  private static readonly KEYWORDS = [
    'PROGRAM', 'END_PROGRAM', 'FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
    'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'END_VAR', 'STRUCT', 'END_STRUCT',
    'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'CASE', 'OF', 'END_CASE',
    'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT',
    'EXIT', 'RETURN', 'CONTINUE'
  ];

  private static readonly TYPES = [
    'BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT',
    'REAL', 'LREAL', 'TIME', 'DATE', 'DT', 'TOD', 'STRING', 'BYTE', 'WORD', 'DWORD', 'LWORD'
  ];

  public static tokenize(document: TextDocument): any[] {
    const tokens: any[] = [];
    const text = document.getText();
    
    // Tokenize keywords
    this.KEYWORDS.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      let match;
      while ((match = regex.exec(text)) !== null) {
        tokens.push({
          line: document.positionAt(match.index).line,
          startCharacter: document.positionAt(match.index).character,
          length: keyword.length,
          tokenType: 0 // keyword
        });
      }
    });

    // Tokenize types
    this.TYPES.forEach(type => {
      const regex = new RegExp(`\\b${type}\\b`, 'g');
      let match;
      while ((match = regex.exec(text)) !== null) {
        tokens.push({
          line: document.positionAt(match.index).line,
          startCharacter: document.positionAt(match.index).character,
          length: type.length,
          tokenType: 1 // type
        });
      }
    });

    // Tokenize struct member variables (word.word pattern)
    const structMemberRegex = /\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.([a-zA-Z_][a-zA-Z0-9_]*)\\b/g;
    let structMatch;
    while ((structMatch = structMemberRegex.exec(text)) !== null) {
      // Highlight the member part (after the dot) as a variable
      const memberStart = structMatch.index + structMatch[1].length + 1; // +1 for the dot
      tokens.push({
        line: document.positionAt(memberStart).line,
        startCharacter: document.positionAt(memberStart).character,
        length: structMatch[2].length,
        tokenType: 2 // variable
      });
    }

    // Tokenize regular variables (but not struct members)
    const variableRegex = /\\b([a-zA-Z_][a-zA-Z0-9_]*)\\b/g;
    let varMatch;
    while ((varMatch = variableRegex.exec(text)) !== null) {
      // Skip if this is part of a struct member (already handled above)
      const fullMatch = varMatch[0];
      const matchEnd = varMatch.index + fullMatch.length;
      
      // Check if this variable is followed by a dot (part of struct access)
      const nextChar = text.charAt(matchEnd);
      if (nextChar === '.') continue;
      
      // Check if this variable is preceded by a dot (struct member)
      const prevChar = varMatch.index > 0 ? text.charAt(varMatch.index - 1) : '';
      if (prevChar === '.') continue;
      
      tokens.push({
        line: document.positionAt(varMatch.index).line,
        startCharacter: document.positionAt(varMatch.index).character,
        length: fullMatch.length,
        tokenType: 2 // variable
      });
    }

    // Tokenize numbers
    const numberRegex = /\\b[0-9]+(?:\\.[0-9]+)?\\b/g;
    let numMatch;
    while ((numMatch = numberRegex.exec(text)) !== null) {
      tokens.push({
        line: document.positionAt(numMatch.index).line,
        startCharacter: document.positionAt(numMatch.index).character,
        length: numMatch[0].length,
        tokenType: 3 // number
      });
    }

    // Tokenize strings
    const stringRegex = /".*?"/g;
    let strMatch;
    while ((strMatch = stringRegex.exec(text)) !== null) {
      tokens.push({
        line: document.positionAt(strMatch.index).line,
        startCharacter: document.positionAt(strMatch.index).character,
        length: strMatch[0].length,
        tokenType: 4 // string
      });
    }

    // Tokenize comments
    const commentRegex = /\\/\\/.*$/gm;
    let commentMatch;
    while ((commentMatch = commentRegex.exec(text)) !== null) {
      tokens.push({
        line: document.positionAt(commentMatch.index).line,
        startCharacter: document.positionAt(commentMatch.index).character,
        length: commentMatch[0].length,
        tokenType: 5 // comment
      });
    }

    return tokens;
  }
}