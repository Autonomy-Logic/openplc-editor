# Generating Modbus IO Group import files from equipment manuals

**Audience:** an AI assistant (or a human) that reads a device's Modbus register map, from a manual, datasheet or spreadsheet, and produces a file the OpenPLC Editor can import under **Remote Devices → (device) → IO Tag Mapping → Import**.

**Output:** one `.csv` **or** one `.json` file that follows the schema below exactly. The editor validates the whole file and imports **nothing** if any row has an error, so a single bad row blocks the import.

---

## 1. What an IO Group is

An IO Group is **one Modbus request** that the PLC repeats every `cycleTime` milliseconds. It reads or writes `length` consecutive elements (coils or 16-bit registers), starting at `offset`, with one function code. The editor then creates one IEC located variable per element (`%IX`, `%IW`, `%QX` or `%QW`).

The file has exactly the same fields as the editor's **New IO Group** form:

| Field | Required | Type | Default | Meaning |
|---|---|---|---|---|
| `name` | **yes** | text | — | Group name. Unique per device. |
| `functionCode` | **yes** | integer | — | Modbus function code: `1, 2, 3, 4, 5, 6, 15, 16`. |
| `cycleTime` | no | integer (ms) | `100` | Polling period, from 1 to 3 600 000. |
| `offset` | no | integer | `0` | **0-based PDU start address**, from 0 to 65535. |
| `length` | no | integer | `1` | Number of elements: coils for FC 1/2/5/15, 16-bit registers for FC 3/4/6/16. |
| `errorHandling` | no | `keep-last-value` \| `set-to-zero` | `keep-last-value` | What the input image holds while the slave is unreachable. Only used by read codes (FC 1–4). |

## 2. Function codes and limits

| FC | Operation | Modbus table | Element | Max `length` | IEC area |
|---|---|---|---|---|---|
| 1 | Read Coils | Coils (0x) | bit | 2000 | `%IX` |
| 2 | Read Discrete Inputs | Discrete Inputs (1x) | bit | 2000 | `%IX` |
| 3 | Read Holding Registers | Holding Registers (4x) | 16-bit word | 125 | `%IW` |
| 4 | Read Input Registers | Input Registers (3x) | 16-bit word | 125 | `%IW` |
| 5 | Write Single Coil | Coils (0x) | bit | **exactly 1** | `%QX` |
| 6 | Write Single Register | Holding Registers (4x) | 16-bit word | **exactly 1** | `%QW` |
| 15 | Write Multiple Coils | Coils (0x) | bit | 1968 | `%QX` |
| 16 | Write Multiple Registers | Holding Registers (4x) | 16-bit word | 123 | `%QW` |

Hard rules the importer enforces:

- `offset + length - 1 ≤ 65535`.
- For FC 5 and FC 6, `length` is forced to 1 and any other value produces a warning. Use FC 15 or FC 16 to write several elements.
- For write codes (5, 6, 15, 16), `errorHandling` is ignored. Leave it empty or use `keep-last-value`.
- `name` must be unique within the file and also unique against groups already on the device when appending. The comparison ignores letter case.
- `name` is at most 64 characters, with no tabs, line breaks or other control characters.
- Integers only: no decimals, no `1e3`. Hexadecimal `0x…` is accepted for `offset`.
- A file holds at most 2000 groups and 2 MB.

---

## 3. Reading the manual: converting addresses (the step that most often goes wrong)

Manuals describe the same register in different conventions. The file needs the **0-based PDU offset** within the table that the function code selects.

### 3.1 Identify the convention

| What the manual shows | Example | Convention | How to get `offset` |
|---|---|---|---|
| 5-digit Modicon reference, 4xxxx | `40001` | Holding register **number**, 1-based | `offset = ref − 40001` → `0` |
| 5-digit, 3xxxx | `30010` | Input register number, 1-based | `offset = ref − 30001` → `9` |
| 5-digit, 1xxxx | `10005` | Discrete input number, 1-based | `offset = ref − 10001` → `4` |
| 5-digit, 0xxxx | `00017` | Coil number, 1-based | `offset = ref − 1` → `16` |
| 6-digit Modicon reference | `400101` / `300101` | Same idea, 6 digits | `offset = ref − 400001` / `ref − 300001` → `100` |
| "Address", "PDU address", "Offset", "Register address (hex)" | `0x0064`, `100` | Already 0-based | `offset = value` → `100` |
| "Register 1, 2, 3…" with no table prefix | `Register 1` | Usually 1-based numbering | `offset = n − 1`, but confirm (see 3.2) |

The leading digit (0, 1, 3, 4) **selects the table**, and therefore the function code. It is not part of the offset.

### 3.2 When the manual is ambiguous

- Look for an explicit statement such as "addresses are 0-based", "PDU address", "subtract 1", or "register 40001 = address 0".
- Look at a worked example in the manual: a sample frame such as `01 03 00 00 00 02` reads from address 0.
- If the first register in the table is listed as `0`, the table is 0-based. If it is listed as `1` or `40001`, it is 1-based.
- If you still cannot decide, **do not guess silently.** Generate the file with your best interpretation and report the assumption explicitly (section 7), so the user can verify one register against the device.

### 3.3 Choosing the function code from the register's access

| Manual says | Generate |
|---|---|
| Coil / digital output, read-only monitoring | FC 1 |
| Coil, must be written by the PLC | FC 15 for a block, or FC 5 for one coil. Add an FC 1 group too if the PLC must also read it back. |
| Discrete input / status bit (read-only) | FC 2 |
| Input register (3x, read-only measurement) | FC 4 |
| Holding register (4x), read only | FC 3 |
| Holding register, setpoint or command written by the PLC | FC 16 for a block, or FC 6 for one register |
| Holding register, read **and** written | **Two groups** over the same range: FC 3 (read) and FC 16 or FC 6 (write), each with its own unique name |

Some devices implement only FC 3, or only FC 4, for measurements. If the manual lists the supported function codes, use only those.

---

## 4. Data types: counting `length`

`length` counts **16-bit registers** (or bits for coils), never values.

| Manual data type | Registers per value |
|---|---|
| BOOL / bit in a coil or discrete input table | 1 coil |
| INT16, UINT16, WORD, BCD16, bit-field word | 1 |
| INT32, UINT32, DWORD, FLOAT32 / REAL | 2 |
| INT64, UINT64, FLOAT64 / LREAL | 4 |
| STRING of N characters (ASCII, 2 chars/register) | ceil(N / 2) |

- A 32-bit value at `40011` occupies `offset` 10 and 11. Both registers must be inside the same group, so never split a multi-register value across two groups.
- Bit fields packed inside a register (for example "bit 3 = alarm") are read as the whole register. Individual bits are extracted later in the PLC program.
- Word order, byte order and scaling factors (for example "value × 0.1 °C") are **not** part of the import file. Record them in the report (section 7) so the programmer can handle them in IEC code.

---

## 5. Grouping strategy

1. **Group by table and access.** One group never mixes coils with registers, or reads with writes.
2. **Merge contiguous ranges.** Registers at consecutive offsets with the same function code belong in one group, up to the FC's maximum `length`. Fewer, larger requests are more efficient on the bus.
3. **Split at gaps by default.** Many devices answer *Exception 02 (Illegal Data Address)* when a request covers undocumented registers. Only bridge a gap if the manual says block reads across it are allowed, or the gap is documented as "reserved, reads as 0".
4. **Split at the length limit.** For example, 300 contiguous holding registers become 125 + 125 + 50.
5. **Respect device limits.** If the manual states a smaller maximum per request (for example "max. 64 registers per read"), use it instead of the protocol maximum.
6. **Split by update rate when it helps.** Fast-changing measurements can get a short `cycleTime` and configuration parameters a long one, even when they are contiguous.

### `cycleTime` guidance

| Data | Suggested `cycleTime` (ms) |
|---|---|
| Fast process values, commands | 50 – 100 |
| Typical measurements and status | 100 – 500 |
| Totalizers, diagnostics | 1000 – 5000 |
| Configuration and identification | 5000 – 60000 |

On RTU (serial), add up the time all groups take. At 9600 baud a 125-register read takes about 300 ms, so very short cycles will saturate the bus.

### `errorHandling` guidance

- `keep-last-value` is the default and suits status values, counters and identification.
- `set-to-zero` suits values where a stale reading is dangerous and 0 is a safe, recognizable state, such as permissives or "running" flags.

### Naming

- Use IEC-style identifiers: `[A-Za-z_][A-Za-z0-9_]*`, for example `Meter_Voltages`, `VFD1_Status`, `Setpoints_W`. They are not mandatory, but they keep the generated point names (`<name>_0`, `<name>_1`, …) clean.
- Make names descriptive of the block, not of the first register. Prefix with the device when it helps.
- Avoid accents and non-ASCII characters.
- For read/write pairs, use suffixes such as `_R` / `_W`.

---

## 6. Output formats

Produce **exactly one** of these. Use UTF-8 and do not add commentary inside the file.

### 6.1 CSV

- The first line is the header, exactly: `name,functionCode,cycleTime,offset,length,errorHandling`
- Use a comma (`,`) delimiter and one group per line.
- Quote a field with `"` only if it contains a comma, quote or line break. Escape quotes as `""`.
- Optional cells may be left empty and take the defaults.
- Do not write comments, totals or blank header lines.

```csv
name,functionCode,cycleTime,offset,length,errorHandling
Meter_Voltages,4,200,0,12,keep-last-value
Meter_Currents,4,200,20,12,keep-last-value
Meter_Energy,4,1000,100,8,keep-last-value
Status_Bits,2,100,0,16,set-to-zero
Relay_Commands,15,100,0,4,
Setpoints_R,3,1000,200,6,keep-last-value
Setpoints_W,16,1000,200,6,
Reset_Counters,6,1000,300,1,
```

### 6.2 JSON

- Use the envelope below, with `format` and `version` exactly as shown.
- Numbers are JSON numbers, not strings.
- Do not add other top-level keys. Unknown keys inside a group are ignored with a warning.

```json
{
  "format": "openplc-modbus-io-groups",
  "version": 1,
  "ioGroups": [
    { "name": "Meter_Voltages", "functionCode": 4, "cycleTime": 200, "offset": 0, "length": 12, "errorHandling": "keep-last-value" },
    { "name": "Status_Bits", "functionCode": 2, "cycleTime": 100, "offset": 0, "length": 16, "errorHandling": "set-to-zero" },
    { "name": "Setpoints_W", "functionCode": 16, "cycleTime": 1000, "offset": 200, "length": 6, "errorHandling": "keep-last-value" }
  ]
}
```

The importer is tolerant, but generate the canonical form above. Tolerated variants include a bare array instead of the envelope, `"FC 3"` or the form label as `functionCode`, a `;` or tab delimiter in CSV, and form labels such as `Function Code` as CSV headers.

---

## 7. Mapping report (deliver alongside the file, outside it)

The import file has no room for context, so also return a short report to the user containing:

1. **Source:** document title, revision, and the pages or tables used.
2. **Addressing convention** detected (0-based or 1-based, Modicon references), with the evidence from the manual.
3. **Per-group trace:** each group name → the manual's register range (as printed) → `offset`/`length`, plus the parameters it contains, with data type, unit, scaling and word order.
4. **Assumptions and doubts:** anything not stated explicitly in the manual.
5. **Excluded registers** and why (gaps, unsupported function code, out of scope).

Use the report to bind the generated `%IW`/`%QW` points to meaningful variables and aliases after import.

---

## 8. Self-check before delivering

- [ ] The header or envelope is exactly as specified.
- [ ] Every row has `name` and `functionCode`, and `functionCode` ∈ {1, 2, 3, 4, 5, 6, 15, 16}.
- [ ] Every `offset` is the **0-based** offset (Modicon prefix removed, 1 subtracted when the manual is 1-based).
- [ ] `length` counts registers or bits, not values (FLOAT32 = 2, and so on), and stays within the FC maximum and any device limit.
- [ ] `offset + length − 1 ≤ 65535`.
- [ ] FC 5 and FC 6 rows have `length` 1.
- [ ] No multi-register value is split between two groups.
- [ ] Every name is unique (ignoring case), at most 64 characters, and has no control characters.
- [ ] Write groups have an empty `errorHandling` or `keep-last-value`.
- [ ] The file has at most 2000 groups, uses UTF-8, and contains no commentary.
- [ ] The mapping report lists every assumption.

---

## 9. Ready-to-use prompt

> You will read the attached Modbus register map for **[device / model]** and generate an import file for the OpenPLC Editor following the guide `modbus-io-group-import-ai-guide.md` (attached).
> Output format: **[CSV | JSON]**.
> Scope: **[e.g. all measurements and status; setpoints writable]**.
> Transport: **[TCP | RTU 9600 8N1]**. Preferred cycle times: **[e.g. measurements 200 ms, configuration 5 s]**.
> Device limits from the manual: **[e.g. max 50 registers per request, or "check the manual"]**.
> Deliver: (1) the file content in a single code block, ready to save; (2) the mapping report described in section 7. Run the self-check in section 8 before answering, and state any address-convention assumption explicitly.
