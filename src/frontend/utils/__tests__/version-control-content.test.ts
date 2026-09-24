import { pickContentForSave } from '../version-control-content'

/**
 * The save derives a project's libraries from the blocks it uses. On open, the
 * snapshot it compares against already includes them, so a project saved
 * before that rule existed looked "unchanged" and its raw project.json — with
 * no libraries at all — was echoed back, and the other editor never got
 * anything to warn about.
 */
describe('pickContentForSave and project.json libraries', () => {
  const raw = JSON.stringify({ meta: { name: 'P' }, data: { libraries: [] } })
  const fresh = JSON.stringify({ meta: { name: 'P' }, data: { libraries: [{ name: 'demo-utils', version: '1.0.0' }] } })

  it('uploads the fresh project.json when it declares a library the raw one lacks', () => {
    const picked = pickContentForSave('project.json', fresh, {
      loadedSerialized: { 'project.json': fresh },
      rawLoadedContent: { 'project.json': raw },
    })

    expect(picked).toBe(fresh)
  })

  it('still echoes the raw bytes when the libraries agree', () => {
    const rawSame = JSON.stringify({
      meta: { name: 'P' },
      data: { libraries: [{ name: 'demo-utils', version: '1.0.0' }] },
    })
    const picked = pickContentForSave('project.json', fresh, {
      loadedSerialized: { 'project.json': fresh },
      rawLoadedContent: { 'project.json': rawSame },
    })

    expect(picked).toBe(rawSame)
  })

  it('leaves every other path on the plain unchanged-means-raw rule', () => {
    const picked = pickContentForSave('pous/programs/main.st', 'fresh', {
      loadedSerialized: { 'pous/programs/main.st': 'fresh' },
      rawLoadedContent: { 'pous/programs/main.st': 'raw bytes' },
    })

    expect(picked).toBe('raw bytes')
  })
})
