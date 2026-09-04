import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EXECUTE_STCODE_URI_OPENPLC, readExecuteStCode } from '../../execute-plcopen'
import { parsePlcopenXml } from '../index'
import { collectExecuteStCode } from '../parse-xml-document'

// Fixture is a REAL export from CODESYS V3.5 SP22 Patch 1, not a hand-written
// approximation — it is the authority for the Execute ("ST Block") wire shape:
// an ordinary `<block typeName="EXECUTE">` with EN/ENO formal parameters and
// the snippet in a `.../plcopenxml/stcode` addData.
const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'codesys-execute.xml'), 'utf8')

// A round trip through our own exporter: LD rungs with several Execute boxes
// plus an FBD POU containing one.
const OWN_EXPORT = readFileSync(join(__dirname, 'fixtures', 'openplc-execute.xml'), 'utf8')

describe('readExecuteStCode', () => {
  it('returns null only for a block that is not an Execute element', () => {
    expect(readExecuteStCode({ '@typeName': 'TON' })).toBeNull()
    expect(readExecuteStCode(undefined)).toBeNull()
    expect(readExecuteStCode('not a record')).toBeNull()
  })

  it('treats typeName alone as the discriminator, snippet or not', () => {
    // EXECUTE is the wire name reserved for this element, so a block that says
    // so is one even when the payload is missing or written under a URI we do
    // not know. It imports as an empty box the user can fill in — better than a
    // nameless function block with pins that resolve to nothing.
    expect(readExecuteStCode({ '@typeName': 'EXECUTE' })).toBe('')
    expect(readExecuteStCode({ '@typeName': 'EXECUTE', addData: { data: { '@name': 'urn:unknown' } } })).toBe('')
    expect(readExecuteStCode({ '@typeName': 'EXECUTE', addData: 'nonsense' })).toBe('')
    // A recognised URI whose <STCode> is neither a string nor a text-bearing
    // record: the entry matched, so stop looking rather than falling through
    // to another vendor's entry.
    expect(
      readExecuteStCode({
        '@typeName': 'EXECUTE',
        addData: { data: [{ '@name': EXECUTE_STCODE_URI_OPENPLC, STCode: 42 }] },
      }),
    ).toBe('')
    expect(readExecuteStCode({ '@typeName': 'EXECUTE', addData: { data: [null, 'x'] } })).toBe('')
  })

  it('reads the snippet from our own openplc.org stcode addData', () => {
    const code = readExecuteStCode({
      '@typeName': 'EXECUTE',
      addData: {
        data: { '@name': 'http://openplc.org/plcopenxml/stcode', STCode: { $: 'x := 1;' } },
      },
    })
    expect(code).toBe('x := 1;')
  })

  it("also reads 3S's URI, so a CODESYS export still imports", () => {
    const code = readExecuteStCode({
      '@typeName': 'EXECUTE',
      addData: {
        data: {
          '@name': 'http://www.3s-software.com/plcopenxml/stcode',
          STCode: { '@xmlns': '', $: 'x := 1;' },
        },
      },
    })
    expect(code).toBe('x := 1;')
  })

  it('finds the snippet among the several addData entries an FBD block carries', () => {
    // CODESYS emits fbdcalltype / inputparamtypes / outputparamtypes alongside
    // stcode in FBD bodies, and only stcode in LD bodies.
    const code = readExecuteStCode({
      '@typeName': 'EXECUTE',
      addData: {
        data: [
          { '@name': 'http://www.3s-software.com/plcopenxml/fbdcalltype', CallType: { $: 'execute' } },
          { '@name': 'http://www.3s-software.com/plcopenxml/inputparamtypes', InputParamTypes: { $: 'BOOL' } },
          { '@name': 'http://www.3s-software.com/plcopenxml/stcode', STCode: { $: 'y := 2;' } },
        ],
      },
    })
    expect(code).toBe('y := 2;')
  })

  it('distinguishes an emptied snippet from a non-Execute block', () => {
    const code = readExecuteStCode({
      '@typeName': 'EXECUTE',
      addData: { data: { '@name': 'http://openplc.org/plcopenxml/stcode', STCode: '' } },
    })
    expect(code).toBe('')
  })
})

describe('collectExecuteStCode — whitespace fidelity', () => {
  // The main parse runs with fast-xml-parser's default `trimValues: true`,
  // which eats the first line's indentation and the trailing newline. For a
  // code payload that silently rewrites the user's source, so a second
  // untrimmed parse recovers it.
  it('preserves leading indentation and blank lines the trimmed parse would eat', () => {
    const xml = `<?xml version="1.0"?><project><types><pous><pou><body><LD>
      <block localId="9" typeName="EXECUTE">
        <addData><data name="http://openplc.org/plcopenxml/stcode"
          ><STCode>    x := 1;\n\n    y := 2;\n</STCode></data></addData>
      </block></LD></body></pou></pous></types></project>`

    expect(collectExecuteStCode(xml).get('9')).toBe('    x := 1;\n\n    y := 2;\n')
  })

  it('returns an empty map for a document with no Execute elements', () => {
    expect(collectExecuteStCode('<?xml version="1.0"?><project/>').size).toBe(0)
  })

  it('returns an empty map rather than throwing on malformed XML', () => {
    expect(collectExecuteStCode('<project><unclosed>').size).toBe(0)
  })
})

describe('importing the real CODESYS export', () => {
  const result = parsePlcopenXml(FIXTURE)

  it('rebuilds Execute nodes carrying their ST snippets', () => {
    const plcPrg = result.projectData.pous.find((pou) => pou.name === 'PLC_PRG')
    expect(plcPrg).toBeDefined()

    const value = plcPrg?.body.value as { rungs: Array<{ nodes: Array<{ type?: string; data: unknown }> }> }
    const executes = value.rungs.flatMap((rung) => rung.nodes.filter((node) => node.type === 'execute'))

    // Both LD networks in the fixture carry one.
    expect(executes).toHaveLength(2)

    const codes = executes.map((node) => (node.data as { code: string }).code)
    // Network 1 holds the escaping-test snippet, network 2 a simple assignment.
    expect(codes.some((code) => code.includes('CASE myNewValue OF'))).toBe(true)
    expect(codes.some((code) => code.includes('myNewValue_1 := myValue_1 + 111;'))).toBe(true)
  })

  it('preserves the snippet’s interior indentation through the import', () => {
    // The whole point of the untrimmed second parse — a `CASE` body indented
    // four spaces must still be indented four spaces after a round-trip.
    const plcPrg = result.projectData.pous.find((pou) => pou.name === 'PLC_PRG')
    const value = plcPrg?.body.value as { rungs: Array<{ nodes: Array<{ type?: string; data: unknown }> }> }
    const code = value.rungs
      .flatMap((rung) => rung.nodes.filter((node) => node.type === 'execute'))
      .map((node) => (node.data as { code: string }).code)
      .find((snippet) => snippet.includes('CASE myNewValue OF'))

    expect(code).toContain('\n    0, 1: myCoil := TRUE;')
    // Blank lines between statements survive too.
    expect(code).toContain('END_IF;\n\nFOR myValue')
  })

  it('decodes XML entities back into real ST operators', () => {
    // CODESYS entity-escapes rather than using CDATA: `<` → `&lt;` etc.
    // Getting this wrong would hand the compiler `IF a &lt; b`.
    const plcPrg = result.projectData.pous.find((pou) => pou.name === 'PLC_PRG')
    const value = plcPrg?.body.value as { rungs: Array<{ nodes: Array<{ type?: string; data: unknown }> }> }
    const codes = value.rungs
      .flatMap((rung) => rung.nodes.filter((node) => node.type === 'execute'))
      .map((node) => (node.data as { code: string }).code)
      .join('\n')

    expect(codes).not.toContain('&lt;')
    expect(codes).not.toContain('&amp;')
  })

  // KNOWN LIMITATION, pinned here so it is visible rather than folklore.
  //
  // CODESYS emits every network of a POU flat into one <LD> sharing a SINGLE
  // leftPowerRail, marking network boundaries only with a `networktitle`
  // <vendorElement>. This parser recovers rungs by connected-component
  // partition (see parseLadderXml), which was written against our own
  // generator's per-rung rails — so a shared rail fuses every CODESYS network
  // into one rung.
  //
  // The Execute payloads themselves survive intact; only the rung SHAPE is
  // wrong. Predates this feature (it affects any CODESYS LD import) and is
  // left alone deliberately: splitting on the marker would mean inferring
  // membership from localId ordering, which CODESYS does not guarantee.
  it('fuses CODESYS networks into one rung — shared power rail, see comment', () => {
    const plcPrg = result.projectData.pous.find((pou) => pou.name === 'PLC_PRG')
    const value = plcPrg?.body.value as { rungs: Array<{ nodes: unknown[] }> }

    // Two networks in the source, fused into one 7-node rung because CODESYS
    // emits them flat around a single shared power rail. The right rail it
    // leaves unconnected carries no logic and is dropped rather than becoming
    // a second, elementless rung.
    expect(value.rungs.map((rung) => rung.nodes.length)).toEqual([7])
  })

  it('gives each Execute node EN and ENO handles', () => {
    const plcPrg = result.projectData.pous.find((pou) => pou.name === 'PLC_PRG')
    const value = plcPrg?.body.value as { rungs: Array<{ nodes: Array<{ type?: string; data: unknown }> }> }
    const execute = value.rungs.flatMap((rung) => rung.nodes).find((node) => node.type === 'execute')
    const data = execute?.data as { inputHandles: { id?: string }[]; outputHandles: { id?: string }[] }

    expect(data.inputHandles.map((h) => h.id)).toEqual(['EN'])
    expect(data.outputHandles.map((h) => h.id)).toEqual(['ENO'])
  })
})
describe('re-importing our own PLCopen export', () => {
  const result = parsePlcopenXml(OWN_EXPORT)

  const executesIn = (pouName: string) => {
    const pou = result.projectData.pous.find((p) => p.name === pouName)
    const value = pou?.body.value as {
      rungs?: Array<{ nodes: Array<Record<string, unknown>> }>
      rung?: { nodes: Array<Record<string, unknown>> }
    }
    const nodes = value.rungs ? value.rungs.flatMap((rung) => rung.nodes) : (value.rung?.nodes ?? [])
    return nodes.filter((node) => node.type === 'execute')
  }

  it('imports cleanly', () => {
    expect(result.warnings).toEqual([])
  })

  it('rebuilds every LD Execute box with its snippet', () => {
    const executes = executesIn('main')
    expect(executes).toHaveLength(4)

    const codes = executes.map((node) => (node.data as { code: string }).code)
    expect(codes.some((code) => code.includes('FOR i := 1 TO 10 BY 1 DO'))).toBe(true)
    expect(codes.some((code) => code.includes('ELSIF counter < 0 THEN'))).toBe(true)
    // Interior indentation and blank lines survive the round trip.
    expect(codes.some((code) => code.includes('END_IF;\n\nIF total <> 0.0 AND gate THEN'))).toBe(true)
  })

  // Regression: the FBD importer had no EXECUTE branch, so the generic block
  // path claimed the element — it came back as a nameless function block with
  // no snippet and pins that did not match the wiring, leaving it visibly
  // empty and disconnected.
  it('rebuilds the FBD Execute box rather than a generic block', () => {
    const executes = executesIn('test_FBD')
    expect(executes).toHaveLength(1)
    expect((executes[0].data as { code: string }).code).toBe('myVar := myVar + 0.01;')
  })

  // Regression: imported handles carried no `style`, so React Flow rendered
  // them at the element's vertical centre while the model said the pin row —
  // the wire stepped into the box on every import.
  it.each(['main', 'test_FBD'])('gives %s Execute handles a DOM offset', (pouName) => {
    for (const node of executesIn(pouName)) {
      const data = node.data as {
        inputHandles: { id?: string; style?: { top: number } }[]
        outputHandles: { id?: string; style?: { top: number } }[]
      }
      expect(data.inputHandles.map((h) => h.id)).toEqual(['EN'])
      expect(data.outputHandles.map((h) => h.id)).toEqual(['ENO'])
      expect(data.inputHandles[0].style?.top).toBeGreaterThan(0)
      expect(data.outputHandles[0].style?.top).toBeGreaterThan(0)
    }
  })
  // Regression: a consumer's `<connection>` names the pin it reads via
  // `@formalParameter`, but the generators only emitted it for `type ===
  // 'block'` — an Execute node is a block in the XML yet carries its own node
  // type, so the name was dropped and the ENO edge could not be rebuilt. The
  // fixture predates that fix, so this also covers the importer's fallback to
  // a source's sole output handle.
  it('rebuilds the FBD ENO edge into the consuming variable', () => {
    const pou = result.projectData.pous.find((p) => p.name === 'test_FBD')
    const value = pou?.body.value as {
      rung: { nodes: Array<{ id: string; type?: string }>; edges: Array<Record<string, string>> }
    }
    const execute = value.rung.nodes.find((node) => node.type === 'execute')
    const output = value.rung.nodes.find((node) => node.type === 'output-variable')

    const enoEdge = value.rung.edges.find((edge) => edge.source === execute?.id)
    expect(enoEdge).toBeDefined()
    expect(enoEdge?.sourceHandle).toBe('ENO')
    expect(enoEdge?.target).toBe(output?.id)

    // …and EN is still fed from the TRUE input variable.
    expect(value.rung.edges.some((edge) => edge.target === execute?.id && edge.targetHandle === 'EN')).toBe(true)
  })
  // Regression: the LD generator writes absolute Y including each preceding
  // rung's height, and the importer used to keep it. Every rung after the
  // first then rendered far below its own viewport — a blank gap that grew
  // with each rung. Pre-existing, not specific to the Execute element.
  it('re-bases every rung to a common origin, handles included', () => {
    const pou = result.projectData.pous.find((p) => p.name === 'main')
    const value = pou?.body.value as {
      rungs: Array<{
        nodes: Array<{ position: { y: number }; data: { handles?: { glbPosition: { y: number } }[] } }>
      }>
    }
    expect(value.rungs.length).toBeGreaterThan(1)

    const tops = value.rungs.map((rung) => Math.min(...rung.nodes.map((node) => node.position.y)))
    expect(new Set(tops).size).toBe(1)

    // Handles must move with their nodes — `handles` aliases the input/output
    // arrays, so a naive shift moves each one twice.
    const handleTops = value.rungs.map((rung) =>
      Math.min(...rung.nodes.flatMap((node) => (node.data.handles ?? []).map((h) => h.glbPosition.y))),
    )
    expect(new Set(handleTops).size).toBe(1)
    expect(handleTops[0]).toBeGreaterThan(0)
  })
})
