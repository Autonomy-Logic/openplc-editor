import {
  buildIOGroupExportFileName,
  detectCsvDelimiter,
  detectIOGroupFileFormat,
  findIOGroupNameConflicts,
  IO_GROUP_IMPORT_MAX_GROUPS,
  IO_GROUP_TRANSFER_FORMAT_ID,
  type IOGroupDraft,
  parseCsv,
  parseIOGroupsCsv,
  parseIOGroupsFile,
  parseIOGroupsJson,
  serializeIOGroupsToCsv,
  serializeIOGroupsToJson,
} from '../io-group-transfer'

const HEADER = 'name,functionCode,cycleTime,offset,length,errorHandling'

const sample: IOGroupDraft[] = [
  { name: 'Temperatures', functionCode: '3', cycleTime: 100, offset: '0', length: 10, errorHandling: 'set-to-zero' },
  {
    name: 'Valve, main "A"',
    functionCode: '5',
    cycleTime: 250,
    offset: '12',
    length: 1,
    errorHandling: 'keep-last-value',
  },
  { name: 'Coils', functionCode: '15', cycleTime: 50, offset: '100', length: 16, errorHandling: 'keep-last-value' },
]

describe('parseCsv', () => {
  it('handles quoted delimiters, escaped quotes and embedded line breaks', () => {
    const { records, error } = parseCsv('a,b\r\n"x,1","say ""hi""\nthere"\r\nlast,row', ',')
    expect(error).toBeUndefined()
    expect(records.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['x,1', 'say "hi"\nthere'],
      ['last', 'row'],
    ])
    // The record after a multi-line field starts on its physical line.
    expect(records.map((r) => r.line)).toEqual([1, 2, 4])
  })

  it('reports an unterminated quote', () => {
    expect(parseCsv('a,b\n"open,1', ',').error).toMatch(/never closed/)
  })

  it('reports a stray quote inside an unquoted field', () => {
    expect(parseCsv('ab"c,1', ',').error).toMatch(/unexpected quote/)
  })
})

describe('detectCsvDelimiter', () => {
  it('detects comma, semicolon (Excel pt-BR) and tab', () => {
    expect(detectCsvDelimiter('name,functionCode\n')).toBe(',')
    expect(detectCsvDelimiter('name;functionCode;length\n')).toBe(';')
    expect(detectCsvDelimiter('name\tfunctionCode\n')).toBe('\t')
  })

  it('ignores delimiters inside quotes', () => {
    expect(detectCsvDelimiter('"a,b,c";x;y\n')).toBe(';')
  })
})

describe('parseIOGroupsCsv', () => {
  it('parses a full file', () => {
    const result = parseIOGroupsCsv(`${HEADER}\nTemps,3,200,10,4,set-to-zero\nOut,16,100,0,2,\n`)
    expect(result.errors).toEqual([])
    expect(result.groups).toEqual([
      { name: 'Temps', functionCode: '3', cycleTime: 200, offset: '10', length: 4, errorHandling: 'set-to-zero' },
      { name: 'Out', functionCode: '16', cycleTime: 100, offset: '0', length: 2, errorHandling: 'keep-last-value' },
    ])
  })

  it('applies the form defaults to missing optional columns', () => {
    const result = parseIOGroupsCsv('name,functionCode\nG1,4\n')
    expect(result.errors).toEqual([])
    expect(result.groups[0]).toEqual({
      name: 'G1',
      functionCode: '4',
      cycleTime: 100,
      offset: '0',
      length: 1,
      errorHandling: 'keep-last-value',
    })
  })

  it('accepts form labels as headers and values, a BOM, CRLF and semicolons', () => {
    const csv =
      '\uFEFFName;Function Code;Cycle Time (ms);Offset;Length;Error Handling\r\n' +
      'G1;Read Holding Registers (FC 3);100;0x10;2;Set to zero\r\n' +
      'G2;FC 1;100;5;8;Keep last value\r\n'
    const result = parseIOGroupsCsv(csv)
    expect(result.errors).toEqual([])
    expect(result.groups.map((g) => [g.functionCode, g.offset, g.errorHandling])).toEqual([
      ['3', '16', 'set-to-zero'],
      ['1', '5', 'keep-last-value'],
    ])
  })

  it('skips blank lines', () => {
    const result = parseIOGroupsCsv(`${HEADER}\n\nG1,3,100,0,1,\n\n`)
    expect(result.errors).toEqual([])
    expect(result.groups).toHaveLength(1)
  })

  it('rejects a file without the required columns', () => {
    const result = parseIOGroupsCsv('name,length\nG1,2\n')
    expect(result.groups).toEqual([])
    expect(result.errors[0].message).toMatch(/Missing required column: functionCode/)
  })

  it('rejects duplicated columns and warns about unknown ones', () => {
    const dup = parseIOGroupsCsv('name,fc,functionCode\nG1,3,3\n')
    expect(dup.errors[0].message).toMatch(/more than once/)

    const unknown = parseIOGroupsCsv('name,functionCode,comment\nG1,3,hello\n')
    expect(unknown.errors).toEqual([])
    expect(unknown.warnings[0].message).toMatch(/Unknown column "comment"/)
  })

  it('collects every invalid row with its line number and imports nothing', () => {
    const csv = [
      HEADER,
      'Good,3,100,0,1,', // line 2
      ',3,100,0,1,', // line 3: no name
      'BadFc,7,100,0,1,', // line 4
      'BadLen,3,100,0,126,', // line 5: > 125 for FC 3
      'BadOffset,3,100,70000,1,', // line 6
      'BadCycle,3,0,0,1,', // line 7
      'BadEh,3,100,0,1,maybe', // line 8
      'Overflow,4,100,65530,10,', // line 9
    ].join('\n')
    const result = parseIOGroupsCsv(csv)
    expect(result.groups).toEqual([])
    expect(result.errors.map((e) => [e.row, e.field])).toEqual([
      [3, 'name'],
      [4, 'functionCode'],
      [5, 'length'],
      [6, 'offset'],
      [7, 'cycleTime'],
      [8, 'errorHandling'],
      [9, 'length'],
    ])
    expect(result.errors[2].message).toBe('FC 3 addresses at most 125 elements per request.')
  })

  it('rejects non-integer numbers', () => {
    const result = parseIOGroupsCsv(`${HEADER}\nG,3,1e3,1.5,2.5,\n`)
    expect(result.errors.map((e) => e.field)).toEqual(['cycleTime', 'offset', 'length'])
  })

  it('rejects duplicate names case-insensitively', () => {
    const result = parseIOGroupsCsv(`${HEADER}\nPump,3,100,0,1,\npump,4,100,0,1,\n`)
    expect(result.groups).toEqual([])
    expect(result.errors).toEqual([{ row: 3, field: 'name', message: 'Duplicate name "pump" (first used on row 2).' }])
  })

  it('forces length 1 on FC 5/6 and drops error handling on write codes, with warnings', () => {
    const result = parseIOGroupsCsv(`${HEADER}\nW,6,100,0,4,set-to-zero\n`)
    expect(result.errors).toEqual([])
    expect(result.groups[0]).toMatchObject({ length: 1, errorHandling: 'keep-last-value' })
    expect(result.warnings.map((w) => w.field)).toEqual(['length', 'errorHandling'])
  })

  it('rejects rows with more cells than the header', () => {
    const result = parseIOGroupsCsv('name,functionCode\nG1,3,extra\n')
    expect(result.errors[0]).toMatchObject({ row: 2 })
  })

  it('rejects an empty file and a header-only file', () => {
    expect(parseIOGroupsCsv('').errors[0].message).toBe('The file is empty.')
    expect(parseIOGroupsCsv(`${HEADER}\n`).errors[0].message).toBe('The file contains no IO groups.')
  })

  it('enforces the maximum number of groups', () => {
    const rows = Array.from({ length: IO_GROUP_IMPORT_MAX_GROUPS + 1 }, (_, i) => `G${i},3`)
    const result = parseIOGroupsCsv(`name,functionCode\n${rows.join('\n')}`)
    expect(result.errors[0].message).toMatch(/at most/)
  })

  it('rejects names with control characters or over the length limit', () => {
    const result = parseIOGroupsCsv(`name,functionCode\n"a\tb",3\n${'x'.repeat(65)},3\n`)
    expect(result.errors.map((e) => e.field)).toEqual(['name', 'name'])
  })
})

describe('parseIOGroupsJson', () => {
  it('parses the export envelope', () => {
    const json = JSON.stringify({
      format: IO_GROUP_TRANSFER_FORMAT_ID,
      version: 1,
      ioGroups: [{ name: 'G1', functionCode: 3, cycleTime: 100, offset: 0, length: 2, errorHandling: 'set-to-zero' }],
    })
    const result = parseIOGroupsJson(json)
    expect(result.errors).toEqual([])
    expect(result.groups[0]).toEqual({
      name: 'G1',
      functionCode: '3',
      cycleTime: 100,
      offset: '0',
      length: 2,
      errorHandling: 'set-to-zero',
    })
  })

  it('parses a bare array with string values and ignores id / ioPoints silently', () => {
    const result = parseIOGroupsJson(
      JSON.stringify([{ id: 'x', ioPoints: [], name: 'G1', functionCode: '16', length: '3' }]),
    )
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.groups[0]).toMatchObject({ functionCode: '16', length: 3 })
  })

  it('warns once about unknown fields', () => {
    const result = parseIOGroupsJson(
      JSON.stringify([
        { name: 'A', functionCode: 3, note: 1 },
        { name: 'B', functionCode: 3, note: 2 },
      ]),
    )
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([{ row: null, message: 'Unknown field ignored: note.' }])
  })

  it('reports syntax errors, wrong formats and future versions', () => {
    expect(parseIOGroupsJson('{ broken').errors[0].message).toMatch(/^Invalid JSON/)
    expect(parseIOGroupsJson('{"format":"other","ioGroups":[]}').errors[0].message).toMatch(/Unrecognized file format/)
    expect(
      parseIOGroupsJson(`{"format":"${IO_GROUP_TRANSFER_FORMAT_ID}","version":99,"ioGroups":[]}`).errors[0].message,
    ).toMatch(/version 99/)
    expect(parseIOGroupsJson('{"foo":1}').errors[0].message).toMatch(/Missing "ioGroups"/)
    expect(parseIOGroupsJson('{"ioGroups":{}}').errors[0].message).toMatch(/must be an array/)
    expect(parseIOGroupsJson('42').errors[0].message).toMatch(/Expected a JSON array/)
    expect(parseIOGroupsJson('[]').errors[0].message).toBe('The file contains no IO groups.')
  })

  it('rejects wrong value types with the item position', () => {
    const result = parseIOGroupsJson(
      JSON.stringify([
        { name: 'A', functionCode: 3 },
        'nope',
        { name: 'C', functionCode: true },
        { name: 'D', functionCode: 3, length: 2.5 },
        { name: { x: 1 }, functionCode: 3 },
      ]),
    )
    expect(result.groups).toEqual([])
    expect(result.errors.map((e) => [e.row, e.field])).toEqual([
      [2, undefined],
      [3, 'functionCode'],
      [4, 'length'],
      [5, 'name'],
    ])
  })
})

describe('round trip', () => {
  it('CSV export → import preserves every field, including quoted names', () => {
    const result = parseIOGroupsCsv(serializeIOGroupsToCsv(sample))
    expect(result.errors).toEqual([])
    expect(result.groups).toEqual(sample)
  })

  it('JSON export → import preserves every field', () => {
    const result = parseIOGroupsJson(serializeIOGroupsToJson(sample))
    expect(result.errors).toEqual([])
    expect(result.groups).toEqual(sample)
  })

  it('guards CSV formula injection on export and restores the name on import', () => {
    const risky: IOGroupDraft[] = [{ ...sample[0], name: '=HYPERLINK("x")' }]
    const csv = serializeIOGroupsToCsv(risky)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(parseIOGroupsCsv(csv).groups[0].name).toBe('=HYPERLINK("x")')
  })

  it('writes a BOM and CRLF line endings in CSV', () => {
    const csv = serializeIOGroupsToCsv(sample)
    expect(csv.startsWith(`\uFEFF${HEADER}\r\n`)).toBe(true)
  })
})

describe('file helpers', () => {
  it('detects the format by extension or content', () => {
    expect(detectIOGroupFileFormat('map.JSON', '')).toBe('json')
    expect(detectIOGroupFileFormat('map.csv', '[')).toBe('csv')
    expect(detectIOGroupFileFormat('map', '  [{}]')).toBe('json')
    expect(detectIOGroupFileFormat('map', 'name,fc')).toBe('csv')
    expect(detectIOGroupFileFormat('map.xlsx', '')).toBeNull()
    expect(parseIOGroupsFile('map.xlsx', '').errors[0].message).toMatch(/Unsupported file type/)
  })

  it('finds name conflicts with existing groups case-insensitively', () => {
    expect(findIOGroupNameConflicts(sample, ['temperatures', 'Other'])).toEqual(['Temperatures'])
  })

  it('builds a filesystem-safe export name', () => {
    expect(buildIOGroupExportFileName('MD1', 'csv')).toBe('MD1-io-groups.csv')
    expect(buildIOGroupExportFileName('Rack 1/Slot:2', 'json')).toBe('Rack_1_Slot_2-io-groups.json')
  })
})
