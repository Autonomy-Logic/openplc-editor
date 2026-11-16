import { serializePouToText } from '../../../../frontend/utils/PLC/pou-text-serializer'
import { sanitizePou } from '../../../../frontend/utils/save-project'
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { type ParsedProjectData, parseProjectFiles } from '../../utils/parse-project-files'
import {
  buildProjectSnapshot,
  parseProjectSnapshot,
  toWriteProjectFiles,
  type ParsedProjectSnapshot,
} from '../project-snapshot-archive'

const MAIN_PATH = 'pous/programs/main.st'

const ARCHIVED_MAIN = [
  'PROGRAM main',
  'VAR',
  '  bFirstScan : BOOL := TRUE;',
  '  Q1 AT %QX0.0 : BOOL;',
  '',
  'IF bFirstScan THEN',
  '  Q1 := TRUE;',
  '  bFirstScan := FALSE;',
  'END_IF;',
  'END_PROGRAM',
].join('\n')

const PROJECT_JSON = JSON.stringify({
  meta: { name: 'Retrieved', type: 'plc-project' },
  data: {
    dataTypes: [],
    pous: [],
    configuration: {
      resource: {
        tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
        instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
        globalVariables: [],
      },
    },
    libraries: [],
    debugVariables: { global: [], pous: {} },
  },
})

const DEVICE_CONFIG = JSON.stringify({
  deviceBoard: 'OpenPLC Runtime v4',
  communicationPort: '',
  runtimeIpAddress: '192.168.1.50',
  selectedPlatformOptions: {},
})

/** Parses the project files of a snapshot, with `mainContent` in place of `main.st` when given. */
const parseFiles = (snapshot: ParsedProjectSnapshot, mainContent?: string): ParsedProjectData => {
  const files = toWriteProjectFiles(snapshot, 'Retrieved')
  const pouFiles =
    mainContent === undefined
      ? files.pouFiles
      : files.pouFiles.map((file) => (file.relativePath === MAIN_PATH ? { ...file, content: mainContent } : file))
  return parseProjectFiles(
    files.projectPath,
    files.projectJson,
    files.deviceConfig ?? '',
    files.pinMapping ?? '',
    pouFiles,
    files.serverFiles,
    files.remoteDeviceFiles,
    files.libraryManifest ?? '',
    files.dataTypeFiles,
  )
}

/** The POU `main` of a parse result. */
const mainOf = (parsed: ParsedProjectData): PLCPou => {
  const pou = parsed.projectData.pous.find((candidate) => candidate.name === 'main')
  if (!pou) throw new Error('POU "main" missing from the parse result')
  return pou
}

describe('AS1: a retrieved project whose POU has no END_VAR', () => {
  let opened: ParsedProjectData
  let savedFiles: string[]

  beforeAll(async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { archive } = await buildProjectSnapshot({
        files: new Map([
          ['project.json', PROJECT_JSON],
          ['devices/configuration.json', DEVICE_CONFIG],
          ['devices/pin-mapping.json', '{}'],
          [MAIN_PATH, ARCHIVED_MAIN],
        ]),
        projectName: 'Retrieved',
        editorVersion: '4.2.0',
        uploadedBy: 'op',
        timestamp: '2026-08-31T12:00:00.000Z',
      })
      const snapshot = await parseProjectSnapshot(archive)
      opened = parseFiles(snapshot)

      savedFiles = []
      let current = opened
      for (let cycle = 0; cycle < 3; cycle++) {
        const saved = serializePouToText(sanitizePou(mainOf(current), undefined))
        savedFiles.push(saved)
        current = parseFiles(snapshot, saved)
      }
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('opens main marked unparsed', () => {
    expect(mainOf(opened).variablesTextUnparsed).toBe(true)
  })

  it('keeps the declarations of main in its variables text', () => {
    expect(mainOf(opened).variablesText).toContain('Q1 AT %QX0.0 : BOOL;')
  })

  it('does not move the declarations of main into its body', () => {
    expect(String(mainOf(opened).body.value)).not.toContain('Q1 AT %QX0.0 : BOOL;')
  })

  it('warns about main', () => {
    expect(opened.warnings).toEqual(expect.arrayContaining([expect.stringContaining('main')]))
  })

  it('writes the same main.st in each of 3 save and reopen cycles', () => {
    expect(savedFiles).toHaveLength(3)
    expect(savedFiles[1]).toBe(savedFiles[0])
    expect(savedFiles[2]).toBe(savedFiles[0])
  })

  it("keeps every non-blank line of the archive's main.st exactly once, in order", () => {
    const archivedLines = ARCHIVED_MAIN.split('\n').filter((line) => line.trim() !== '')
    const archived = new Set(archivedLines)
    const keptLines = savedFiles[0].split('\n').filter((line) => archived.has(line))

    expect(keptLines).toEqual(archivedLines)
  })
})
