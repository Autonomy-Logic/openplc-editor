# LD re-layout regression corpus

Four Ladder Diagram projects built through the editor's UI, the way users build rungs, and saved by the editor. Their
Structured Text is frozen per POU and per rung from the transpiler of the same commit. The re-layout of LD rungs
changes geometry only: these files guard the generated Structured Text and the compiled statement order against it.

**The corpus is never regenerated.** It records projects saved by the editor before the re-layout. A project built
again after the re-layout would carry the new geometry and guard nothing. The builder refuses to run when a project
folder already exists, and the freeze never overwrites an expected file.

## Layout

```
<project>/project/                 the project as the editor saved it (project.json, pous/, devices/)
<project>/expected-st/<POU>.st     the POU's section of transpileToSt(fromPortShape(data)).programSt
<project>/expected-st/<POU>/rung-NN.st
                                   for an LD POU, emitLdBody({ rungs: [rung] }).bodySt of rung NN (1-based display order)
<project>/expected-st/_project.st  the rest of the program text (data types, configuration)
```

The POU files and `_project.st` rebuild the whole program text exactly: the POU sections, in emission order, go
before the `CONFIGURATION` line of `_project.st`.

## How it was built

Starting code: openplc-editor `f781c89ab` (branch `feature/DOPE-900-ladder-visual-redesign`).

The builder, `e2e/build-ld-relayout-corpus.spec.ts` (openplc-editor only, run locally by name), drives the built
editor through Playwright. For each project it creates the project through the start screen, deletes the wizard's
default `main` program through the project tree and saves, then adds each POU, builds its rungs in the order of the
table below and saves. Each rung's comment names the scenarios that cover it (`<ID> <name>`, joined with `; `). For
`ld-corpus-imported`, the editor creates the project, the three e2e fixture POUs are copied into `pous/programs/`,
and the editor opens the project, opens each POU once and saves it.

```bash
npm run setup:python                         # once, if the Python runtime is not installed
OPENPLC_E2E_DEBUG_SEAM=1 npm run build
mkdir -p release/app/configs/dll
cp release/app/dist/main/preload.js release/app/configs/dll/preload.js
npx playwright test e2e/build-ld-relayout-corpus.spec.ts --workers=1 --global-timeout=3600000 --reporter=line
```

`ld-corpus-parallel-width` (Branches, Blocks) was built later, before the parallel-branch-width layout. Starting code:
openplc-editor `e10d5c1fa` (same branch), the commit the app was built from; the builder selected only this project:

```bash
npx playwright test e2e/build-ld-relayout-corpus.spec.ts --workers=1 --grep "ld-corpus-parallel-width/" \
  --global-timeout=3600000 --reporter=line
```

W03 is built mirrored: the outer group's top branch is contact E and its bottom branch is contact A followed by the
inner group. The editor offers no parallel marker below an element in the top branch of a parallel group, so an inner
group cannot be nested in that branch; the mirrored rung has the same Boolean expression.

## Freezing the expected Structured Text

```bash
LD_CORPUS_FREEZE=1 npx jest --config jest.config.json \
  src/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus.test.ts --maxWorkers=2
npx jest --config jest.config.json \
  src/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus.test.ts --maxWorkers=2
```

The first run writes every missing expected file and fails with `frozen <path>; rerun without LD_CORPUS_FREEZE`, so a
freeze is never taken for a pass. The second run only compares. The corpus and its expected files are copied
byte-identical to openplc-web, where `ld-relayout-corpus.test.ts` runs under Vitest.

## Coverage

Rungs are 1-based, in display order. The Review column records the reading of each per-rung `.st` against its
scenario: each pin's Boolean expression, the block call order and the sink order.

| ID | Scenario | Project | POU | Rungs | Topology | Review |
|---|---|---|---|---|---|---|
| B01 | series-contacts-coil | ld-corpus-basic | Main | 1 | three contacts in series, one coil | `b01_motor := b01_guard AND b01_permit AND b01_start`: three contacts in series, one coil |
| B02 | nested-parallel-branches | ld-corpus-basic | Main | 2 | parallel branches nested two levels deep around contacts, one coil | `b02_out := b02_a OR b02_b OR b02_e AND b02_c`; two nested parallel pairs in the saved rung |
| B06 | parallel-coils-trailing | ld-corpus-basic | Main | 3 | a contact followed by a trailing parallel group of three coils | three coils, each `:= b06_run`, in display order |
| B07 | set-reset-edge-coils | ld-corpus-basic | Main | 4 | set, reset, rising-edge and falling-edge coils | set and reset under `IF b07_cmd`, then `R_TRIG` and `F_TRIG` calls for the edge coils |
| B11 | long-names | ld-corpus-basic | Main | 5 | contacts, coils and pin variables with 50-plus-character names | TON0 with 51- to 55-character contact, coil and PT/ET names |
| B03 | block-en-eno-outputs | ld-corpus-basic | Blocks | 1 | a block with EN/ENO wired on the rung and output variables on its outputs | `TON0(EN := b03_enable, IN := b03_start, PT := T#2s)`; ENO to the coil, Q and ET under `IF TON0.ENO` |
| B04 | ctud-handle-branches | ld-corpus-basic | Blocks | 2 | CTUD with contacts on handle branches of its secondary BOOL pins | `CTUD0(CU := b04_up, CD := b04_down, R := b04_reset, LD := b04_load, PV := 20)`; QU coil, QD and CV variables |
| B05 | in-out-pins | ld-corpus-basic | Blocks | 3 | an OSCAT ONTIME block with its in-out pins bound to variables | `ONTIME0(EN := b05_run, IN, RST, SECONDS, CYCLES)` bound to variables; ENO to the coil |
| B08 | block-then-coil-same-band | ld-corpus-basic | Blocks | 4 | a block followed by a coil on the same band | `TON1(IN := b08_go, PT := T#500ms)`; Q to the coil, then ET |
| B09 | pin-variable-row0-vs-coil | ld-corpus-basic | Blocks | 5 | TON with EN/ENO wired on the rung, ENO driving a coil, and Q (first pin-variable row) bound to an output variable | `TON2` with EN/ENO; ENO to the coil first, then Q and ET under `IF TON2.ENO` |
| B10 | multi-rung-boundary-sinks | ld-corpus-basic | Aux | 1-4 | lowest and highest sinks near the rung boundaries (cross-rung order) | four rungs: TON0 with three trailing coils, CTU0, TOF0 with `aux_c OR aux_d`, one coil; sinks in rung order |
| H01 | ctu-cu-r-separate-networks | ld-corpus-hard | Counters | 1 | CTU with CU = `A AND B` and R on its own network `C OR D`; Q to a coil, CV to an output variable | `CU := h01_b AND h01_a`, `R := h01_c OR h01_d`; Q coil, CV variable |
| H02 | ctud-four-input-networks | ld-corpus-hard | Counters | 2 | CTUD with CU = `A AND (B OR (C AND D))`, CD = `(E OR F) AND G`, R = `H`, LD = `(I AND J) OR K` (a nested parallel or a series contact on a pin branch's parallel path cannot be built in the editor) | `CU := (h02_b OR h02_d AND h02_c) AND h02_a`, `CD := h02_g AND (h02_e OR h02_f)`, `R := h02_h`, `LD := h02_k OR h02_j AND h02_i` |
| H03 | sr-rs-separate-networks | ld-corpus-hard | Counters | 3-4 | SR with S1 = `(A OR B) AND C`, R = `D`; then RS with S = `E`, R1 = `(F AND G) OR H` | `S1 := h03_c AND (h03_a OR h03_b)`, `R := h03_d`; `R1 := h03_h OR h03_g AND h03_f` |
| H04 | ton-deep-nested-pin-network | ld-corpus-hard | Counters | 5 | TON IN = `(A AND (B OR (C AND D))) OR E`, Q to a coil | `IN := h04_e OR (h04_b OR h04_d AND h04_c) AND h04_a` (E on the top branch, the nested network below) |
| H05 | two-blocks-parallel-branches | ld-corpus-hard | Parallel | 1 | branch 1 contact A then TON, branch 2 contact B then CTU with R bound to a variable, joined into a coil | TON0 then CTU0 (`R := h05_r`); `h05_out := CTU0.Q OR TON0.Q` |
| H06 | three-blocks-parallel-branches | ld-corpus-hard | Parallel | 2 | TON, TOF and CTU on three parallel branches, each with its own input network and a coil, plus a coil-only branch | TON1, TOF0, CTU1 each on `<contact> AND h06_en` with its coil; `h06_y4 := h06_en` |
| H09 | blocks-feed-across-parallel | ld-corpus-hard | Parallel | 3 | TON and TOF on parallel branches joined (OR) into IN1 of a library `AND`, with `AND.IN2` fed by its own contact network, then a coil | TON2, TOF1, then `AND(TOF1.Q OR TON2.Q, h09_c OR h09_d)` to the coil |
| H07 | block-feeds-block | ld-corpus-hard | Chains | 1 | TON.Q feeds CTU.CU, CTU.R on its own network, CTU.Q to a coil, CTU.CV to an output variable | `CTU0(CU := TON0.Q, R := h07_reset, PV := 4)`; Q coil, CV variable |
| H08 | block-chain-three | ld-corpus-hard | Chains | 2 | TON -> TOF -> CTU chained output to input, the last block's second BOOL input on its own network | TON1 -> TOF0 -> CTU1 with `R := h08_r1 OR h08_r2` |
| H10 | multi-pou-hard-mix | ld-corpus-hard | Mixed | 1-3 | hard topologies combined over three rungs with sinks near the rung boundaries (execution order 0 throughout) | CTU0 with an R network, TON0 with an OR network and three trailing coils, SR0 with an R network |
| B13 | motor-ladder | ld-corpus-imported | motor_ladder | all | `e2e/fixtures/project-search/motor_ladder.ld`, opened and saved by the editor (which adds its `PROGRAM` header) | `Lamp := Motor` |
| B14 | function-block-instance-ld | ld-corpus-imported | main_ld | all | `e2e/fixtures/function-block-instance/main_ld.ld` (with its companion `main_fbd.fbd`) | three rungs: `run_valve` assignment, TON0 -> TOF0 -> `timeout`, CTU0 with `R := NOT(man_mode)` |
| W01 | unequal-two-branches | ld-corpus-parallel-width | Branches | 1 | contact A, then a group of B, C and D in series / E, then coil Y | `w01_y := (w01_e OR w01_d AND w01_c AND w01_b) AND w01_a`: `A AND ((B AND C AND D) OR E)` |
| W02 | longest-branch-in-middle | ld-corpus-parallel-width | Branches | 2 | three branches (a stack of pairs): F / G, H and I / J and K, then coil Y | `w02_y := w02_f OR w02_i AND w02_h AND w02_g OR w02_k AND w02_j`: `F OR (G AND H AND I) OR (J AND K)` |
| W03 | nested-unequal-groups | ld-corpus-parallel-width | Branches | 3 | outer group E / (A then an inner group of B and C / D), then coil Y (built mirrored, see above) | `w03_y := w03_e OR (w03_d OR w03_c AND w03_b) AND w03_a`: `(A AND ((B AND C) OR D)) OR E` |
| W04 | name-width-decides | ld-corpus-parallel-width | Branches | 4 | A and B in series / one contact with a 54-character name, then coil Y | `w04_y := w04_conveyor_infeed_photoeye_blocked_longer_than_limit OR w04_b AND w04_a`: `(A AND B) OR <long name>` |
| W05 | trailing-coils-unequal-names | ld-corpus-parallel-width | Branches | 5 | contact A, then a trailing group of coil w05_k / a coil with a 45-character name | both coils `:= w05_a`, in display order |
| W06 | block-branch-vs-contact-branch | ld-corpus-parallel-width | Blocks | 1 | contact A then TON (PT a literal) / contact B, then coil Y | `TON0(IN := w06_a, PT := T#1s)`; `w06_y := TON0.Q OR w06_b` |
| W07 | pin-network-unequal | ld-corpus-parallel-width | Blocks | 2 | contact C into CTU.CU; CTU.R fed by `(I AND J) OR K` on its pin branch; Q to coil Y | `CTU0(CU := w07_c, R := w07_k OR w07_j AND w07_i)`; `w07_y := CTU0.Q` |
| W08 | pin-network-three-branches | ld-corpus-parallel-width | Blocks | 3 | contact C into CTUD.CU; CTUD.LD fed by `(I AND J) OR K OR L` on its pin branch; QU to coil Y | `CTUD0(CU := w08_c, LD := w08_k OR w08_l OR w08_j AND w08_i)`; `w08_y := CTUD0.QU` |

Every element of the corpus has execution order 0: the ladder Block Properties dialog cannot set another value.

- B12 execution-order-mixed: sinks with execution order > 0 (as older projects carry them) mixed with unordered sinks
  over three rungs are covered by crafted rungs in `src/middleware/shared/utils/ladder-layout/__tests__/sink-order.test.ts`.

`ld-corpus-basic` (Main, Blocks, Aux) is also project "Line1" of the migration tests.
