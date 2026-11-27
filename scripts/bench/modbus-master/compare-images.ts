import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SHT_SYMTAB = 2
const SHF_ALLOC = 0x2
const STT_OBJECT = 1
const STT_FUNC = 2

/** GCC and LTO clone suffixes: `.constprop.<n>`, `.part.<n>`, `.isra.<n>`, `.lto_priv.<n>` and `.cold`. */
const CLONE_SUFFIX = /\.(?:(?:constprop|part|isra|lto_priv)\.\d+|cold(?:\.\d+)?)$/

/** The numeric tail LTO gives a `_GLOBAL__` static constructor or destructor named after its object file. */
const GLOBAL_OBJECT_TAIL = /^(_GLOBAL__.*\.o)\.\d+$/

/**
 * A symbol name with its compiler-generated numbering removed, so the clones of one function in two builds of
 * the same code compare equal: every clone suffix, chained ones included, and the `.o.<n>` tail of a
 * `_GLOBAL__` name.
 *
 * @param name - The symbol name as the ELF symbol table gives it.
 * @returns The name without those suffixes; any other name unchanged.
 */
export function normalizeSymbolName(name: string): string {
  let previous = ''
  let normalized = name
  while (normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(CLONE_SUFFIX, '').replace(GLOBAL_OBJECT_TAIL, '$1')
  }
  return normalized
}

/** The allocated sections and defined symbols of an ELF file. */
interface ElfSummary {
  sections: Map<string, number>
  symbols: string[]
}

/** Little- or big-endian reader over one ELF file, 32 or 64 bit. */
class ElfReader {
  private readonly view: DataView
  readonly is64: boolean
  private readonly little: boolean

  constructor(readonly bytes: Buffer) {
    if (bytes.length < 0x40 || bytes.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file')
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.is64 = bytes[4] === 2
    this.little = bytes[5] === 1
  }

  u8(offset: number): number {
    return this.view.getUint8(offset)
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, this.little)
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, this.little)
  }

  /** A 32-bit field in ELF32 and a 64-bit one in ELF64. */
  word(offset32: number, offset64: number): number {
    return this.is64 ? Number(this.view.getBigUint64(offset64, this.little)) : this.u32(offset32)
  }

  cString(offset: number): string {
    const end = this.bytes.indexOf(0, offset)
    return this.bytes.toString('latin1', offset, end === -1 ? this.bytes.length : end)
  }
}

interface SectionHeader {
  name: string
  type: number
  flags: number
  offset: number
  size: number
  link: number
}

function sectionHeaders(elf: ElfReader): SectionHeader[] {
  const tableOffset = elf.word(0x20, 0x28)
  const entrySize = elf.u16(elf.is64 ? 0x3a : 0x2e)
  const count = elf.u16(elf.is64 ? 0x3c : 0x30)
  const namesIndex = elf.u16(elf.is64 ? 0x3e : 0x32)

  const raw = Array.from({ length: count }, (_, index) => {
    const at = tableOffset + index * entrySize
    return {
      nameOffset: elf.u32(at),
      type: elf.u32(at + 4),
      flags: elf.word(at + 8, at + 8),
      offset: elf.word(at + 16, at + 24),
      size: elf.word(at + 20, at + 32),
      link: elf.u32(at + (elf.is64 ? 40 : 24)),
    }
  })
  const names = raw[namesIndex]
  return raw.map((header) => ({
    name: names === undefined ? '' : elf.cString(names.offset + header.nameOffset),
    type: header.type,
    flags: header.flags,
    offset: header.offset,
    size: header.size,
    link: header.link,
  }))
}

function summarize(path: string): ElfSummary {
  const elf = new ElfReader(readFileSync(path))
  const headers = sectionHeaders(elf)

  const sections = new Map<string, number>()
  for (const header of headers) {
    if ((header.flags & SHF_ALLOC) !== 0 && header.size > 0) sections.set(header.name, header.size)
  }

  const symbols: string[] = []
  const symbolSize = elf.is64 ? 24 : 16
  for (const table of headers.filter((header) => header.type === SHT_SYMTAB)) {
    const strings = headers[table.link]
    if (strings === undefined) continue
    for (let at = table.offset + symbolSize; at + symbolSize <= table.offset + table.size; at += symbolSize) {
      const info = elf.u8(at + (elf.is64 ? 4 : 12))
      const sectionIndex = elf.u16(at + (elf.is64 ? 6 : 14))
      const kind = info & 0xf
      if (sectionIndex === 0 || (kind !== STT_FUNC && kind !== STT_OBJECT)) continue
      const name = elf.cString(strings.offset + elf.u32(at))
      if (name !== '') symbols.push(normalizeSymbolName(name))
    }
  }
  symbols.sort()
  return { sections, symbols }
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

function findImage(targetDir: string, extension: string): string | undefined {
  return filesUnder(targetDir).find((path) => path.endsWith(`Baremetal.ino.${extension}`))
}

/** Items of `a` missing from `b`, counting repeats. */
function missingFrom(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>()
  for (const item of b) left.set(item, (left.get(item) ?? 0) + 1)
  const missing: string[] = []
  for (const item of a) {
    const remaining = left.get(item) ?? 0
    if (remaining > 0) left.set(item, remaining - 1)
    else missing.push(item)
  }
  return missing
}

interface Verdict {
  target: string
  pass: boolean
  how: string
  details: string[]
}

function compareTarget(target: string, baselineDir: string, candidateDir: string): Verdict {
  if (!existsSync(candidateDir)) return { target, pass: false, how: 'missing in the candidate build', details: [] }

  for (const extension of ['hex', 'bin']) {
    const baseline = findImage(baselineDir, extension)
    const candidate = findImage(candidateDir, extension)
    if (baseline !== undefined && candidate !== undefined && readFileSync(baseline).equals(readFileSync(candidate))) {
      return { target, pass: true, how: `identical .${extension}`, details: [] }
    }
  }

  const baselineElf = findImage(baselineDir, 'elf')
  const candidateElf = findImage(candidateDir, 'elf')
  if (baselineElf === undefined || candidateElf === undefined) {
    return { target, pass: false, how: 'images differ and no ELF to compare', details: [] }
  }

  const before = summarize(baselineElf)
  const after = summarize(candidateElf)
  const details: string[] = []
  for (const name of new Set([...before.sections.keys(), ...after.sections.keys()])) {
    const a = before.sections.get(name) ?? 0
    const b = after.sections.get(name) ?? 0
    if (a !== b) details.push(`section ${name}: ${a} -> ${b} bytes`)
  }
  for (const name of missingFrom(after.symbols, before.symbols)) details.push(`symbol added: ${name}`)
  for (const name of missingFrom(before.symbols, after.symbols)) details.push(`symbol removed: ${name}`)

  return details.length === 0
    ? { target, pass: true, how: 'same section sizes and symbols (images carry build data)', details }
    : { target, pass: false, how: 'different', details }
}

function main(argv: string[]): number {
  if (argv.length !== 2) {
    process.stderr.write('usage: compare-images.ts <baseline-build> <candidate-build>\n')
    return 2
  }
  const [baselineRoot, candidateRoot] = argv
  const targets = readdirSync(baselineRoot).filter((entry) => statSync(join(baselineRoot, entry)).isDirectory())
  if (targets.length === 0) {
    process.stderr.write(`no target folder in ${baselineRoot}\n`)
    return 2
  }

  const verdicts = targets.map((target) =>
    compareTarget(target, join(baselineRoot, target), join(candidateRoot, target)),
  )
  for (const verdict of verdicts) {
    process.stdout.write(`${verdict.pass ? 'SAME' : 'DIFF'}  ${verdict.target}: ${verdict.how}\n`)
    for (const line of verdict.details.slice(0, 40)) process.stdout.write(`      ${line}\n`)
  }
  return verdicts.every((verdict) => verdict.pass) ? 0 : 1
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))
