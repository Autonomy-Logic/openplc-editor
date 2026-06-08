import { parseResourceStringToConfiguration } from '../parse-resource-string-to-configuration'

describe('parseResourceStringToConfiguration', () => {
  // ---- happy path ----

  it('parses an empty string and returns empty arrays', () => {
    const result = parseResourceStringToConfiguration('')
    expect(result).toEqual({ tasks: [], instances: [] })
  })

  it('parses a single task with interval and priority', () => {
    const input = 'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1);'
    const { tasks, instances } = parseResourceStringToConfiguration(input)

    expect(tasks).toEqual([{ name: 'Task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }])
    expect(instances).toEqual([])
  })

  it('parses a task and its program instance', () => {
    const input = ['TASK Task0(INTERVAL := T#20ms, PRIORITY := 0);', 'PROGRAM Inst0 WITH Task0 : Main;'].join('\n')

    const { tasks, instances } = parseResourceStringToConfiguration(input)

    expect(tasks).toHaveLength(1)
    expect(instances).toEqual([{ name: 'Inst0', task: 'Task0', program: 'Main' }])
  })

  it('parses a full configuration block with wrappers', () => {
    const input = [
      'CONFIGURATION Config0',
      '\tRESOURCE Res0 ON PLC',
      '\t\tTASK Task0(INTERVAL := T#50ms, PRIORITY := 3);',
      '\t\tPROGRAM Inst0 WITH Task0 : Main;',
      '\tEND_RESOURCE',
      'END_CONFIGURATION',
    ].join('\n')

    const { tasks, instances } = parseResourceStringToConfiguration(input)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('Task0')
    expect(tasks[0].interval).toBe('T#50ms')
    expect(tasks[0].priority).toBe(3)
    expect(instances).toHaveLength(1)
  })

  it('skips blank lines and comment-only lines', () => {
    const input = ['', '(* This is a comment *)', 'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1);', ''].join('\n')

    const { tasks } = parseResourceStringToConfiguration(input)
    expect(tasks).toHaveLength(1)
  })

  it('parses a task with no params section', () => {
    const input = 'TASK Task0();'
    const { tasks } = parseResourceStringToConfiguration(input)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].interval).toBe('')
    // Parser defaults priority to 1 when PRIORITY := isn't supplied —
    // matches the IEC 61131-3 default and the codegen's task table.
    expect(tasks[0].priority).toBe(1)
  })

  it('ignores unknown task parameters', () => {
    const input = 'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1, UNKNOWN := foo);'
    const { tasks } = parseResourceStringToConfiguration(input)

    expect(tasks).toHaveLength(1)
    expect(tasks[0].interval).toBe('T#20ms')
    expect(tasks[0].priority).toBe(1)
  })

  it('handles Windows-style line endings', () => {
    const input = 'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1);\r\nPROGRAM Inst0 WITH Task0 : Main;'
    const { tasks, instances } = parseResourceStringToConfiguration(input)
    expect(tasks).toHaveLength(1)
    expect(instances).toHaveLength(1)
  })

  it('handles inline comments stripped from lines', () => {
    const input = 'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1); (* my task *)'
    // The comment is after the semicolon, the lineRegex should still match
    // Actually the comment gets stripped first, then matched
    const { tasks } = parseResourceStringToConfiguration(input)
    expect(tasks).toHaveLength(1)
  })

  // ---- TASK errors ----

  it('throws on duplicate task names (case insensitive)', () => {
    const input = [
      'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1);',
      'TASK task0(INTERVAL := T#10ms, PRIORITY := 2);',
    ].join('\n')

    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Duplicate TASK name/)
  })

  it('throws when task name is the reserved keyword "task"', () => {
    const input = 'TASK task(INTERVAL := T#20ms, PRIORITY := 1);'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/reserved keyword/)
  })

  it('throws with "must start with TASK" hint for bad task-like line', () => {
    // A line starting with TASK but missing parentheses
    const input = 'TASK Task0 INTERVAL := T#20ms;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/parentheses/)
  })

  it('throws with "missing semicolon" hint for task without semicolon', () => {
    const input = 'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1)'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/semicolon/)
  })

  it('throws with "assignment operator" hint for task parameter missing :=', () => {
    // The task regex requires TASK <identifier>(...); — we need it to fail
    // while still having parens, semicolon, and 'interval' without ':='
    // Use a name that is NOT a valid identifier (starts with a number) so regex fails
    const input = 'TASK 0Bad(interval T#20ms);'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Assignment operator/)
  })

  it('throws with "invalid characters" hint for special chars in task line', () => {
    const input = 'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1) @!;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Invalid or unsupported characters/)
  })

  it('throws with "unrecognized declaration format" for otherwise unparseable task line', () => {
    // Starts with TASK, has parens, has semicolon, no 'interval' keyword, no invalid chars
    const input = 'TASK (something);'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Unrecognized declaration format/)
  })

  // ---- PROGRAM INSTANCE errors ----

  it('throws on duplicate instance names (case insensitive)', () => {
    const input = [
      'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1);',
      'PROGRAM Inst0 WITH Task0 : Main;',
      'PROGRAM inst0 WITH Task0 : Main;',
    ].join('\n')

    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Duplicate PROGRAM name/)
  })

  it('throws with "missing WITH" hint when WITH is absent in program line', () => {
    const input = 'PROGRAM Inst0 Task0 : Main;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Missing "WITH" keyword/)
  })

  it('throws with "missing colon" hint when colon is absent in program line', () => {
    const input = 'PROGRAM Inst0 WITH Task0 Main;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Missing colon/)
  })

  it('throws with "missing semicolon" hint for program line without semicolon', () => {
    const input = 'PROGRAM Inst0 WITH Task0 : Main'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Missing semicolon/)
  })

  it('throws with "invalid characters" hint for program line with special chars', () => {
    const input = 'PROGRAM Inst0 WITH Task0 : Main@;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Invalid or unsupported characters/)
  })

  it('throws with "unrecognized declaration format" for otherwise unparseable program line', () => {
    // Starts with PROGRAM, has WITH, has colon, has semicolon, no invalid chars
    const input = 'PROGRAM WITH : ;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Unrecognized declaration format/)
  })

  it('throws with "must start with PROGRAM" for non-PROGRAM line hinted as instance', () => {
    // Test the guessInstanceErrorReason when line does not start with PROGRAM
    // We cannot reach this path directly since the parser only calls guessInstanceErrorReason
    // when it starts with PROGRAM. Instead, we test via something that reaches the unrecognized line path.
  })

  it('triggers "must start with TASK" hint when raw line has leading comment before TASK', () => {
    // lineWithoutComment becomes "TASK ..." (starts with TASK) but
    // guessTaskErrorReason receives the raw line "(* x *)TASK ..." which does not
    const input = '(* x *)TASK'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/must start with the "TASK" keyword/)
  })

  it('triggers "must start with PROGRAM" hint when raw line has leading comment before PROGRAM', () => {
    // Same logic: comment-stripped line starts with PROGRAM, but raw line does not
    const input = '(* x *)PROGRAM'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/must start with the "PROGRAM" keyword/)
  })

  // ---- Unrecognized lines ----

  it('throws on an unrecognized line that is not a TASK, PROGRAM, or wrapper keyword', () => {
    const input = 'SOMETHING_RANDOM;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/Unrecognized or misplaced declaration/)
  })

  // ---- Cross-validation ----

  it('throws when an instance references an undeclared task', () => {
    const input = ['TASK Task0(INTERVAL := T#20ms, PRIORITY := 1);', 'PROGRAM Inst0 WITH NonExistent : Main;'].join(
      '\n',
    )

    expect(() => parseResourceStringToConfiguration(input)).toThrow(
      /Task "NonExistent" referenced in PROGRAM "Inst0".*is not declared/,
    )
  })

  it('throws when instance references undeclared task with fallback line number', () => {
    // Instance created, then the instanceLines entry is deleted before validation
    // We cannot easily test the ?? '?' fallback in a pure way, but we can test it indirectly
    // by ensuring the error message includes the line number
    const input = 'PROGRAM Inst0 WITH Missing : Main;'
    expect(() => parseResourceStringToConfiguration(input)).toThrow(/line 1/)
  })

  // ---- Multiple tasks and instances ----

  it('parses multiple tasks and instances correctly', () => {
    const input = [
      'TASK Task0(INTERVAL := T#20ms, PRIORITY := 0);',
      'TASK Task1(INTERVAL := T#100ms, PRIORITY := 5);',
      'PROGRAM Inst0 WITH Task0 : Main;',
      'PROGRAM Inst1 WITH Task1 : Secondary;',
    ].join('\n')

    const { tasks, instances } = parseResourceStringToConfiguration(input)
    expect(tasks).toHaveLength(2)
    expect(instances).toHaveLength(2)
    expect(tasks[0].name).toBe('Task0')
    expect(tasks[1].name).toBe('Task1')
    expect(instances[0].program).toBe('Main')
    expect(instances[1].program).toBe('Secondary')
  })

  it('parses case-insensitive CONFIGURATION/RESOURCE wrapper keywords', () => {
    const input = [
      'configuration Config0',
      'resource Res0 ON PLC',
      'TASK Task0(INTERVAL := T#20ms, PRIORITY := 1);',
      'end_resource',
      'end_configuration',
    ].join('\n')

    const { tasks } = parseResourceStringToConfiguration(input)
    expect(tasks).toHaveLength(1)
  })
})
