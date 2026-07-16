import type { RawProjectFile } from '../../../../middleware/shared/ports/project-port'
import { parseProjectFiles } from '../parse-project-files'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid project.json content. */
function makeProjectJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    meta: { name: 'TestProject', type: 'plc-project' },
    data: {
      dataTypes: [],
      pous: [],
      configuration: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [],
        },
      },
      ...overrides,
    },
  })
}

/** Minimal valid device configuration JSON. */
function makeDeviceConfig() {
  return JSON.stringify({
    deviceBoard: 'uno',
    communicationPort: 'COM1',
    compileOnly: false,
  })
}

/** Minimal valid pin mapping JSON. */
function makePinMapping() {
  return JSON.stringify([{ pin: 'D2', pinType: 'digitalInput', address: '%IX0.0' }])
}

/** Build a minimal valid .st POU file content. */
function makeStContent(pouName: string, pouType: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK', returnType?: string) {
  const declaration = returnType ? `${pouType} ${pouName} : ${returnType}` : `${pouType} ${pouName}`
  const endKeyword =
    pouType === 'PROGRAM' ? 'END_PROGRAM' : pouType === 'FUNCTION' ? 'END_FUNCTION' : 'END_FUNCTION_BLOCK'
  return `${declaration}\nVAR\nEND_VAR\n\n${endKeyword}`
}

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('parseProjectFiles — basic', () => {
  it('parses a minimal valid project with no POU files', () => {
    const result = parseProjectFiles('/my/project', makeProjectJson(), makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.meta.name).toBe('TestProject')
    expect(result.meta.type).toBe('plc-project')
    expect(result.meta.path).toBe('/my/project')
    expect(result.projectData.pous).toEqual([])
    expect(result.deviceConfiguration).toBeDefined()
    expect(result.devicePinMapping).toBeDefined()
    expect(result.warnings).toBeUndefined()
  })

  it('parses ST POU files correctly', () => {
    const pouFiles: RawProjectFile[] = [
      { relativePath: 'pous/programs/Main.st', content: makeStContent('Main', 'PROGRAM') },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].name).toBe('Main')
    expect(result.projectData.pous[0].pouType).toBe('program')
  })
})

// ---------------------------------------------------------------------------
// Legacy alias → single-field location migration (foldLegacyVariableAliases)
// ---------------------------------------------------------------------------

describe('parseProjectFiles — legacy alias migration', () => {
  it('folds a JSON POU variable with a non-empty alias into its location', () => {
    // Old two-field model: an alias-bound variable stored the resolved
    // %address in `location` and the alias name in `alias`.  The single-
    // field model keeps only the alias name in `location`.
    const legacyPou = JSON.stringify({
      type: 'program',
      data: {
        name: 'Legacy',
        variables: [
          {
            name: 'sensor',
            class: 'local',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '%IX0.0',
            alias: 'flow_sensor',
            documentation: '',
          },
        ],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    })
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/Legacy.json', content: legacyPou }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    const variable = result.projectData.pous[0].interface?.variables[0]
    // Alias name folded into location; the `alias` field is gone.
    expect(variable?.location).toBe('flow_sensor')
    expect('alias' in (variable as unknown as Record<string, unknown>)).toBe(false)
  })

  it('leaves a manual (empty-alias) JSON POU variable location untouched', () => {
    const legacyPou = JSON.stringify({
      type: 'program',
      data: {
        name: 'Manual',
        variables: [
          {
            name: 'coil',
            class: 'local',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '%QX0.0',
            alias: '',
            documentation: '',
          },
        ],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    })
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/Manual.json', content: legacyPou }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    const variable = result.projectData.pous[0].interface?.variables[0]
    // Empty alias is not a binding — the manual %address is preserved.
    expect(variable?.location).toBe('%QX0.0')
  })
})

// ---------------------------------------------------------------------------
// Line 79 — detectPouTypeFromPath: function-block and function detection
// ---------------------------------------------------------------------------

describe('parseProjectFiles — POU type detection throws for unknown path', () => {
  it('throws when POU path does not match any known directory', () => {
    const pouFiles: RawProjectFile[] = [
      { relativePath: 'pous/unknown-dir/something.st', content: 'PROGRAM something\nEND_PROGRAM' },
    ]
    expect(() =>
      parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], []),
    ).toThrow('Cannot determine POU type from path')
  })
})

describe('parseProjectFiles — POU type detection from path', () => {
  it('detects function-block type from path', () => {
    const content = makeStContent('MyFB', 'FUNCTION_BLOCK')
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/function-blocks/MyFB.st', content }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous[0].pouType).toBe('function-block')
  })

  it('detects function type from path', () => {
    const content = makeStContent('MyFunc', 'FUNCTION', 'INT')
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/functions/MyFunc.st', content }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous[0].pouType).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Line 90 — getLanguageFromExt returns null for unsupported extension
// ---------------------------------------------------------------------------

describe('parseProjectFiles — unsupported file extension', () => {
  it('returns null for a file with an unknown extension', () => {
    const pouFiles: RawProjectFile[] = [
      { relativePath: 'pous/programs/main.xyz', content: 'PROGRAM main\nEND_PROGRAM' },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    // The POU should be skipped since the extension is not recognized
    expect(result.projectData.pous).toHaveLength(0)
  })

  it('returns null for a file with no extension', () => {
    // A file like 'pous/programs/Makefile' has no recognized extension
    // But it does have a '.' so ext will be the last segment after the period
    // If no period at all, ext is undefined and parsePouFile returns null
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/noext', content: 'PROGRAM noext\nEND_PROGRAM' }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Lines 119-180 — createFallbackPou (reached via parse failure)
// ---------------------------------------------------------------------------

describe('parseProjectFiles — fallback POU creation', () => {
  it('falls back when ST parsing fails (e.g. malformed content)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/broken.st',
        // Missing END_PROGRAM will cause parser to throw
        content: 'PROGRAM broken\nVAR\n  x : INT;\nEND_VAR\nbody content here',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].name).toBe('broken')
    // The fallback should extract variablesText
    expect(result.projectData.pous[0].variablesText).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('warns and preserves declarations when a PROGRAM has a located interface-class variable (issue #904)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/main.st',
        content:
          'PROGRAM main\nVAR_OUTPUT\n  Q1 : BOOL AT %QX0.0;\nEND_VAR\nVAR\n  latch : RS;\nEND_VAR\n\n\nEND_PROGRAM',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    // Falls back: the structured variable list is empty, but the raw
    // declarations survive in variablesText for in-app repair.
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].interface?.variables).toEqual([])
    expect(result.projectData.pous[0].variablesText).toContain('AT %QX0.0')
    // The failure is surfaced: names the POU and file, states the offending
    // rule, and points at the repair path.
    expect(result.warnings).toBeDefined()
    const warning = result.warnings!.find((w) => w.includes('pous/programs/main.st'))
    expect(warning).toContain('POU "main"')
    expect(warning).toMatch(/Location \("AT"\) is not allowed for variables of class "OUTPUT"/)
    expect(warning).toContain('code view')
    consoleSpy.mockRestore()
  })

  it('warns with a partial-data message when a graphical POU fails to parse', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      { relativePath: 'pous/programs/FbdPou.fbd', content: 'PROGRAM FbdPou\nnot valid json\nEND_PROGRAM' },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('FbdPou') && w.includes('partial data'))).toBe(true)
    consoleSpy.mockRestore()
  })

  it('fallback extracts documentation from (* ... *) comments', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/doctest.st',
        content: '(* This is documentation *)\nPROGRAM doctest\nVAR\n  a : INT;\nEND_VAR\nbody here',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous[0].documentation).toBe('This is documentation')
    consoleSpy.mockRestore()
  })

  it('fallback handles graphical language (LD) with valid JSON body', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bodyJson = JSON.stringify({ nodes: [{ id: 'n1' }], edges: [] })
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/LdPou.ld',
        // Malformed enough that normal parsing fails, but has valid JSON body
        content: `PROGRAM LdPou\n${bodyJson}\nEND_PROGRAM`,
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    consoleSpy.mockRestore()
  })

  it('fallback handles graphical language (FBD) with invalid JSON body (uses default)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/FbdPou.fbd',
        content: 'PROGRAM FbdPou\nnot valid json\nEND_PROGRAM',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    const body = result.projectData.pous[0].body
    expect(body.language).toBe('fbd')
    consoleSpy.mockRestore()
  })

  it('fallback handles LD without END_PROGRAM (takes rest of content)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/NoEnd.ld',
        content: 'PROGRAM NoEnd\nnot json',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    consoleSpy.mockRestore()
  })

  it('fallback handles textual language (ST) without END_PROGRAM', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/NoEnd.st',
        content: 'PROGRAM NoEnd\nsome body code',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    consoleSpy.mockRestore()
  })

  it('fallback handles unknown language with empty body', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // We cannot easily trigger the `else { bodyValue = '' }` branch from
    // the normal parse path because unknown extensions are filtered before the
    // try/catch. Instead we test that a python POU that fails parsing uses the
    // correct branch.
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/PyPou.py',
        content: 'PROGRAM PyPou\ndef main():\n  pass\nEND_PROGRAM',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    consoleSpy.mockRestore()
  })

  it('fallback for function type includes returnType BOOL', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/functions/broken.st',
        // Missing return type causes parser to throw, then fallback handles it
        content: 'FUNCTION broken\nVAR\n  x : INT;\nEND_VAR\nbody',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].interface?.returnType).toBe('BOOL')
    consoleSpy.mockRestore()
  })

  it('fallback for function-block type does not include returnType', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/function-blocks/broken.st',
        content: 'FUNCTION_BLOCK broken\nbody without end keyword',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].interface?.returnType).toBeUndefined()
    consoleSpy.mockRestore()
  })

  it('fallback handles content with no declaration match (bodyStartIndex=0)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pouFiles: RawProjectFile[] = [
      {
        relativePath: 'pous/programs/nodecl.st',
        content: 'just some random text that is not a POU declaration',
      },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Lines 214-233 — JSON POU parsing (legacy format + flat format + malformed)
// ---------------------------------------------------------------------------

describe('parseProjectFiles — JSON POU format', () => {
  it('parses a JSON POU in legacy discriminated union format', () => {
    const jsonContent = JSON.stringify({
      type: 'program',
      data: {
        name: 'JsonPou',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: 'Some doc',
      },
    })
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/JsonPou.json', content: jsonContent }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].name).toBe('JsonPou')
    expect(result.projectData.pous[0].documentation).toBe('Some doc')
  })

  it('parses a JSON POU in flat format (no type+data wrapper)', () => {
    const jsonContent = JSON.stringify({
      name: 'FlatPou',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
    })
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/FlatPou.json', content: jsonContent }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].name).toBe('FlatPou')
  })

  it('returns null for malformed JSON POU file', () => {
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/BadJson.json', content: '{not valid json' }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Lines 243-260 — parsePouFile: Python, C++, LD, FBD paths + catch branches
// ---------------------------------------------------------------------------

describe('parseProjectFiles — Python and C++ POU parsing', () => {
  it('parses a Python POU', () => {
    const content = 'PROGRAM PyPou\nVAR\n  x : INT;\nEND_VAR\nprint("hello")\nEND_PROGRAM'
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/PyPou.py', content }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].body.language).toBe('python')
  })

  it('parses a C++ POU', () => {
    const content = 'PROGRAM CppPou\nVAR\n  x : INT;\nEND_VAR\nint main() { return 0; }\nEND_PROGRAM'
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/CppPou.cpp', content }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].body.language).toBe('cpp')
  })
})

// ---------------------------------------------------------------------------
// Lines 283-286 — deduplicatePouFiles: text-based wins over JSON
// ---------------------------------------------------------------------------

describe('parseProjectFiles — POU deduplication', () => {
  it('prefers text-based .st file over .json for the same POU name', () => {
    const stContent = makeStContent('DupPou', 'PROGRAM')
    const jsonContent = JSON.stringify({
      type: 'program',
      data: {
        name: 'DupPouJson',
        variables: [],
        body: { language: 'st', value: 'old body' },
        documentation: '',
      },
    })
    const pouFiles: RawProjectFile[] = [
      { relativePath: 'pous/programs/DupPou.json', content: jsonContent },
      { relativePath: 'pous/programs/DupPou.st', content: stContent },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    // The ST-parsed version should win
    expect(result.projectData.pous[0].name).toBe('DupPou')
  })

  it('keeps JSON file when text-based already exists (json is skipped)', () => {
    const stContent = makeStContent('DupPou2', 'PROGRAM')
    const jsonContent = JSON.stringify({
      name: 'DupPou2',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
    })
    const pouFiles: RawProjectFile[] = [
      { relativePath: 'pous/programs/DupPou2.st', content: stContent },
      { relativePath: 'pous/programs/DupPou2.json', content: jsonContent },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Lines 333-342 — project.json Zod validation failure + malformed JSON
// ---------------------------------------------------------------------------

describe('parseProjectFiles — project.json error paths', () => {
  it('uses defaults when project.json is empty string', () => {
    const result = parseProjectFiles('/p', '', makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.meta.name).toBe('')
    expect(result.meta.type).toBe('plc-project')
  })

  it('uses defaults when project.json has invalid structure', () => {
    const result = parseProjectFiles(
      '/p',
      JSON.stringify({ meta: 123 }),
      makeDeviceConfig(),
      makePinMapping(),
      [],
      [],
      [],
    )
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('invalid structure'))).toBe(true)
  })

  it('uses defaults when project.json is malformed JSON', () => {
    const result = parseProjectFiles('/p', '{not valid json}', makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('malformed'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Lines 358-369 — device config validation failures / empty
// ---------------------------------------------------------------------------

describe('parseProjectFiles — device config error paths', () => {
  it('uses defaults when device config is empty string', () => {
    const result = parseProjectFiles('/p', makeProjectJson(), '', makePinMapping(), [], [], [])
    expect(result.deviceConfiguration).toBeDefined()
  })

  it('uses defaults when device config has invalid structure', () => {
    // deviceBoard must be a string — feeding a number forces a Zod
    // validation failure, exercising the invalid-structure fallback.
    const result = parseProjectFiles(
      '/p',
      makeProjectJson(),
      JSON.stringify({ deviceBoard: 123 }),
      makePinMapping(),
      [],
      [],
      [],
    )
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('configuration.json'))).toBe(true)
    expect(result.deviceConfiguration).toBeDefined()
  })

  it('uses defaults when device config is malformed JSON', () => {
    const result = parseProjectFiles('/p', makeProjectJson(), '{bad json}', makePinMapping(), [], [], [])
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('configuration.json') && w.includes('malformed'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Lines 382-391 — pin mapping validation failures / empty
// ---------------------------------------------------------------------------

describe('parseProjectFiles — pin mapping error paths', () => {
  it('uses defaults when pin mapping is empty string', () => {
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), '', [], [], [])
    expect(result.devicePinMapping).toBeDefined()
  })

  it('uses defaults when pin mapping has invalid structure', () => {
    const result = parseProjectFiles(
      '/p',
      makeProjectJson(),
      makeDeviceConfig(),
      JSON.stringify([{ bad: true }]),
      [],
      [],
      [],
    )
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('pin-mapping.json'))).toBe(true)
    expect(result.devicePinMapping).toBeDefined()
  })

  it('uses defaults when pin mapping is malformed JSON', () => {
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), '{bad}', [], [], [])
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('pin-mapping.json') && w.includes('malformed'))).toBe(true)
  })

  it('accepts the legacy flat-array shape and forwards it for store-side migration', () => {
    // Pre-per-board-scoping projects wrote `DevicePin[]` to disk. The
    // store's `setDeviceDefinitions` keys that array under the active
    // board on load. Here we just verify the parser passes the flat
    // array through verbatim — the migration responsibility is the
    // store's, not the parser's (the parser doesn't know what the
    // active board is from the schema alone).
    const legacy = JSON.stringify([{ pin: '13', pinType: 'digitalOutput', address: '%QX0.0', alias: 'led' }])
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), legacy, [], [], [])
    expect(Array.isArray(result.devicePinMapping)).toBe(true)
    expect(result.devicePinMapping).toEqual([{ pin: '13', pinType: 'digitalOutput', address: '%QX0.0', alias: 'led' }])
  })

  it('accepts the canonical per-board dict shape (post-migration)', () => {
    // Projects saved by post-migration editors write a per-board dict.
    // Each key is a `BoardInfo.name`, each value is that board's pin
    // array. The parser passes it through verbatim.
    const dict = JSON.stringify({
      'Arduino Mega': [{ pin: '13', pinType: 'digitalOutput', address: '%QX0.0', alias: 'led' }],
      'Arduino MKR WiFi 1010': [{ pin: 'A0', pinType: 'analogInput', address: '%IW0', alias: 'sensor' }],
    })
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), dict, [], [], [])
    expect(Array.isArray(result.devicePinMapping)).toBe(false)
    expect(result.devicePinMapping).toEqual({
      'Arduino Mega': [{ pin: '13', pinType: 'digitalOutput', address: '%QX0.0', alias: 'led' }],
      'Arduino MKR WiFi 1010': [{ pin: 'A0', pinType: 'analogInput', address: '%IW0', alias: 'sensor' }],
    })
  })
})

// ---------------------------------------------------------------------------
// Lines 404-420 — server file parsing (valid, Zod fail, bad JSON)
// ---------------------------------------------------------------------------

describe('parseProjectFiles — server file parsing', () => {
  it('parses a valid server config file', () => {
    const serverJson = JSON.stringify({
      name: 'TestServer',
      protocol: 'modbus-tcp',
      modbusSlaveConfig: {
        enabled: true,
        networkInterface: 'eth0',
        port: 502,
      },
    })
    const serverFiles: RawProjectFile[] = [{ relativePath: 'devices/servers/TestServer.json', content: serverJson }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), [], serverFiles, [])
    expect(result.projectData.servers).toHaveLength(1)
    expect(result.projectData.servers![0].name).toBe('TestServer')
  })

  it('skips server files with invalid Zod structure and adds warning', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const serverFiles: RawProjectFile[] = [
      { relativePath: 'devices/servers/Bad.json', content: JSON.stringify({ name: 123 }) },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), [], serverFiles, [])
    expect(result.projectData.servers).toHaveLength(0)
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('Bad.json'))).toBe(true)
    consoleSpy.mockRestore()
  })

  it('skips server files with malformed JSON', () => {
    const serverFiles: RawProjectFile[] = [{ relativePath: 'devices/servers/Broken.json', content: '{not json' }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), [], serverFiles, [])
    expect(result.projectData.servers).toHaveLength(0)
  })

  it('uses servers from project.json when no server files parsed', () => {
    const projectJson = makeProjectJson({
      servers: [{ name: 'FallbackServer', protocol: 'modbus-tcp' }],
    })
    const result = parseProjectFiles('/p', projectJson, makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.projectData.servers).toHaveLength(1)
    expect(result.projectData.servers![0].name).toBe('FallbackServer')
  })
})

// ---------------------------------------------------------------------------
// Lines 430-437 — remote device file parsing
// ---------------------------------------------------------------------------

describe('parseProjectFiles — remote device file parsing', () => {
  it('parses a valid remote device config file', () => {
    const deviceJson = JSON.stringify({
      name: 'RemoteDev',
      protocol: 'modbus-tcp',
      modbusTcpConfig: {
        timeout: 1000,
        ioGroups: [],
      },
    })
    const remoteFiles: RawProjectFile[] = [{ relativePath: 'devices/remote/RemoteDev.json', content: deviceJson }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), [], [], remoteFiles)
    expect(result.projectData.remoteDevices).toHaveLength(1)
    expect(result.projectData.remoteDevices![0].name).toBe('RemoteDev')
  })

  it('skips remote device files with invalid Zod structure and adds warning', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const remoteFiles: RawProjectFile[] = [
      { relativePath: 'devices/remote/Bad.json', content: JSON.stringify({ invalid: true }) },
    ]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), [], [], remoteFiles)
    expect(result.projectData.remoteDevices).toHaveLength(0)
    expect(result.warnings).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('skips remote device files with malformed JSON', () => {
    const remoteFiles: RawProjectFile[] = [{ relativePath: 'devices/remote/Broken.json', content: '{broken' }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), [], [], remoteFiles)
    expect(result.projectData.remoteDevices).toHaveLength(0)
  })

  it('uses remote devices from project.json when no remote device files parsed', () => {
    const projectJson = makeProjectJson({
      remoteDevices: [{ name: 'FallbackRemote', protocol: 'modbus-tcp' }],
    })
    const result = parseProjectFiles('/p', projectJson, makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.projectData.remoteDevices).toHaveLength(1)
    expect(result.projectData.remoteDevices![0].name).toBe('FallbackRemote')
  })
})

// ---------------------------------------------------------------------------
// Line 453 — configuration fallback defaults
// ---------------------------------------------------------------------------

describe('parseProjectFiles — configuration fallback', () => {
  it('fills missing resource fields with empty arrays', () => {
    const projectJson = JSON.stringify({
      meta: { name: 'Test', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {},
        },
      },
    })
    const result = parseProjectFiles('/p', projectJson, makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.projectData.configurations.resource.tasks).toEqual([])
    expect(result.projectData.configurations.resource.instances).toEqual([])
    expect(result.projectData.configurations.resource.globalVariables).toEqual([])
  })

  it('fills missing resource entirely with defaults', () => {
    // `data.configurations` is `{ resource: null }` — the `??` chain
    // doesn't substitute the default object because `{ resource: null }`
    // itself is not null/undefined, so we fall through to the explicit
    // `if (!configuration.resource)` guard which fills in the default.
    const projectJson = JSON.stringify({
      meta: { name: 'Test', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configurations: { resource: null },
      },
    })
    const result = parseProjectFiles('/p', projectJson, makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.projectData.configurations.resource).toBeDefined()
    expect(result.projectData.configurations.resource.tasks).toEqual([])
    expect(result.projectData.configurations.resource.instances).toEqual([])
    expect(result.projectData.configurations.resource.globalVariables).toEqual([])
  })

  it('fills partially missing resource fields with empty arrays', () => {
    // Use "configurations" with a resource that has only tasks (no instances or globalVariables)
    const projectJson = JSON.stringify({
      meta: { name: 'Test', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configurations: { resource: { tasks: [] } },
      },
    })
    const result = parseProjectFiles('/p', projectJson, makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.projectData.configurations.resource.tasks).toEqual([])
    expect(result.projectData.configurations.resource.instances).toEqual([])
    expect(result.projectData.configurations.resource.globalVariables).toEqual([])
  })

  it('provides default configuration when data has neither configuration nor configurations field', () => {
    const projectJson = JSON.stringify({
      meta: { name: 'Test', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
      },
    })
    const result = parseProjectFiles('/p', projectJson, makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.projectData.configurations.resource.tasks).toEqual([])
  })

  it('reads debugVariables from project data', () => {
    const projectJson = makeProjectJson({
      debugVariables: { global: ['g1'], pous: { P1: ['v1'] } },
    })
    const result = parseProjectFiles('/p', projectJson, makeDeviceConfig(), makePinMapping(), [], [], [])
    expect(result.projectData.debugVariables).toEqual({ global: ['g1'], pous: { P1: ['v1'] } })
  })
})

// ---------------------------------------------------------------------------
// POU name derivation from filename
// ---------------------------------------------------------------------------

describe('parseProjectFiles — POU name derivation', () => {
  it('derives POU name from filename when parsed POU has no name', () => {
    // A flat JSON POU with empty name
    const jsonContent = JSON.stringify({
      name: '',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
    })
    const pouFiles: RawProjectFile[] = [{ relativePath: 'pous/programs/Derived.json', content: jsonContent }]
    const result = parseProjectFiles('/p', makeProjectJson(), makeDeviceConfig(), makePinMapping(), pouFiles, [], [])
    expect(result.projectData.pous).toHaveLength(1)
    expect(result.projectData.pous[0].name).toBe('Derived')
  })
})
