/** Shown when a licensable device holds no license: in the license dialogs and, after each upload, on the console. */
export const DEMO_MODE_NOTICE =
  'This device requires a license and no license was found. The application will run in DEMO mode.'

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

/** The demo-mode notice framed for the console, one entry per line, each no wider than the rules. */
export function demoModeConsoleLines(): string[] {
  return [RULE, ...wrapWords(DEMO_MODE_NOTICE, CONSOLE_WIDTH), RULE]
}
