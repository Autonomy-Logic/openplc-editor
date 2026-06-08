# walker

React Flow → Structured Text walker. Consumes the **React Flow**
body shape (the exact format `openplc-editor` / `openplc-web` store
in `pous/<type>s/<name>.{ld,fbd}` on disk) and emits the body bytes
that go between `END_VAR` and `END_PROGRAM` — byte-identical to the
python oracle (`xml2st.py`).

The orchestrator at `../index.ts` calls these entry points via
`../emit/pou-graphical.ts`; the wrap there composes the POU header,
VAR sections, the body bytes returned here, and the closing
`END_PROGRAM` / `END_FUNCTION` / `END_FUNCTION_BLOCK`.

## Files

- `ld.ts` — `emitLdBody(body: RFBody): EmitResult`. Handles both
  LD and FBD bodies (FBD is a strict subset of LD's vocabulary).
- `fbd.ts` — thin adapter that wraps `{ rung }` into the LD
  `{ rungs: [rung] }` shape and delegates to `emitLdBody`.
- `narrow.ts` — type-safe accessors for the loosely-typed
  `RFNode.data: Record<string, unknown>` payloads. Each `as*Data`
  helper returns `null` when the payload doesn't match the expected
  shape, letting the walker decide whether to warn or skip.
- `types.ts` — minimal React Flow types (`RFBody`, `RFRung`,
  `RFNode`, `RFEdge`). Loose enough that the schema boundary in
  `../from-schema.ts` can project the editor's Zod-inferred shapes
  without typecasts.

## Where the algebra lives

The walker's emission steps (contact/coil dispatch, block-call
emission, parallel-branch factoring) build up `PathNode` trees, then
hand them to `../core/path-tree.ts` for normalisation and chunk
serialisation. Contact / coil modifiers (negated, set, reset, edge
triggers) flow through `../core/modifiers.ts:extractModifier`.

## Source of truth

`xml2st`'s python `PLCGenerator.py` is the canonical reference for
every emission rule. Any divergence between this walker's output
and the oracle is a walker bug, never an oracle bug — see the
fixture corpus under `xml2st/fixtures/` and the test harness under
`xml2st/shared-backend/transpilers/generate-st-from-react-flow/tests/`
for the validation loop.
