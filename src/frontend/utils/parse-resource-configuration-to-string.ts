import type { PLCInstance, PLCTask } from '../../middleware/shared/ports/types'

const DEFAULT_INTERVAL = 'T#20ms'
const DEFAULT_PRIORITY = 1

export function parseResourceConfigurationToString(taskList: PLCTask[], instanceList: PLCInstance[]): string {
  if (taskList.length === 0 && instanceList.length === 0) {
    return '(* No tasks or program instances declared. *)'
  }

  const usedTasks: PLCTask[] = [...taskList].sort(
    (a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY),
  )

  let out = 'CONFIGURATION Config0\n'
  out += '\tRESOURCE Res0 ON PLC\n\n'

  for (const task of usedTasks) {
    const interval = (task.interval ?? '').trim() || DEFAULT_INTERVAL
    const priority = task.priority ?? DEFAULT_PRIORITY
    out += `\t\tTASK ${task.name}(INTERVAL := ${interval}, PRIORITY := ${priority});\n`
  }

  if (usedTasks.length) out += '\n'

  for (const instance of instanceList) {
    out += `\t\tPROGRAM ${instance.name} WITH ${instance.task} : ${instance.program};\n`
  }

  out += '\tEND_RESOURCE\n'
  out += 'END_CONFIGURATION'

  return out
}
