import { emitFbdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/fbd'
import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import type { RFBody, RFEdge, RFNode, RFRung } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

// Coverage for the Execute ("ST Block") element — a graphical box holding a
// raw ST snippet, gated by whatever rung condition reaches its EN input and
// passing power straight through on ENO.
//
// Semantics are pinned against a real CODESYS V3.5 SP22 PLCopen export
// (`<block typeName="EXECUTE">` + a `.../plcopenxml/stcode` addData). The
// decisive detail there: a coil downstream of an EXECUTE block references the
// block's localId with NO `formalParameter` qualifier — plain rung
// continuation — so `contact -> EXECUTE -> coil` yields `coil := contact`.

let edgeId = 0
const e = (source: string, target: string): RFEdge => ({ id: `e${edgeId++}`, source, target })

const rail = (id: string, variant: 'left' | 'right', x: number): RFNode => ({
  id,
  type: 'powerRail',
  position: { x, y: 30 },
  data: { variant },
})
const contact = (id: string, name: string, x: number): RFNode => ({
  id,
  type: 'contact',
  position: { x, y: 38 },
  data: { variant: 'default', variable: { name } },
})
const coil = (id: string, name: string, x: number): RFNode => ({
  id,
  type: 'coil',
  position: { x, y: 38 },
  data: { variant: 'default', variable: { name }, executionOrder: 0 },
})
const execute = (id: string, code: string, x: number, executionOrder = 0): RFNode => ({
  id,
  type: 'execute',
  position: { x, y: 38 },
  data: { code, executionOrder },
})
const inVar = (id: string, name: string, x: number): RFNode => ({
  id,
  type: 'input-variable',
  position: { x, y: 38 },
  data: { variant: 'input-variable', variable: { name } },
})
const outVar = (id: string, name: string, x: number): RFNode => ({
  id,
  type: 'output-variable',
  position: { x, y: 38 },
  data: { variant: 'output-variable', variable: { name }, executionOrder: 0 },
})

const ldBody = (nodes: RFNode[], edges: RFEdge[]): RFBody => ({
  rungs: [{ reactFlowViewport: [800, 200], nodes, edges }],
})
const fbdRung = (nodes: RFNode[], edges: RFEdge[]): RFRung => ({ nodes, edges })

beforeEach(() => {
  edgeId = 0
})

describe('Execute element — rung gating', () => {
  it('gates the snippet on the rung condition and passes power through to the coil', () => {
    // The exact topology from the CODESYS export:
    //   leftPowerRail -> contact(myContact) -> EXECUTE -> coil(myCoil)
    const body = ldBody(
      [
        rail('L', 'left', 0),
        contact('C', 'myContact', 68),
        execute('X', '// Comment in ST Block\nmyNewValue := myValue + 10;\n', 200),
        coil('K', 'myCoil', 400),
        rail('R', 'right', 600),
      ],
      [e('L', 'C'), e('C', 'X'), e('X', 'K'), e('K', 'R')],
    )

    const { bodySt, warnings } = emitLdBody(body)

    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        '  IF myContact THEN\n' +
        '    // Comment in ST Block\n' +
        '    myNewValue := myValue + 10;\n' +
        '  END_IF;\n' +
        '  myCoil := myContact;\n',
    )
  })

  it('emits the snippet bare when the box sits directly on the left rail', () => {
    // A trivially-true condition would only produce `IF TRUE THEN`, which is
    // noise. The body runs every scan either way.
    const body = ldBody(
      [rail('L', 'left', 0), execute('X', 'counter := counter + 1;', 200), rail('R', 'right', 400)],
      [e('L', 'X'), e('X', 'R')],
    )

    const { bodySt, warnings } = emitLdBody(body)

    expect(warnings).toEqual([])
    expect(bodySt).toBe('\n  counter := counter + 1;\n')
  })

  it('emits the snippet bare in FBD when EN is left unwired', () => {
    const { bodySt, warnings } = emitFbdBody({
      rung: fbdRung([execute('X', 'myNewVarFBD := myNewVarFBD + 222;', 0)], []),
    })

    expect(warnings).toEqual([])
    expect(bodySt).toBe('\n  myNewVarFBD := myNewVarFBD + 222;\n')
  })

  it('combines a multi-contact rung condition into one IF', () => {
    const body = ldBody(
      [
        rail('L', 'left', 0),
        contact('C1', 'a', 68),
        contact('C2', 'b', 140),
        execute('X', 'total := total + 1;', 260),
        rail('R', 'right', 500),
      ],
      [e('L', 'C1'), e('C1', 'C2'), e('C2', 'X'), e('X', 'R')],
    )

    const { bodySt, warnings } = emitLdBody(body)

    expect(warnings).toEqual([])
    // `b AND a`, not `a AND b` — `visitContact` emits each contact's own
    // variable ahead of its upstream chain, so the term nearest the sink leads.
    // That is the walker's established convention (it matches the python
    // oracle) and is unchanged by the Execute element; asserted here only to
    // pin that Execute consumes the condition like any other sink.
    expect(bodySt).toBe('\n  IF b AND a THEN\n    total := total + 1;\n  END_IF;\n')
  })
})

describe('Execute element — snippet re-indentation', () => {
  it('preserves relative nesting and blank lines inside the generated IF', () => {
    const code = ['IF a < 10 THEN', '    b := 1;', '', '    c := 2;', 'END_IF;'].join('\n')
    const body = ldBody(
      [rail('L', 'left', 0), contact('C', 'gate', 68), execute('X', code, 200), rail('R', 'right', 500)],
      [e('L', 'C'), e('C', 'X'), e('X', 'R')],
    )

    const { bodySt } = emitLdBody(body)

    expect(bodySt).toBe(
      '\n' +
        '  IF gate THEN\n' +
        '    IF a < 10 THEN\n' +
        '        b := 1;\n' +
        '\n' + // blank lines stay blank, not trailing whitespace
        '        c := 2;\n' +
        '    END_IF;\n' +
        '  END_IF;\n',
    )
  })

  it('strips a common leading margin so an indented snippet is not double-indented', () => {
    const code = ['    x := 1;', '    y := 2;'].join('\n')
    const body = ldBody(
      [rail('L', 'left', 0), execute('X', code, 200), rail('R', 'right', 400)],
      [e('L', 'X'), e('X', 'R')],
    )

    expect(emitLdBody(body).bodySt).toBe('\n  x := 1;\n  y := 2;\n')
  })

  it('normalises CRLF endings and trims surrounding blank lines', () => {
    // CODESYS writes a trailing newline for LD payloads but not FBD ones, so
    // emission must not depend on either being present.
    const body = ldBody(
      [rail('L', 'left', 0), execute('X', '\r\n\r\nx := 1;\r\ny := 2;\r\n\r\n', 200), rail('R', 'right', 400)],
      [e('L', 'X'), e('X', 'R')],
    )

    expect(emitLdBody(body).bodySt).toBe('\n  x := 1;\n  y := 2;\n')
  })
})

describe('Execute element — ENO passthrough', () => {
  it('does not wrap a downstream FBD assignment in an ENO check', () => {
    // `getUsedEnoForNode` wraps an outVariable in `IF <block>.ENO THEN` when
    // its single upstream is a *block* with EN wired. An Execute node must not
    // trigger that: there is no `_TMP_..._ENO` for EXECUTE, so the downstream
    // condition has to rebuild from the rung instead.
    const { bodySt, warnings } = emitFbdBody({
      rung: fbdRung(
        [inVar('IV', 'flag', 0), execute('X', 'side := side + 1;', 200), outVar('OV', 'result', 400)],
        [e('IV', 'X'), e('X', 'OV')],
      ),
    })

    expect(warnings).toEqual([])
    expect(bodySt).toBe('\n  IF flag THEN\n    side := side + 1;\n  END_IF;\n  result := flag;\n')
    expect(bodySt).not.toContain('ENO')
  })

  it('feeds a chain of two Execute boxes from the same rung condition', () => {
    const body = ldBody(
      [
        rail('L', 'left', 0),
        contact('C', 'gate', 68),
        execute('X1', 'first := 1;', 200),
        execute('X2', 'second := 2;', 400),
        coil('K', 'done', 600),
        rail('R', 'right', 800),
      ],
      [e('L', 'C'), e('C', 'X1'), e('X1', 'X2'), e('X2', 'K'), e('K', 'R')],
    )

    const { bodySt, warnings } = emitLdBody(body)

    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        '  IF gate THEN\n    first := 1;\n  END_IF;\n' +
        '  IF gate THEN\n    second := 2;\n  END_IF;\n' +
        '  done := gate;\n',
    )
  })
})

describe('Execute element — ordering', () => {
  it('honours an explicit executionOrder ahead of the positional sweep', () => {
    // X2 sits to the LEFT of X1 but carries the higher order, so position
    // alone would emit it first; the explicit order must win.
    const body = ldBody(
      [
        rail('L', 'left', 0),
        contact('C', 'gate', 68),
        execute('X1', 'first := 1;', 400, 1),
        execute('X2', 'second := 2;', 200, 2),
        rail('R', 'right', 800),
      ],
      [e('L', 'C'), e('C', 'X1'), e('C', 'X2')],
    )

    const { bodySt } = emitLdBody(body)

    expect(bodySt).toBe('\n  IF gate THEN\n    first := 1;\n  END_IF;\n  IF gate THEN\n    second := 2;\n  END_IF;\n')
  })

  it('falls back to left-to-right position when no order is set', () => {
    const body = ldBody(
      [
        rail('L', 'left', 0),
        contact('C', 'gate', 68),
        execute('XB', 'b := 1;', 400),
        execute('XA', 'a := 1;', 200),
        rail('R', 'right', 800),
      ],
      [e('L', 'C'), e('C', 'XA'), e('C', 'XB')],
    )

    expect(emitLdBody(body).bodySt).toBe(
      '\n  IF gate THEN\n    a := 1;\n  END_IF;\n  IF gate THEN\n    b := 1;\n  END_IF;\n',
    )
  })
})

describe('Execute element — malformed input', () => {
  it('warns and emits nothing for an empty snippet', () => {
    const body = ldBody(
      [rail('L', 'left', 0), contact('C', 'gate', 68), execute('X', '   \n\n  ', 200), rail('R', 'right', 400)],
      [e('L', 'C'), e('C', 'X'), e('X', 'R')],
    )

    const { bodySt, warnings } = emitLdBody(body)

    expect(warnings).toEqual(['Execute block "X" is empty.'])
    // No hollow `IF gate THEN END_IF;`
    expect(bodySt).toBe('\n')
  })

  it('warns when the node payload has no code field', () => {
    const body = ldBody(
      [
        rail('L', 'left', 0),
        { id: 'X', type: 'execute', position: { x: 200, y: 38 }, data: { executionOrder: 0 } },
        rail('R', 'right', 400),
      ],
      [e('L', 'X'), e('X', 'R')],
    )

    const { bodySt, warnings } = emitLdBody(body)

    expect(warnings).toEqual(['execute node "X" has unrecognised data shape'])
    expect(bodySt).toBe('\n')
  })
})
