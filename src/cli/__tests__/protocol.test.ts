import { encodeMessage, type Request, splitLines } from '../session/protocol'

describe('encodeMessage', () => {
  it('emits one newline-terminated document per message', () => {
    const request: Request = { id: 1, kind: 'read', names: ['MAIN.counter'] }

    const line = encodeMessage(request)

    expect(line.endsWith('\n')).toBe(true)
    expect(line.indexOf('\n')).toBe(line.length - 1)
    expect(JSON.parse(line)).toEqual(request)
  })
})

describe('splitLines', () => {
  it('returns complete lines and holds back the trailing partial', () => {
    // The real case: a 500-variable list-vars reply does not arrive whole, so
    // parsing per chunk would drop or corrupt the tail.
    const first = splitLines('', '{"id":1,"ok":true}\n{"id":2,')
    expect(first.lines).toEqual(['{"id":1,"ok":true}'])
    expect(first.rest).toBe('{"id":2,')

    const second = splitLines(first.rest, '"ok":false}\n')
    expect(second.lines).toEqual(['{"id":2,"ok":false}'])
    expect(second.rest).toBe('')
  })

  it('handles a message split across three chunks', () => {
    let rest = ''
    const collected: string[] = []
    for (const chunk of ['{"id', '":7,"ok"', ':true}\n']) {
      const step = splitLines(rest, chunk)
      collected.push(...step.lines)
      rest = step.rest
    }

    expect(collected).toEqual(['{"id":7,"ok":true}'])
    expect(rest).toBe('')
  })

  it('yields several messages that arrive in one chunk', () => {
    const { lines, rest } = splitLines('', '{"a":1}\n{"b":2}\n{"c":3}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
    expect(rest).toBe('')
  })

  it('drops blank and whitespace-only lines rather than passing them to JSON.parse', () => {
    const { lines } = splitLines('', '{"a":1}\n\n   \n{"b":2}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('reports nothing complete for a chunk with no newline', () => {
    const { lines, rest } = splitLines('', '{"partial":')
    expect(lines).toEqual([])
    expect(rest).toBe('{"partial":')
  })
})
