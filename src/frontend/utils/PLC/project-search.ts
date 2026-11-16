// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/** One list is the whole result: the panel's count is its length, so it cannot claim rows the tree does not show. */

import type {
  PLCDataType,
  PLCGlobalVariableList,
  PLCPou,
  PLCProjectData,
  PLCVariable,
  PouType,
} from '../../../middleware/shared/ports/types'

export type SearchElementFilter = 'data-type' | 'function' | 'function-block' | 'program' | 'configuration'

export type ProjectSearchOptions = {
  caseSensitive: boolean
  regularExpression: boolean
  elementFilters: SearchElementFilter[]
}

export type PouLanguage = 'il' | 'st' | 'ld' | 'fbd' | 'sfc' | 'python' | 'cpp'

export type SearchMatchContainer =
  | { kind: 'pou'; name: string; pouType: PouType; language: PouLanguage }
  | { kind: 'data-type'; name: string; derivation: 'array' | 'enumerated' | 'structure' }
  | { kind: 'global-variable-list'; name: string }
  | { kind: 'resource'; section: 'global-variable' | 'task' | 'instance' }
  | { kind: 'server'; name: string }
  | { kind: 'remote-device'; name: string }

export type ProjectSearchMatch = {
  id: string
  container: SearchMatchContainer
  field: 'name' | 'variable' | 'body'
  /** 1-based, textual bodies only. */
  line?: number
  /** 1-based, textual bodies only. */
  column?: number
  /** Graphical bodies: the element that holds the matched string. */
  nodeId?: string
  rungId?: string
  /** What the row shows: the line for a textual body, the matched string otherwise. */
  preview: string
  /** 1-based position of THIS occurrence inside `preview`, so a row highlights its own. */
  previewColumn: number
  /** Length of the matched text, which a regular expression makes variable. */
  length: number
}

export type ProjectSearchResult =
  | { ok: true; matches: ProjectSearchMatch[] }
  | { ok: false; reason: 'invalid-regular-expression' }

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const TEXTUAL_LANGUAGES: ReadonlySet<string> = new Set(['st', 'il', 'sfc', 'python', 'cpp'])

/**
 * Keys whose strings describe the graph rather than the program: matching them would
 * answer a search for `block` or for a hexadecimal id with rows nobody wrote.
 */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  'id',
  'parentId',
  'type',
  'source',
  'target',
  'sourceHandle',
  'targetHandle',
  'handleId',
  'className',
  'style',
  'measured',
  'position',
  'positionAbsolute',
  'numericId',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isPouLanguage = (language: string): language is PouLanguage =>
  language === 'il' ||
  language === 'st' ||
  language === 'ld' ||
  language === 'fbd' ||
  language === 'sfc' ||
  language === 'python' ||
  language === 'cpp'

type Matcher = (text: string) => Array<{ index: number; length: number }>

const createMatcher = (query: string, options: ProjectSearchOptions): Matcher | null => {
  const pattern = options.regularExpression ? query : escapeRegExp(query)
  const flags = options.caseSensitive ? 'g' : 'gi'
  let probe: RegExp
  try {
    probe = new RegExp(pattern, flags)
  } catch {
    return null
  }

  return (text: string) => {
    const regex = new RegExp(probe.source, probe.flags)
    const found: Array<{ index: number; length: number }> = []
    let match = regex.exec(text)
    while (match !== null) {
      // An empty match has nothing to show and would never advance on its own.
      if (match[0].length === 0) regex.lastIndex += 1
      else found.push({ index: match.index, length: match[0].length })
      match = regex.exec(text)
    }
    return found
  }
}

const allows = (filters: SearchElementFilter[], filter: SearchElementFilter): boolean =>
  filters.length === 0 || filters.includes(filter)

class MatchCollector {
  private readonly matches: ProjectSearchMatch[] = []

  constructor(private readonly matcher: Matcher) {}

  get result(): ProjectSearchMatch[] {
    return this.matches
  }

  collectValue(text: string, container: SearchMatchContainer, field: ProjectSearchMatch['field']): void {
    for (const occurrence of this.matcher(text)) {
      this.matches.push({
        id: `${this.matches.length}`,
        container,
        field,
        column: occurrence.index + 1,
        preview: text,
        previewColumn: occurrence.index + 1,
        length: occurrence.length,
      })
    }
  }

  collectText(text: string, container: SearchMatchContainer): void {
    const lines = text.split(/\r?\n/)
    lines.forEach((line, lineIndex) => {
      const indent = line.length - line.trimStart().length
      for (const occurrence of this.matcher(line)) {
        this.matches.push({
          id: `${this.matches.length}`,
          container,
          field: 'body',
          line: lineIndex + 1,
          column: occurrence.index + 1,
          preview: line.trim(),
          previewColumn: occurrence.index - indent + 1,
          length: occurrence.length,
        })
      }
    })
  }

  collectGraphical(value: unknown, container: SearchMatchContainer): void {
    const walk = (node: unknown, nodeId: string | undefined, rungId: string | undefined, isRoot: boolean): void => {
      if (typeof node === 'string') {
        for (const occurrence of this.matcher(node)) {
          this.matches.push({
            id: `${this.matches.length}`,
            container,
            field: 'body',
            nodeId,
            rungId,
            column: occurrence.index + 1,
            preview: node,
            previewColumn: occurrence.index + 1,
            length: occurrence.length,
          })
        }
        return
      }
      if (Array.isArray(node)) {
        node.forEach((entry) => walk(entry, nodeId, rungId, false))
        return
      }
      if (!isRecord(node)) return

      const id = typeof node.id === 'string' ? node.id : undefined
      const nextRungId = id !== undefined && Array.isArray(node.nodes) ? id : rungId
      const nextNodeId = id !== undefined && typeof node.type === 'string' ? id : nodeId

      for (const [key, entry] of Object.entries(node)) {
        if (STRUCTURAL_KEYS.has(key)) continue
        // A block keeps its signature object under `variant`; everywhere else it is a shape name.
        if (key === 'variant' && typeof entry === 'string') continue
        // The root's own name is the container's name, already reported next to it.
        if (isRoot && key === 'name') continue
        walk(entry, nextNodeId, nextRungId, false)
      }
    }

    walk(value, undefined, undefined, true)
  }
}

const variableTexts = (variable: PLCVariable): string[] =>
  [variable.name, variable.type.value, variable.location, variable.documentation].filter(
    (text): text is string => typeof text === 'string' && text.length > 0,
  )

const dataTypeTexts = (dataType: PLCDataType): string[] => {
  switch (dataType.derivation) {
    case 'structure':
      return dataType.variable.flatMap((member) => [member.name, member.type.value])
    case 'enumerated':
      return dataType.values.map((value) => value.description)
    case 'array':
      return [dataType.baseType.value, ...dataType.dimensions.map((entry) => entry.dimension)]
  }
}

const pouFilter = (pouType: PouType): SearchElementFilter => pouType

const collectPou = (collector: MatchCollector, pou: PLCPou): void => {
  const language = isPouLanguage(pou.body.language) ? pou.body.language : 'st'
  const container: SearchMatchContainer = { kind: 'pou', name: pou.name, pouType: pou.pouType, language }

  collector.collectValue(pou.name, container, 'name')
  for (const variable of pou.interface?.variables ?? []) {
    for (const text of variableTexts(variable)) {
      collector.collectValue(text, container, 'variable')
    }
  }

  if (TEXTUAL_LANGUAGES.has(language)) {
    if (typeof pou.body.value === 'string') collector.collectText(pou.body.value, container)
    return
  }
  collector.collectGraphical(pou.body.value, container)
}

const collectGlobalVariableList = (collector: MatchCollector, list: PLCGlobalVariableList): void => {
  const container: SearchMatchContainer = { kind: 'global-variable-list', name: list.name }
  collector.collectValue(list.name, container, 'name')
  for (const variable of list.variables) {
    for (const text of variableTexts(variable)) {
      collector.collectValue(text, container, 'variable')
    }
  }
}

export const searchProject = (
  data: PLCProjectData,
  query: string,
  options: ProjectSearchOptions,
): ProjectSearchResult => {
  const matcher = createMatcher(query, options)
  if (matcher === null) return { ok: false, reason: 'invalid-regular-expression' }

  const collector = new MatchCollector(matcher)
  const { elementFilters } = options

  for (const pou of data.pous) {
    if (!allows(elementFilters, pouFilter(pou.pouType))) continue
    collectPou(collector, pou)
  }

  if (allows(elementFilters, 'data-type')) {
    for (const dataType of data.dataTypes) {
      if (!dataType) continue
      const container: SearchMatchContainer = {
        kind: 'data-type',
        name: dataType.name,
        derivation: dataType.derivation,
      }
      collector.collectValue(dataType.name, container, 'name')
      for (const text of dataTypeTexts(dataType)) {
        collector.collectValue(text, container, 'variable')
      }
    }
  }

  if (allows(elementFilters, 'configuration')) {
    for (const list of data.globalVariableLists ?? []) {
      collectGlobalVariableList(collector, list)
    }

    const resource = data.configurations.resource
    for (const variable of resource.globalVariables) {
      const container: SearchMatchContainer = { kind: 'resource', section: 'global-variable' }
      for (const text of variableTexts(variable)) {
        collector.collectValue(text, container, 'variable')
      }
    }
    for (const task of resource.tasks) {
      const container: SearchMatchContainer = { kind: 'resource', section: 'task' }
      collector.collectValue(task.name, container, 'name')
      collector.collectValue(task.interval, container, 'variable')
    }
    for (const instance of resource.instances) {
      const container: SearchMatchContainer = { kind: 'resource', section: 'instance' }
      collector.collectValue(instance.name, container, 'name')
      collector.collectValue(instance.program, container, 'variable')
      collector.collectValue(instance.task, container, 'variable')
    }

    for (const server of data.servers ?? []) {
      const container: SearchMatchContainer = { kind: 'server', name: server.name }
      collector.collectValue(server.name, container, 'name')
      collector.collectGraphical(server, container)
    }
    for (const device of data.remoteDevices ?? []) {
      const container: SearchMatchContainer = { kind: 'remote-device', name: device.name }
      collector.collectValue(device.name, container, 'name')
      collector.collectGraphical(device, container)
    }
  }

  return { ok: true, matches: collector.result }
}
