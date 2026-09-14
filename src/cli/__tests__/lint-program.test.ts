/**
 * The linter exists because all of this COMPILES. Every fixture here is a
 * program `check` passes and a PLC would run doing nothing useful.
 *
 * The negative cases matter as much as the positive ones: a rule that fires on
 * correct code teaches an agent to ignore the linter, which is worse than not
 * having one.
 */

import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'
import type { PLCPou, PLCVariable } from '@root/middleware/shared/ports/types'

import { lintProgram } from '../lint/program'

const TON: SystemLibrary = {
  name: 'iec-standard-fb',
  version: '1.0.0',
  pous: [
    {
      name: 'TON',
      type: 'function-block',
      variables: [
        { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'ET', class: 'output', type: { definition: 'base-type', value: 'TIME' } },
      ],
    },
  ],
} as unknown as SystemLibrary

const pou = (name: string, variables: Array<Partial<PLCVariable>>): PLCPou =>
  ({ name, interface: { variables } }) as unknown as PLCPou

const timerPou = pou('Main', [
  { name: 'holdOff', class: 'local', type: { definition: 'derived', value: 'TON' } },
  { name: 'Run', class: 'local', type: { definition: 'base-type', value: 'BOOL' } },
])

const lint = (st: string, pous = [timerPou], globals: Array<Partial<PLCVariable>> = []) =>
  lintProgram({ st, pous, systemLibraries: [TON], globals: globals as PLCVariable[] })

const rules = (st: string, pous?: PLCPou[], globals?: Array<Partial<PLCVariable>>) =>
  lint(st, pous, globals).map((finding) => finding.rule)

describe('a block that is called but never driven', () => {
  it('reports a timer wired EN/ENO with IN left open', () => {
    const findings = lint(`PROGRAM Main
  VAR holdOff : TON; END_VAR
  holdOff(EN := Run, PT := HoldTime);
  Settled := holdOff.ENO;
END_PROGRAM`)

    const primary = findings.find((finding) => finding.rule === 'block-primary-input-unassigned')
    expect(primary?.severity).toBe('error')
    expect(primary?.message).toContain('"IN"')
    // The EN/ENO shape is the cause, so the message says so.
    expect(primary?.message).toContain('EN/ENO')
  })

  it('says nothing when the input IS driven', () => {
    expect(
      rules(`PROGRAM Main
  VAR holdOff : TON; END_VAR
  holdOff(IN := Run, PT := HoldTime);
  Settled := holdOff.Q;
END_PROGRAM`),
    ).toEqual([])
  })

  it('reports a block whose outputs nothing reads', () => {
    expect(
      rules(`PROGRAM Main
  VAR holdOff : TON; END_VAR
  holdOff(IN := Run, PT := HoldTime);
END_PROGRAM`),
    ).toContain('block-outputs-unread')
  })
})

describe('a variable driven more than once', () => {
  it('reports two unconditional assignments', () => {
    const findings = lint(`PROGRAM Main
  VAR holdOff : TON; END_VAR
  holdOff(IN := Run, PT := HoldTime);
  Settled := Ready;
  Settled := holdOff.Q;
END_PROGRAM`)

    const doubled = findings.find((finding) => finding.rule === 'variable-driven-twice')
    expect(doubled?.severity).toBe('error')
    expect(doubled?.message).toContain('double coil')
  })

  it('does NOT report a SET and a RESET coil on the same variable', () => {
    // The idiomatic ladder pair, which transpiles to two guarded assignments.
    // Counting them as a double drive would fire on correct code.
    expect(
      rules(`PROGRAM Main
  VAR holdOff : TON; END_VAR
  holdOff(IN := Run, PT := HoldTime);
  Settled := holdOff.Q;
  R_TRIG1(CLK := Run);
  IF R_TRIG1.Q THEN
    Alarm := FALSE;
  END_IF;
  F_TRIG1(CLK := Run);
  IF F_TRIG1.Q THEN
    Alarm := TRUE;
  END_IF;
END_PROGRAM`),
    ).toEqual([])
  })

  it('does NOT count writes to two members of the same structure', () => {
    expect(
      rules(`PROGRAM Main
  VAR holdOff : TON; END_VAR
  holdOff(IN := Run, PT := HoldTime);
  Settled := holdOff.Q;
  Cfg.MinLevel := 1;
  Cfg.MaxLevel := 9;
END_PROGRAM`),
    ).toEqual([])
  })
})

describe('reaching the outside world', () => {
  const located = [
    { name: 'gStart', location: '%IX0.0' },
    { name: 'gPump', location: '%QX0.0' },
  ]
  const body = `PROGRAM Main
  VAR holdOff : TON; END_VAR
  holdOff(IN := Run, PT := HoldTime);
  Settled := holdOff.Q;
END_PROGRAM`

  it('reports a program that touches no located global at all', () => {
    const findings = lint(body, [timerPou], located)
    const io = findings.find((finding) => finding.rule === 'no-io-referenced')
    expect(io?.severity).toBe('error')
    expect(io?.pou).toBeNull()
  })

  it('reports only the unreferenced one when some I/O is wired', () => {
    const wired = body.replace('holdOff(IN := Run', 'holdOff(IN := gStart')
    const findings = lint(wired, [timerPou], located)

    expect(findings.map((finding) => finding.rule)).toEqual(['located-global-unreferenced'])
    expect(findings[0].severity).toBe('warning')
    expect(findings[0].message).toContain('gPump')
  })

  it('says nothing when every located global is referenced', () => {
    const wired = body.replace('holdOff(IN := Run', 'holdOff(IN := gStart').replace('Settled :=', 'gPump :=')
    expect(rules(wired, [timerPou], located)).toEqual([])
  })

  it('ignores a global a comment merely mentions', () => {
    const commented = body.replace('holdOff(IN := Run', '(* gStart and gPump are spares *)\n  holdOff(IN := Run')
    expect(rules(commented, [timerPou], located)).toContain('no-io-referenced')
  })
})

/**
 * The editor generates this POU itself when a project has SoftMotion axes, so
 * anything it reports here is a finding no author can act on — the worst kind.
 * Both fixtures are the real shape, copied from `--emit-st` output.
 */
describe('a call whose arguments are written one per line', () => {
  const bridge = `PROGRAM __sm3_bridge
  VAR Axis1_drive : SM_DRIVE; Axis2_drive : SM_DRIVE; END_VAR
  Axis1.fScalefactor := 1048576.0;
  Axis1_drive(
  \tAxis := Axis1,
  \twStatusWord := Axis1_statusWord,
  \tbOnline := TRUE,
  \twControlWord => Axis1_controlWord);
  Axis2.fScalefactor := 1.0;
  Axis2_drive(
  \tAxis := Axis2,
  \twStatusWord := Axis2_statusWord,
  \tbOnline := TRUE,
  \twControlWord => Axis2_controlWord);
END_PROGRAM`

  const drive = pou('__sm3_bridge', [
    { name: 'Axis1_drive', class: 'local', type: { definition: 'derived', value: 'SM_DRIVE' } },
    { name: 'Axis2_drive', class: 'local', type: { definition: 'derived', value: 'SM_DRIVE' } },
  ])

  const SM_DRIVE: SystemLibrary = {
    name: 'softmotion',
    version: '1.0.0',
    pous: [
      {
        name: 'SM_DRIVE',
        type: 'function-block',
        variables: [
          { name: 'Axis', class: 'inOut', type: { definition: 'derived', value: 'AXIS_REF_SM3' } },
          { name: 'wStatusWord', class: 'input', type: { definition: 'base-type', value: 'UINT' } },
          { name: 'bOnline', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
          { name: 'wControlWord', class: 'output', type: { definition: 'base-type', value: 'UINT' } },
        ],
      },
    ],
  } as unknown as SystemLibrary

  const findings = () => lintProgram({ st: bridge, pous: [drive], systemLibraries: [SM_DRIVE, TON], globals: [] })

  it('does not read a named argument as an assignment', () => {
    // `wStatusWord := Axis1_statusWord,` on its own line is an argument, not a
    // statement; counting two calls as two drives of "WSTATUSWORD" fires on
    // code the editor itself wrote.
    expect(findings().map((finding) => finding.rule)).not.toContain('variable-driven-twice')
  })

  it('counts an output sent out by the call itself as read', () => {
    expect(findings().map((finding) => finding.rule)).not.toContain('block-outputs-unread')
  })

  it('still reports a genuine double drive around a multi-line call', () => {
    const doubled = bridge.replace(
      'Axis2.fScalefactor := 1.0;',
      'Axis1.fScalefactor := 1.0;\n  Spare := 1;\n  Spare := 2;',
    )
    const rules = lintProgram({
      st: doubled,
      pous: [drive],
      systemLibraries: [SM_DRIVE, TON],
      globals: [],
    }).map((finding) => finding.rule)
    expect(rules).toContain('variable-driven-twice')
  })
})

describe('splitting the ST', () => {
  it('ends a FUNCTION_BLOCK at END_FUNCTION_BLOCK, not at END_FUNCTION', () => {
    // `FUNCTION` is a prefix of `FUNCTION_BLOCK`; matched in the wrong order the
    // block's body is truncated and its calls disappear from the analysis.
    const st = `FUNCTION_BLOCK Latch
  VAR holdOff : TON; END_VAR
  holdOff(EN := Run, PT := HoldTime);
END_FUNCTION_BLOCK

FUNCTION Scale : REAL
  Scale := 1.0;
END_FUNCTION`

    const findings = lintProgram({
      st,
      pous: [pou('Latch', [{ name: 'holdOff', class: 'local', type: { definition: 'derived', value: 'TON' } }])],
      systemLibraries: [TON],
      globals: [],
    })

    expect(findings.map((finding) => finding.rule)).toContain('block-primary-input-unassigned')
    expect(findings[0].pou).toBe('Latch')
  })
})
