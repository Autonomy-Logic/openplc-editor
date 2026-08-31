/**
 * Classifying the libraries a retrieved project brought with it.
 *
 * The case that matters is `differs`: a library with the same name but
 * different bytes builds a different program, silently. Reporting that as
 * "already installed" would be worse than saying nothing, which is why status
 * is decided by content hash and not by the version label.
 */

import { hashText, type SnapshotLibrary } from '../../../shared/project/project-snapshot-archive'
import { describeRetrievedLibraries } from '../describe-retrieved-libraries'

async function library(name: string, version: string, body: string): Promise<SnapshotLibrary> {
  const archive = JSON.stringify({ manifest: { name, version }, body })
  return { name, version, hash: await hashText(archive), archive }
}

it('reports a library this machine does not have as missing', async () => {
  const motion = await library('Motion', '1.0.0', 'a')
  const described = await describeRetrievedLibraries([motion], () => null)
  expect(described).toEqual([{ name: 'Motion', version: '1.0.0', status: 'missing' }])
})

it('reports an identical library as installed', async () => {
  const motion = await library('Motion', '1.0.0', 'a')
  const described = await describeRetrievedLibraries([motion], () => motion.archive)
  expect(described[0].status).toBe('installed')
})

it('reports the same name with different bytes as differing', async () => {
  // Same name, same version, different contents -- the silent-wrong-program
  // case. Version alone cannot distinguish these.
  const theirs = await library('Motion', '1.0.0', 'built-against-this')
  const mine = await library('Motion', '1.0.0', 'something-else')
  const described = await describeRetrievedLibraries([theirs], () => mine.archive)
  expect(described[0].status).toBe('differs')
})

it('does not treat a matching version as a matching library', async () => {
  // Stated separately because it is the assumption the hash exists to replace.
  const theirs = await library('Motion', '1.0.0', 'x')
  const mine = await library('Motion', '1.0.0', 'y')
  expect(theirs.version).toBe(mine.version)
  const described = await describeRetrievedLibraries([theirs], () => mine.archive)
  expect(described[0].status).not.toBe('installed')
})

it('classifies each library independently', async () => {
  const present = await library('Present', '1', 'same')
  const absent = await library('Absent', '1', 'x')
  const changed = await library('Changed', '1', 'theirs')
  const local: Record<string, string> = {
    Present: present.archive,
    Changed: (await library('Changed', '1', 'mine')).archive,
  }
  const described = await describeRetrievedLibraries(
    [present, absent, changed],
    (name) => local[name] ?? null,
  )
  expect(described.map((entry) => entry.status)).toEqual(['installed', 'missing', 'differs'])
})

it('handles a project with no libraries', async () => {
  expect(await describeRetrievedLibraries([], () => null)).toEqual([])
})
