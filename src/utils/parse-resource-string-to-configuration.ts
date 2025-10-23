import { PLCInstance, PLCTask } from '@root/types/PLC/open-plc'

const DEFAULT_TRIGGERING = 'Cyclic'
const IDENTIFIER = '[A-Za-z][A-Za-z0-9_-]*'

const taskLineRegex = new RegExp(`^\\s*TASK\\s+(?<name>${IDENTIFIER})\\s*\\((?<params>.*?)\\)\\s*;`, 'i')
const instanceLineRegex = new RegExp(
  `^\\s*PROGRAM\\s+(?<name>${IDENTIFIER})\\s+WITH\\s+(?<task>${IDENTIFIER})\\s*:\\s*(?<program>${IDENTIFIER})\\s*;`,
  'i',
)

const guessTaskErrorReason = (line: string): string => {
  const trimmed = line.trim().toLowerCase()

  if (!trimmed.startsWith('task')) {
    return 'Declaration must start with the "TASK" keyword'
  }

  if (!line.includes('(') || !line.includes(')')) {
    return 'Task parameters must be enclosed in parentheses ()'
  }

  if (!line.trim().endsWith(';')) {
    return 'Missing semicolon (;) at the end of the declaration'
  }

  if (trimmed.includes('interval') && !trimmed.includes(':=')) {
    return 'Assignment operator ":=" not found for a parameter'
  }

  if (/[^A-Za-z0-9_#\s:;=(),-]/.test(line)) {
    return 'Invalid or unsupported characters found'
  }

  return 'Unrecognized declaration format'
}

const guessInstanceErrorReason = (line: string): string => {
  const trimmed = line.trim()
  const lower = trimmed.toLowerCase()

  if (!lower.startsWith('program')) {
    return 'Declaration must start with the "PROGRAM" keyword'
  }

  if (!/with/i.test(trimmed)) {
    return 'Missing "WITH" keyword to associate a task'
  }

  if (!trimmed.includes(':')) {
    return 'Missing colon (:) between the task and the program type'
  }

  if (!trimmed.endsWith(';')) {
    return 'Missing semicolon (;) at the end of the declaration'
  }
  if (/[^A-Za-z0-9_\-\s:;]/.test(trimmed)) {
    return 'Invalid or unsupported characters found'
  }

  return 'Unrecognized declaration format'
}

export function parseResourceStringToConfiguration(configString: string): {
  tasks: PLCTask[]
  instances: PLCInstance[]
} {
  const tasks: PLCTask[] = []
  const instances: PLCInstance[] = []

  const taskNamesSeen = new Set<string>()
  const instanceNamesSeen = new Set<string>()

  const instanceLines: Record<string, number> = {}

  const lines = configString.split(/\r?\n/)

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1
    const lineWithoutComment = rawLine.replace(/\(\*.*?\*\)/g, '').trim()

    if (lineWithoutComment === '') {
      return
    }

    /* ---- TASK --------------------------------------------------------- */
    if (lineWithoutComment.toUpperCase().startsWith('TASK')) {
      const match = lineWithoutComment.match(taskLineRegex)

      if (match?.groups) {
        const { name, params } = match.groups

        const nameLower = name.toLowerCase()

        if (nameLower === 'task') {
          throw new Error(
            `Invalid task name on line ${lineNumber}: "${name}" is a reserved keyword and cannot be used as a task name.`,
          )
        }

        if (taskNamesSeen.has(nameLower)) {
          throw new Error(`Duplicate TASK name on line ${lineNumber}: "${name}" was already declared.`)
        }

        taskNamesSeen.add(nameLower)

        const taskObj: Partial<PLCTask> & { name: string } = {
          name,
          triggering: DEFAULT_TRIGGERING,
          interval: '',
          priority: 0,
        }

        if (params) {
          params.split(',').forEach((param) => {
            const [key, value] = param.split(':=').map((p) => p.trim())
            const upperKey = key?.toUpperCase()
            if (upperKey === 'INTERVAL') taskObj.interval = value
            else if (upperKey === 'PRIORITY') taskObj.priority = parseInt(value, 10)
          })
        }

        tasks.push(taskObj as PLCTask)

        return
      }

      // Regex failed
      throw new Error(
        `Syntax error on line ${lineNumber}: "${lineWithoutComment}". Possible cause: ${guessTaskErrorReason(
          rawLine,
        )}.`,
      )
    }

    /* ---- PROGRAM INSTANCE -------------------------------------------- */
    if (lineWithoutComment.toUpperCase().startsWith('PROGRAM')) {
      const match = lineWithoutComment.match(instanceLineRegex)

      if (match?.groups) {
        const { name, task, program } = match.groups

        const nameLower = name.toLowerCase()

        if (instanceNamesSeen.has(nameLower)) {
          throw new Error(`Duplicate PROGRAM name on line ${lineNumber}: "${name}" was already declared.`)
        }
        instanceNamesSeen.add(nameLower)

        instances.push({ name, task, program })
        instanceLines[name] = lineNumber

        return
      }

      throw new Error(
        `Syntax error on line ${lineNumber}: "${lineWithoutComment}". Possible cause: ${guessInstanceErrorReason(
          rawLine,
        )}.`,
      )
    }

    if (/^(CONFIGURATION|RESOURCE|END_RESOURCE|END_CONFIGURATION)/i.test(lineWithoutComment)) {
      return
    }

    throw new Error(
      `Syntax error on line ${lineNumber}: "${lineWithoutComment}". Unrecognized or misplaced declaration.`,
    )
  })

  const declaredTaskNames = new Set(tasks.map((t) => t.name.toLowerCase()))

  for (const instance of instances) {
    if (!declaredTaskNames.has(instance.task.toLowerCase())) {
      const ln = instanceLines[instance.name] ?? '?'
      throw new Error(
        `Task "${instance.task}" referenced in PROGRAM "${instance.name}" on line ${ln} is not declared above.`,
      )
    }
  }

  return { tasks, instances }
}
