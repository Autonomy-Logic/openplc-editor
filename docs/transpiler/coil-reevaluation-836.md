# Coil condition re-evaluation in LD → ST (issue #836)

Status: **resolved** on `fix/parity/parallel-coil-single-if` (folded into PR #891 / web #543,
which become the complete "coil grouping" fix). Applied identically in both repos
(openplc-editor + openplc-web) across the byte-identical
`src/backend/shared/transpilers/st-transpiler/` surface; verified with
`scripts/compare-surfaces.py`.

## The bug

The LD walker emitted one `IF <condition> THEN <coil> := …; END_IF;` per coil, re-reading
the condition's variables each time. When a coil writes a variable that a later-emitted
coil's condition reads, the later coil sees the mutated value. The reporter's case: a
`FirstScan` contact feeding `Output1(S)`, a `FirstScan(R)` reset, and `Output2(S)` — with
`FirstScan` initially TRUE, the reset clears it before `Output2`'s `IF` re-reads it, so
`Output2` never sets.

The old `xml2st` engine has the same bug, so this fix is a deliberate divergence from the
oracle (consistent with the D1-fix precedent on the parity branch).

## Expected behaviour (from the maintainer, three topologies)

| Topology | Expected ST |
|---|---|
| **S1** `FirstScan → [Output1(S) ∥ Output2(S)] → FirstScan(R)` | `Output1`+`Output2` in one `IF`; reset in a separate `IF` |
| **S2** `FirstScan → [Output1(S) ∥ FirstScan(R) ∥ Output2(S)]` | all three assignments in one `IF` |
| **S3** sequential `FirstScan → Output1(S) → FirstScan(R) → Output2(S)` | three separate `IF`s (Output2 stays unset) |

The rule: SET/RESET coils that branch off the **same source** (parallel rails) share one
energization and collapse into a single `IF`; coils with **distinct sources** (sequential)
stay as separate `IF`s. Sequential coils intentionally keep the re-evaluation semantics.

## The fix (two edits)

1. **`walker/ld.ts` — `emitSinksWithCoilGrouping`**: collapse same-source SET/RESET coils
   into one `IF`, gathering them **even when not adjacent** in emission order. A coil fed by
   their merge (sharing neither source) can sort between two parallel branches by position;
   the branches still group, emitted at the first branch's slot, with the merge-fed coil
   following after (its dataflow order). The group key is the coil's sorted immediate
   incoming source-node ids (`setResetCoilGroupKey`); the group emits via `emitCoilGroup`.
2. **`core/path-tree.ts` — `factorizePaths`**: drop byte-identical duplicate paths
   (`X OR X` → `X`) before factoring. Two parallel branches tracing to the same contact
   would otherwise render the reset condition as `FirstScan AND (TRUE OR TRUE)` (the TS
   port's factorization of two identical single-leaf paths; xml2st renders the same
   topology as `FirstScan OR FirstScan`). Dedup keys on the full repr — text **and** source
   locations — so two *distinct* contacts on the same variable still survive as separate OR
   terms. No behavioural change; cosmetic only.

This supersedes the earlier "Approach A" (condition snapshotting into temps), which was
dropped once the maintainer's expected outputs showed the intended solution is grouping —
and that sequential coils (S3) should *not* be "fixed" by a snapshot.

## Verification

- Unit regression test (byte-identical both repos):
  `st-transpiler/__tests__/coil-grouping-836.test.ts` — reconstructs all three topologies
  and asserts exact ST. All three now match the maintainer's expected output.
- Corpus: ran the 193-project LD corpus (`~/src/xml2st/fixtures/golden/real_projects_json`)
  through `emitLdBody` before/after. **0 fixtures changed** for the grouping extension and
  **0** for the dedup — S1's topology (parallel branches merging into a downstream coil)
  does not occur in the corpus, which is why it was a blind spot.
