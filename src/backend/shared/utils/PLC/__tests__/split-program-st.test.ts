import { type KnownPou, splitProgramSt } from '../split-program-st'

describe('splitProgramSt', () => {
  describe('happy paths', () => {
    it('splits a single PROGRAM POU', () => {
      const source =
        'PROGRAM Main\n' + '  VAR\n' + '    flag : BOOL;\n' + '  END_VAR\n' + '  flag := TRUE;\n' + 'END_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).not.toBeNull()
      expect([...result!.files.keys()]).toEqual(['Main.st'])
      expect(result!.files.get('Main.st')).toContain('PROGRAM Main')
      expect(result!.files.get('Main.st')).toContain('END_PROGRAM')
      expect(result!.pouOffsets.get('Main')).toEqual({ kind: 'PROGRAM', startLine: 1, endLine: 6 })
    })

    it('splits multiple POUs of mixed kinds', () => {
      const source =
        'FUNCTION_BLOCK Tank_Controller\n' +
        '  VAR sp : INT; END_VAR\n' +
        '  sp := 100;\n' +
        'END_FUNCTION_BLOCK\n' +
        '\n' +
        'PROGRAM Main\n' +
        '  VAR x : INT; END_VAR\n' +
        '  x := 1;\n' +
        'END_PROGRAM\n'
      const result = splitProgramSt(source, [
        { name: 'Tank_Controller', kind: 'FUNCTION_BLOCK' },
        { name: 'Main', kind: 'PROGRAM' },
      ])
      expect(result).not.toBeNull()
      expect([...result!.files.keys()]).toEqual(['Tank_Controller.st', 'Main.st'])
      expect(result!.files.get('Tank_Controller.st')).toContain('FUNCTION_BLOCK Tank_Controller')
      expect(result!.files.get('Main.st')).toContain('PROGRAM Main')
    })

    it('preserves indentation and blank lines inside each POU', () => {
      const source =
        'PROGRAM Main\n' +
        '  VAR\n' +
        '    x : INT;\n' +
        '  END_VAR\n' +
        '\n' +
        '  IF x > 0 THEN\n' +
        '    x := x + 1;\n' +
        '  END_IF;\n' +
        'END_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result!.files.get('Main.st')).toBe(source)
    })

    it('matches POU names case-insensitively (xml2st may upper-case)', () => {
      // The editor's project model has the user-typed casing; xml2st
      // sometimes upper-cases identifiers.  The splitter must handle
      // either direction.
      const source = 'PROGRAM MAIN\n  VAR x : INT; END_VAR\n  x := 1;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'main', kind: 'PROGRAM' }])
      expect(result).not.toBeNull()
      expect(result!.files.has('main.st')).toBe(true)
    })

    it('rejects substring name collisions (Main_Loop ≠ Main)', () => {
      // A naïve regex would match `PROGRAM Main_Loop` when looking
      // for `Main`.  The word-boundary anchor prevents that.  We
      // request just `Main` here; since it doesn't exist, the
      // splitter returns null.
      const source = 'PROGRAM Main_Loop\n  VAR x : INT; END_VAR\n  x := 1;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).toBeNull()
    })
  })

  describe('non-POU sections', () => {
    it('extracts a TYPE block into _types.st', () => {
      const source =
        'TYPE\n' +
        '  Color : (RED, GREEN, BLUE);\n' +
        'END_TYPE\n' +
        '\n' +
        'PROGRAM Main\n' +
        '  VAR c : Color; END_VAR\n' +
        '  c := Color#RED;\n' +
        'END_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).not.toBeNull()
      expect(result!.files.has('_types.st')).toBe(true)
      expect(result!.files.get('_types.st')).toContain('TYPE')
      expect(result!.files.get('_types.st')).toContain('END_TYPE')
    })

    it('extracts CONFIGURATION into _config.st', () => {
      const source =
        'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := 0;\nEND_PROGRAM\n' +
        '\n' +
        'CONFIGURATION Config0\n' +
        '  RESOURCE Res0 ON PLC\n' +
        '    TASK MainTask(INTERVAL := T#100ms, PRIORITY := 0);\n' +
        '    PROGRAM MainInstance WITH MainTask : Main;\n' +
        '  END_RESOURCE\n' +
        'END_CONFIGURATION\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).not.toBeNull()
      expect(result!.files.has('_config.st')).toBe(true)
      expect(result!.files.get('_config.st')).toContain('CONFIGURATION Config0')
    })

    it('extracts VAR_GLOBAL into _globals.st', () => {
      const source =
        'VAR_GLOBAL\n' +
        '  G : INT;\n' +
        'END_VAR\n' +
        '\n' +
        'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := G;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).not.toBeNull()
      expect(result!.files.has('_globals.st')).toBe(true)
      expect(result!.files.get('_globals.st')).toContain('VAR_GLOBAL')
    })
  })

  describe('graceful fallback', () => {
    it('returns null when a known POU is not in the ST', () => {
      const source = 'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := 0;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [
        { name: 'Main', kind: 'PROGRAM' },
        { name: 'Missing', kind: 'FUNCTION_BLOCK' },
      ])
      expect(result).toBeNull()
    })

    it('returns null when a POU is missing END_*', () => {
      const source = 'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := 0;\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).toBeNull()
    })

    it('returns null on duplicate POU declarations (corrupted file)', () => {
      // Two PROGRAM Main headers — second header opens before the
      // first END_PROGRAM, so findPouEnd hits the otherStartRe guard
      // and bails.
      const source =
        'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := 0;\n' +
        'PROGRAM Main\n  VAR y : INT; END_VAR\n  y := 0;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).toBeNull()
    })

    it('returns null on empty knownPous list (nothing to anchor on)', () => {
      const source = 'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := 0;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [])
      expect(result).toBeNull()
    })

    it('returns null when an unclosed TYPE block is found', () => {
      const source =
        'TYPE\n' +
        '  Color : (RED, GREEN);\n' +
        // missing END_TYPE
        'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := 0;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result).toBeNull()
    })
  })

  describe('special characters in POU names', () => {
    it('handles names with underscores and digits', () => {
      const source =
        'FUNCTION_BLOCK Tank_Controller_v2\n' + '  VAR sp : INT; END_VAR\n' + '  sp := 100;\n' + 'END_FUNCTION_BLOCK\n'
      const result = splitProgramSt(source, [{ name: 'Tank_Controller_v2', kind: 'FUNCTION_BLOCK' }])
      expect(result).not.toBeNull()
      expect(result!.files.has('Tank_Controller_v2.st')).toBe(true)
    })
  })

  describe('language-aware extension', () => {
    it('emits a `.il` file for an IL-language POU', () => {
      const source =
        'FUNCTION_BLOCK State_Display\n' +
        '  VAR State : INT; Out : INT; END_VAR\n' +
        '  LD State\n' +
        '  ST Out\n' +
        'END_FUNCTION_BLOCK\n'
      const result = splitProgramSt(source, [{ name: 'State_Display', kind: 'FUNCTION_BLOCK', language: 'il' }])
      expect(result).not.toBeNull()
      expect(result!.files.has('State_Display.il')).toBe(true)
      expect(result!.files.has('State_Display.st')).toBe(false)
    })

    it('emits `.st` for ST and graphical POUs (xml2st renders them as ST)', () => {
      const source =
        'PROGRAM Main_LD\n  VAR x : INT; END_VAR\n  x := 1;\nEND_PROGRAM\n' +
        'PROGRAM Main_ST\n  VAR y : INT; END_VAR\n  y := 2;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [
        { name: 'Main_LD', kind: 'PROGRAM', language: 'ld' },
        { name: 'Main_ST', kind: 'PROGRAM', language: 'st' },
      ])
      expect(result).not.toBeNull()
      expect(result!.files.has('Main_LD.st')).toBe(true)
      expect(result!.files.has('Main_ST.st')).toBe(true)
    })

    it('defaults to `.st` when language is unspecified', () => {
      const source = 'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := 0;\nEND_PROGRAM\n'
      const result = splitProgramSt(source, [{ name: 'Main', kind: 'PROGRAM' }])
      expect(result!.files.has('Main.st')).toBe(true)
    })
  })

  describe('FUNCTION POUs (with return type)', () => {
    it('splits FUNCTION declarations correctly', () => {
      const source =
        'FUNCTION Add : INT\n' + '  VAR_INPUT a, b : INT; END_VAR\n' + '  Add := a + b;\n' + 'END_FUNCTION\n'
      const result = splitProgramSt(source, [{ name: 'Add', kind: 'FUNCTION' }])
      expect(result).not.toBeNull()
      expect(result!.files.get('Add.st')).toContain('FUNCTION Add : INT')
      expect(result!.files.get('Add.st')).toContain('END_FUNCTION')
    })
  })

  describe('round-trip line offsets', () => {
    it('records the original program.st line numbers in pouOffsets', () => {
      // Two POUs separated by blank lines.  Verify that the offsets
      // table matches what a downstream remap (e.g. iec2c on Runtime
      // v3) would need.
      const source =
        '\n' +
        'PROGRAM Alpha\n' + // line 2
        '  VAR x : INT; END_VAR\n' +
        '  x := 1;\n' +
        'END_PROGRAM\n' + // line 5
        '\n' +
        'PROGRAM Beta\n' + // line 7
        '  VAR y : INT; END_VAR\n' +
        '  y := 2;\n' +
        'END_PROGRAM\n' // line 10
      const result = splitProgramSt(source, [
        { name: 'Alpha', kind: 'PROGRAM' },
        { name: 'Beta', kind: 'PROGRAM' },
      ])
      expect(result).not.toBeNull()
      expect(result!.pouOffsets.get('Alpha')).toEqual({ kind: 'PROGRAM', startLine: 2, endLine: 5 })
      expect(result!.pouOffsets.get('Beta')).toEqual({ kind: 'PROGRAM', startLine: 7, endLine: 10 })
    })
  })

  describe('realistic xml2st-shaped output', () => {
    it('handles a multi-POU + TYPE + CONFIGURATION program', () => {
      // Mimics the shape xml2st emits for a typical project.
      const source = `TYPE
  TrafficState : (RED, YELLOW, GREEN);
END_TYPE

FUNCTION_BLOCK TrafficLight
  VAR
    state : TrafficState := TrafficState#RED;
  END_VAR
  state := state;
END_FUNCTION_BLOCK

PROGRAM Main
  VAR
    light : TrafficLight;
  END_VAR
  light();
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK MainTask(INTERVAL := T#100ms, PRIORITY := 0);
    PROGRAM MainInstance WITH MainTask : Main;
  END_RESOURCE
END_CONFIGURATION
`
      const knownPous: KnownPou[] = [
        { name: 'TrafficLight', kind: 'FUNCTION_BLOCK' },
        { name: 'Main', kind: 'PROGRAM' },
      ]
      const result = splitProgramSt(source, knownPous)
      expect(result).not.toBeNull()
      expect([...result!.files.keys()].sort()).toEqual(['Main.st', 'TrafficLight.st', '_config.st', '_types.st'])
      // Sanity: no POU body content leaks into _types or _config.
      expect(result!.files.get('_types.st')).not.toContain('PROGRAM')
      expect(result!.files.get('_config.st')).not.toContain('FUNCTION_BLOCK')
    })
  })
})
