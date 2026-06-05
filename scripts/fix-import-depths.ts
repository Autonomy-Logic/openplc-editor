#!/usr/bin/env npx tsx
/**
 * Fix relative import paths in src/ that have incorrect depth (wrong number of ../ segments).
 *
 * For each relative import, resolves it from the importing file's directory.
 * If the target doesn't exist, tries removing or adding ../ segments until it resolves.
 * Rewrites the file in-place when fixes are found.
 *
 * Usage: npx tsx scripts/fix-import-depths.ts [--dry-run]
 */

import * as fs from 'fs'
import * as path from 'path'

const SRC_DIR = path.resolve(__dirname, '..', 'src')
const DRY_RUN = process.argv.includes('--dry-run')
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']

function getAllFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      results.push(...getAllFiles(fullPath))
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath)
    }
  }
  return results
}

function resolveImport(fromDir: string, importPath: string): boolean {
  const resolved = path.resolve(fromDir, importPath)
  return RESOLVE_EXTENSIONS.some((ext) => fs.existsSync(resolved + ext))
}

function fixImportPath(fromDir: string, importPath: string): string | null {
  // Only fix relative imports with ../
  if (!importPath.startsWith('../')) return null

  // Already resolves — nothing to fix
  if (resolveImport(fromDir, importPath)) return null

  const parts = importPath.split('/')
  // Count leading ../ segments
  let dotdotCount = 0
  while (dotdotCount < parts.length && parts[dotdotCount] === '..') {
    dotdotCount++
  }

  const tail = parts.slice(dotdotCount)

  // Try removing one ../ at a time (too many ../)
  for (let remove = 1; remove < dotdotCount; remove++) {
    const newDotDots = dotdotCount - remove
    const candidate = [...Array(newDotDots).fill('..'), ...tail].join('/')
    if (resolveImport(fromDir, candidate)) {
      return candidate
    }
  }

  // Try ./ (zero ../)
  const dotCandidate = './' + tail.join('/')
  if (resolveImport(fromDir, dotCandidate)) {
    return dotCandidate
  }

  // Try adding ../ segments (too few ../) — up to 5 extra levels
  for (let add = 1; add <= 5; add++) {
    const newDotDots = dotdotCount + add
    const candidate = [...Array(newDotDots).fill('..'), ...tail].join('/')
    // Safety: don't escape the src root
    const resolved = path.resolve(fromDir, candidate)
    if (!resolved.startsWith(SRC_DIR)) break
    if (resolveImport(fromDir, candidate)) {
      return candidate
    }
  }

  return null
}

// Match import/export from '...' or import/export from "..."
// Also matches dynamic import('...') with relative paths
const IMPORT_RE = /(?:from\s+|import\s*\(?\s*)(['"])(\.\.?\/[^'"]+)\1/g

let totalFixes = 0
let totalFiles = 0

const files = getAllFiles(SRC_DIR)
console.log(`Scanning ${files.length} files in src/...`)

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const fromDir = path.dirname(filePath)
  let newContent = content
  let fileFixed = false
  const fixes: Array<{ old: string; fixed: string }> = []

  // Reset regex state for each file
  IMPORT_RE.lastIndex = 0

  // Use a replacement approach to handle all matches
  newContent = content.replace(IMPORT_RE, (match, quote, importPath) => {
    const fixed = fixImportPath(fromDir, importPath)
    if (fixed) {
      fixes.push({ old: importPath, fixed })
      fileFixed = true
      return match.replace(importPath, fixed)
    }
    return match
  })

  if (fileFixed) {
    totalFiles++
    totalFixes += fixes.length
    const relPath = path.relative(process.cwd(), filePath)
    console.log(`\n${relPath}:`)
    for (const fix of fixes) {
      console.log(`  ${fix.old}  →  ${fix.fixed}`)
    }
    if (!DRY_RUN) {
      fs.writeFileSync(filePath, newContent, 'utf-8')
    }
  }
}

console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Fixed ${totalFixes} imports across ${totalFiles} files.`)
