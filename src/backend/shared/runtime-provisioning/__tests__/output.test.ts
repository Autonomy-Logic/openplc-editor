import {
  CONSOLE_LINE_LIMIT,
  createConsoleBound,
  createDialogTail,
  createLinePipeline,
  DIALOG_LINE_LIMIT,
  LINE_CHAR_LIMIT,
  LINE_TRUNCATION_MARKER,
  OUTPUT_TRUNCATED_LINE,
  PASSWORD_MASK,
  POLL_READ_BYTES,
  scrubPassword,
} from '../output'

const PASSWORD = 'S3cr3t-Pi!'
const FROM_START = { startsMidLine: false }

function truncated(line: string): string {
  return `${line.slice(0, LINE_CHAR_LIMIT)}${LINE_TRUNCATION_MARKER}`
}

function chunksOf(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let start = 0; start < text.length; start += size) chunks.push(text.slice(start, start + size))
  return chunks
}

function runPipeline(password: string, text: string, chunkSize: number): string[] {
  const pipeline = createLinePipeline(password)
  const out = chunksOf(text, chunkSize).flatMap((chunk) => pipeline.push(chunk, FROM_START))
  return [...out, ...pipeline.end()]
}

describe('output bounds', () => {
  it('cuts lines at 4,096 characters, keeps 200 dialog lines and 10,000 console lines, and reads 64 KiB per poll', () => {
    expect(LINE_CHAR_LIMIT).toBe(4096)
    expect(DIALOG_LINE_LIMIT).toBe(200)
    expect(CONSOLE_LINE_LIMIT).toBe(10_000)
    expect(POLL_READ_BYTES).toBe(65_536)
  })

  it('uses non-empty markers and mask', () => {
    expect(LINE_TRUNCATION_MARKER.length).toBeGreaterThan(0)
    expect(OUTPUT_TRUNCATED_LINE.length).toBeGreaterThan(0)
    expect(PASSWORD_MASK.length).toBeGreaterThan(0)
  })
})

describe('scrubPassword', () => {
  it('replaces each occurrence of the password with the mask', () => {
    expect(scrubPassword(`[sudo] ${PASSWORD} and ${PASSWORD}${PASSWORD}`, PASSWORD)).toBe(
      `[sudo] ${PASSWORD_MASK} and ${PASSWORD_MASK}${PASSWORD_MASK}`,
    )
  })

  it('leaves text without the password unchanged, including the username', () => {
    expect(scrubPassword('Connected as commissioner42', PASSWORD)).toBe('Connected as commissioner42')
  })

  it('masks every occurrence of a one-character password', () => {
    const scrubbed = scrubPassword('banana', 'a')

    expect(scrubbed).not.toContain('a')
    expect(scrubbed).toBe(PASSWORD_MASK.includes('a') ? 'bnn' : `b${PASSWORD_MASK}n${PASSWORD_MASK}n${PASSWORD_MASK}`)
  })

  it('removes the password instead when it equals the mask', () => {
    expect(scrubPassword(`1${PASSWORD_MASK}2${PASSWORD_MASK}${PASSWORD_MASK}3`, PASSWORD_MASK)).toBe('123')
  })

  it('removes a password that is part of the mask', () => {
    const password = PASSWORD_MASK.slice(0, 1)

    expect(scrubPassword(`x${password}y${password}z`, password)).not.toContain(password)
  })

  it('never leaves the password when the mask would recreate an occurrence', () => {
    const password = `${PASSWORD_MASK}z`

    expect(scrubPassword(`${PASSWORD_MASK}${PASSWORD_MASK}zz`, password)).not.toContain(password)
  })

  it('never leaves the password when a removal joins two halves into a new occurrence', () => {
    expect(scrubPassword('aabb', 'ab')).not.toContain('ab')
  })
})

describe('createLinePipeline', () => {
  it('returns each complete line and drops a trailing carriage return', () => {
    const pipeline = createLinePipeline(PASSWORD)

    expect(pipeline.push('first\r\nsecond\n\nthird\n', FROM_START)).toEqual(['first', 'second', '', 'third'])
  })

  it('holds a partial line until its newline arrives', () => {
    const pipeline = createLinePipeline(PASSWORD)

    expect(pipeline.push('Downloading ima', FROM_START)).toEqual([])
    expect(pipeline.push('ge layers\nPul', FROM_START)).toEqual(['Downloading image layers'])
    expect(pipeline.push('ling\n', FROM_START)).toEqual(['Pulling'])
  })

  it('returns the held partial line at the end', () => {
    const pipeline = createLinePipeline(PASSWORD)
    pipeline.push('done\nno newline', FROM_START)

    expect(pipeline.end()).toEqual(['no newline'])
  })

  it('returns nothing at the end when no partial line is held', () => {
    const pipeline = createLinePipeline(PASSWORD)
    pipeline.push('done\n', FROM_START)

    expect(pipeline.end()).toEqual([])
  })

  it('drops the text before the first newline of a chunk that starts mid-line', () => {
    const pipeline = createLinePipeline(PASSWORD)

    expect(pipeline.push('of a cut line\nnext line\ntail', { startsMidLine: true })).toEqual(['next line'])
    expect(pipeline.end()).toEqual(['tail'])
  })

  it('scrubs a password whole inside one chunk', () => {
    expect(runPipeline(PASSWORD, `[sudo] password: ${PASSWORD}\n`, 1000)).toEqual([`[sudo] password: ${PASSWORD_MASK}`])
  })

  it('scrubs a password split across two pushes', () => {
    const pipeline = createLinePipeline(PASSWORD)

    const first = pipeline.push('echo S3cr3', FROM_START)
    const second = pipeline.push('t-Pi! ok\n', FROM_START)

    expect([...first, ...second]).toEqual([`echo ${PASSWORD_MASK} ok`])
  })

  it('never returns the start of a mid-line chunk that begins mid-password', () => {
    const pipeline = createLinePipeline(PASSWORD)

    const out = [...pipeline.push('t-Pi! leaked?\nclean line\n', { startsMidLine: true }), ...pipeline.end()]

    expect(out).toEqual(['clean line'])
  })

  it('scrubs before cutting, so a password across the cut never leaks in part', () => {
    const line = `${'x'.repeat(LINE_CHAR_LIMIT - 6)}${PASSWORD}${'y'.repeat(100)}`

    const out = runPipeline(PASSWORD, `${line}\n`, 1000)

    expect(out).toEqual([truncated(`${'x'.repeat(LINE_CHAR_LIMIT - 6)}${PASSWORD_MASK}${'y'.repeat(100)}`)])
    expect(out[0]).not.toContain('S3cr')
  })

  it('masks every a of a one-character password', () => {
    const out = runPipeline('a', 'banana\nabc\n', 3)

    expect(out).toHaveLength(2)
    expect(out.join('\n')).not.toContain('a')
  })

  it('keeps a line of exactly 4,096 characters whole', () => {
    const line = 'z'.repeat(LINE_CHAR_LIMIT)

    expect(runPipeline(PASSWORD, `${line}\n`, 1000)).toEqual([line])
  })

  it('cuts a line of 4,097 characters to 4,096 plus the marker', () => {
    const line = 'z'.repeat(LINE_CHAR_LIMIT + 1)

    expect(runPipeline(PASSWORD, `${line}\n`, 1000)).toEqual([truncated(line)])
  })

  it('cuts a partial line returned at the end', () => {
    const pipeline = createLinePipeline(PASSWORD)
    pipeline.push('q'.repeat(LINE_CHAR_LIMIT + 10), FROM_START)

    expect(pipeline.end()).toEqual([truncated('q'.repeat(LINE_CHAR_LIMIT + 10))])
  })

  it('turns a 100 MB line into one line of 4,096 characters plus the marker', () => {
    const pipeline = createLinePipeline(PASSWORD)
    const huge = 'h'.repeat(100_000_000)

    const out = [...pipeline.push(huge, FROM_START), ...pipeline.push('\n', FROM_START), ...pipeline.end()]

    expect(out.map((line) => line.length)).toEqual([LINE_CHAR_LIMIT + LINE_TRUNCATION_MARKER.length])
    expect(out[0] === truncated(huge)).toBe(true)
  })
})

describe('createConsoleBound', () => {
  it('passes the first 10,000 lines, then one truncation line, then nothing', () => {
    const bound = createConsoleBound()
    const accepted = Array.from({ length: CONSOLE_LINE_LIMIT }, (_, index) => bound.accept(`line ${index + 1}`))

    expect(accepted.every((result, index) => result.length === 1 && result[0] === `line ${index + 1}`)).toBe(true)
    expect(bound.accept('line 10001')).toEqual([OUTPUT_TRUNCATED_LINE])
    expect(bound.accept('line 10002')).toEqual([])
    expect(bound.accept('line 10003')).toEqual([])
  })
})

describe('createDialogTail', () => {
  it('has no lines and no latest line before any push', () => {
    const tail = createDialogTail()

    expect(tail.lines()).toEqual([])
    expect(tail.latest()).toBeNull()
  })

  it('keeps every line while under the limit and reports the last one', () => {
    const tail = createDialogTail()
    tail.push('one')
    tail.push('two')

    expect(tail.lines()).toEqual(['one', 'two'])
    expect(tail.latest()).toBe('two')
  })

  it('keeps only the last 200 lines', () => {
    const tail = createDialogTail()
    for (let index = 1; index <= 450; index += 1) tail.push(`line ${index}`)

    expect(tail.lines()).toEqual(Array.from({ length: DIALOG_LINE_LIMIT }, (_, index) => `line ${index + 251}`))
    expect(tail.latest()).toBe('line 450')
  })
})

describe('installer output end to end through the bounds', () => {
  function feed(text: string, chunkSize: number): { console: string[]; dialog: string[]; latest: string | null } {
    const pipeline = createLinePipeline(PASSWORD)
    const bound = createConsoleBound()
    const tail = createDialogTail()
    const consoleLines: string[] = []
    const take = (line: string): void => {
      consoleLines.push(...bound.accept(line))
      tail.push(line)
    }
    for (const chunk of chunksOf(text, chunkSize)) pipeline.push(chunk, FROM_START).forEach(take)
    pipeline.end().forEach(take)
    return { console: consoleLines, dialog: tail.lines(), latest: tail.latest() }
  }

  it('shows the last 200 of 240 lines, cuts line 230 and never shows the password', () => {
    const longLine = `line 230 ${'w'.repeat(LINE_CHAR_LIMIT - 12)}${PASSWORD}${'w'.repeat(5000)}`.slice(0, 5000)
    const original = Array.from({ length: 240 }, (_, index) => {
      const number = index + 1
      if (number === 230) return longLine
      if (number % 37 === 0) return `line ${number} sudo echoed ${PASSWORD}`
      return `line ${number}`
    })

    const result = feed(`${original.join('\n')}\n`, 777)

    expect(original[229]).toHaveLength(5000)
    expect(result.console).toHaveLength(240)
    expect(result.dialog).toHaveLength(DIALOG_LINE_LIMIT)
    expect(result.dialog[0]).toBe('line 41')
    expect(result.latest).toBe('line 240')
    expect(result.dialog).toEqual(result.console.slice(40))
    expect(result.console[229]).toBe(truncated(original[229].replace(PASSWORD, PASSWORD_MASK)))
    expect(result.console[229].endsWith(LINE_TRUNCATION_MARKER)).toBe(true)
    expect(result.console.some((line) => line.includes('S3c'))).toBe(false)
    expect(result.dialog.some((line) => line.includes(PASSWORD))).toBe(false)
  })

  it('bounds 10,050 lines: 10,000 console lines then one truncation line, and the last 200 in the dialog', () => {
    const original = Array.from({ length: 10_050 }, (_, index) => {
      const number = index + 1
      if (number === 10_000) return 'line 10000 '.padEnd(LINE_CHAR_LIMIT, 'm')
      if (number === 10_001) return 'line 10001 '.padEnd(LINE_CHAR_LIMIT + 1, 'n')
      return `line ${number}`
    })

    const result = feed(`${original.join('\n')}\n`, POLL_READ_BYTES)

    expect(result.console).toHaveLength(CONSOLE_LINE_LIMIT + 1)
    expect(result.console.slice(0, CONSOLE_LINE_LIMIT)).toEqual(original.slice(0, CONSOLE_LINE_LIMIT))
    expect(result.console[9999]).toHaveLength(LINE_CHAR_LIMIT)
    expect(result.console[CONSOLE_LINE_LIMIT]).toBe(OUTPUT_TRUNCATED_LINE)
    expect(result.dialog).toHaveLength(DIALOG_LINE_LIMIT)
    expect(result.dialog[0]).toBe('line 9851')
    expect(result.dialog[150]).toBe(truncated(original[10_000]))
    expect(result.latest).toBe('line 10050')
  })
})
