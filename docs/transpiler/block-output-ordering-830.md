# Chained block output ordering in LD → ST (issue #830)

Status: **resolved** on `fix/parity/parallel-coil-single-if` (folded into PR #891 / web #543).
Applied identically in both repos across the byte-identical
`src/backend/shared/transpilers/st-transpiler/` surface.

## The bug

When a rung chains function/FB calls, the generated ST emitted **all the block calls
first, then all the output assignments afterward**, so a later block read a variable whose
write had not been emitted yet. Reporter's case:

```st
_TMP_MOD6363443_OUT := MOD(EN := TRUE, IN1 := Input, IN2 := 86400, ENO => _TMP_MOD6363443_ENO);
_TMP_DIV4651235_OUT := DIV(EN := _TMP_MOD6363443_ENO, IN1 := Output, IN2 := 60, ENO => _TMP_DIV4651235_ENO);  -- reads Output before it is set
IF _TMP_MOD6363443_ENO THEN Output := _TMP_MOD6363443_OUT; END_IF;
IF _TMP_DIV4651235_ENO THEN Output := _TMP_DIV4651235_OUT; END_IF;
```
`DIV` reads `Output` while it is still stale → `Output` is always 0.

## Root cause

Both the TS walker and the python oracle (`PLCGenerator.py:1339-1359`, `ComputeProgram`) emit
instances as *all execution-ordered (eo>0) instances first, then eo=0 instances by position*.
When the editor numbers the blocks but leaves their output variables at executionOrderId 0,
every block call emits in the ordered pass and every assignment in the unordered pass. A
shared bug with xml2st; regressed from v1.x; FBD escapes it via interleaved execution orders.
The same hazard applies to **coils** fed by a block (confirmed).

## The fix

An output-write sink (coil / output / inOut variable) fed solely by a block is that block's
output binding, so it must emit immediately after the block's **actual call** — eager or lazy.
Implemented at the emission level in `walker/ld.ts`:

- `blockFedSink` identifies such sinks (single incoming edge from a block).
- `emitLdBody` indexes them per block into `state.consumersByBlock`.
- `emitFunctionCall` / `emitFunctionBlockCall` call `emitBlockConsumers` right after pushing
  the call, which emits the block's consumers through the existing coil-grouping sweep (so the
  #836 grouping still applies to multiple SET/RESET coils off one block).
- `state.emittedSinks` makes emission idempotent; the main sink sweep skips what coupling
  already emitted.

Emitting at the *call* (not the sink slot) is what makes it robust to blocks pulled lazily
through a later block's `EN` expression (e.g. `GT.EN := MUL.ENO OR SUB.ENO`), where the call
lands mid-walk. The earlier sink-list-reorder approach failed that case.

This is a deliberate divergence from xml2st (same class as #836 / the D1 task-sort fix).

## Verification

- Regression test `st-transpiler/__tests__/block-output-ordering-830.test.ts` — the reported
  MOD→DIV chain, the eager-pull (`GT.EN`) shape, and a block-fed coil; exact-ST assertions.
- Corpus: 10 of 193 LD fixtures changed, **all corrections** — each block's output write moved
  to immediately follow its call. Notably `edge__matiasacuna_..._sc_freidora` (a 4-block
  `INT_TO_REAL→SUB→MUL→DIV` chain) and `edge__frontadomarcositsu_...` (a 5-block chain) were
  fully broken and are now correct. The other 183 fixtures are unchanged.
- #836 coil-grouping regression test still passes; 301 compile/library integration tests pass.
