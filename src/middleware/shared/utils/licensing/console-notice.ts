const CONSOLE_WIDTH = 72
const RULE = '*'.repeat(CONSOLE_WIDTH)

/** Greedy word wrap; a word longer than `width` keeps its own line. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** `text` framed for the console between rules of asterisks, one entry per line, each no wider than the rules. */
export function frameConsoleNotice(text: string): string[] {
  return [RULE, ...wrapWords(text, CONSOLE_WIDTH), RULE]
}
