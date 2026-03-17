import { PLCInstance } from '@root/types/PLC/open-plc'

const IDENTIFIER = '[A-Za-z][A-Za-z0-9_-]*'

const instanceLineRegex = new RegExp(
  `^\\s*PROGRAM\\s+(?<name>${IDENTIFIER})\\s+WITH\\s+(?<task>${IDENTIFIER})\\s*:\\s*(?<program>${IDENTIFIER})\\s*;`,
  'i',
)

const guessInstanceErrorReason = (line: string): string => {
  const trimmedLine = line.trim()
  const lower = trimmedLine.toLowerCase()

  if (!lower.startsWith('program')) {
    return 'declaration must start with the "PROGRAM" keyword'
  }

  if (!/with/i.test(trimmedLine)) {
    return 'missing "WITH" keyword to associate a task'
  }

  if (!trimmedLine.includes(':')) {
    return 'missing colon (:) between the task and the program type'
  }

  if (!trimmedLine.endsWith(';')) {
    return 'missing semicolon (;) at the end of the declaration'
  }

  if (/[^A-Za-z0-9_\-\s:;]/.test(trimmedLine)) {
    return 'invalid or unsupported characters found'
  }

  return 'unrecognized declaration format'
}

export function parseInstanceConfigurationString(config: string): PLCInstance[] {
  const instances: PLCInstance[] = []

  const lines = config.split(/\r?\n/)

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1

    const uncommented = rawLine.replace(/\(\*.*?\*\)/g, '').trim()

    if (uncommented === '') {
      return
    }

    if (/^(CONFIGURATION|RESOURCE|END_RESOURCE|TASK|END_CONFIGURATION)/i.test(uncommented)) {
      return
    }

    const match = uncommented.match(instanceLineRegex)

    if (match?.groups) {
      const { name, task, program } = match.groups

      instances.push({ name, task, program })

      return
    }

    throw new Error(
      `Syntax error on line ${lineNumber}: "${uncommented}". Possible cause: ${guessInstanceErrorReason(uncommented)}.`,
    )
  })

  return instances
}
