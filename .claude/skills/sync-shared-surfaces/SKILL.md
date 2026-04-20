---
name: sync-shared-surfaces
description: Mirror shared-surface files between openplc-editor and openplc-web to resolve Shared Surface Sync CI failures. Use when the `sync / Shared Surface Sync` job fails with `hash_mismatch`, `only_in_editor`, or `only_in_web` diffs, or proactively before pushing a feature branch that touches `src/frontend/`, `src/middleware/shared/`, `src/backend/shared/`, or `src/__architecture__/`.
argument-hint: "[--direction=editor-to-web|web-to-editor] [--dry-run] [--no-commit]"
allowed-tools: Bash Read Edit Write Grep Glob
---

# Sync Shared Surfaces (openplc-editor ↔ openplc-web)

Playbook for keeping the shared surfaces of `openplc-editor` and `openplc-web`
byte-identical, which is what the `ci-sync.yml` workflow enforces via
`scripts/compare-surfaces.py`. The same four surface roots are the source of
truth — any change here, on either repo, must land on the other before CI can
go green.

## What counts as a shared surface

Defined in `scripts/compare-surfaces.py` (`SURFACES` constant):

- `src/frontend/`
- `src/middleware/shared/`
- `src/backend/shared/`
- `src/__architecture__/`

Adapters (`middleware/adapters/editor`, `middleware/adapters/web`), backend
process code (`src/main/`, `src/backend/editor/`, `src/backend/web/`), and
platform-specific configs are NOT shared and must NOT be copied across.

## Preflight

Run these checks in order. If any fails, STOP and ask the user how to proceed
rather than guessing.

1. **Locate the sibling repo.** Assume `openplc-web` is a sibling of the
   current `openplc-editor` working directory:
   - Editor root: current `pwd`
   - Web root: `../openplc-web` (resolve to absolute path)

   If the sibling does not exist, ask the user for the path. Do NOT clone.

2. **Confirm both repos are on matching feature branches.** Run `git -C <repo>
   rev-parse --abbrev-ref HEAD` on both. If they differ, surface the mismatch
   and ask the user whether to proceed (sometimes one side is on `development`
   while the feature branch is staged locally — that's a red flag).

3. **Refresh remotes.** Run `git -C <repo> fetch origin <branch>` on both.
   If either working tree is behind its `origin/<branch>`, ask the user
   whether to `git pull --rebase` before syncing — out-of-date local state
   is the #1 cause of "I synced and it's still failing."

4. **Verify clean working trees.** Run `git -C <repo> status --short` on both.
   If there are unrelated staged/unstaged changes, stop and ask the user —
   never bundle unrelated work into a sync commit.

## Detect diffs

Run `scripts/compare-surfaces.py` from the editor repo against the web repo's
`src/` directory:

```bash
python3 scripts/compare-surfaces.py \
  --web-root "<web-path>/src" \
  --editor-root "<editor-path>/src"
```

The script prints a JSON object to stdout. Parse it and group the diffs by
`reason`:

- `only_in_editor` — file exists in editor but not web → default direction
  editor→web
- `only_in_web` — inverse → default web→editor
- `hash_mismatch` — both sides have it but bytes differ → needs a direction
  decision

**Line-ending caveat (Windows):** `compare-surfaces.py` hashes raw bytes, so
files with CRLF in a Windows working tree may hash-mismatch against an LF
copy even when the git index is identical. Before treating a
`hash_mismatch` as real, confirm it's not just line endings by comparing
`git ls-tree` blob hashes:

```bash
git -C <editor> ls-tree origin/<branch> -- <path>
git -C <web>    ls-tree origin/<branch> -- <path>
```

If those blob hashes match, the git index is already in sync and no action
is needed — report it but don't copy.

## Present the plan

Before touching any file, show the user a summary:

```
Editor branch: feat/ethercat-esi-backend (HEAD abc1234)
Web branch:    feat/ethercat-esi-backend (HEAD def5678)

Proposed sync:
  editor → web  (N files)
    - src/frontend/...
    - src/backend/shared/...
  web → editor  (M files)
    - src/middleware/shared/...
  needs decision  (K files)
    - src/frontend/store/__tests__/shared-slice.test.ts
      Last touched in editor by commit <hash> (<subject>)
      Last touched in web    by commit <hash> (<subject>)
```

For every `hash_mismatch`, fetch `git log -1 --oneline -- <path>` on both
sides and include the last-touching commit in the display. This is the
single most important signal for picking a direction: the newer commit
usually wins, unless the older one was the shared-surface migration and the
newer one is a local fix that needs to propagate.

Ask the user to confirm (or redirect) before applying. Do NOT batch-apply
without confirmation unless `--direction=...` was passed explicitly.

## Apply the sync

For each approved diff, copy the file in the chosen direction using `cp` via
Bash. Preserve the relative path exactly — use absolute source and
destination paths to avoid cwd surprises.

```bash
cp "<source-repo>/<relative-path>" "<target-repo>/<relative-path>"
```

If the file's parent directory doesn't exist on the target (new
`only_in_editor` file), create it first with `mkdir -p`.

## Validate the target

After all copies are done, in the target repo:

1. `npx tsc --noEmit` — type check must pass.
2. `npx prettier --check <touched-files>` — formatting must pass.
3. Re-run `compare-surfaces.py` and confirm `total_diffs` dropped as
   expected. Remaining diffs should only be the ones the user explicitly
   chose to skip, or line-ending-only diffs already verified via
   `git ls-tree`.

If type-check fails on the target, STOP. A type error usually means the
synced file references something that doesn't exist on the target repo (web
adapters, editor-only ports, etc.). Do NOT silently edit the synced file to
"fix" the error — that defeats the point of byte-identical shared surfaces.
Instead, report the error and ask the user: it may mean the target repo is
missing a prerequisite change, or the file being synced shouldn't actually
be shared.

## Commit

Unless `--no-commit` was passed:

1. Run `git -C <target> status --short` and `git -C <target> diff --stat` —
   show the user what will land in the commit.
2. Build a commit message of the form:

   ```
   sync: mirror shared surfaces from openplc-<source>

   Synced <N> file(s) from openplc-<source> <branch>@<short-hash>:
     - <file 1>
     - <file 2>
     ...

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

3. Ask the user to confirm before committing. After commit, show the
   resulting `git log --oneline -3` on the target so they can verify.

**Never push.** Pushing is the user's call — surface the commit and stop.

## Arguments

Parse `$ARGUMENTS`:

- `--direction=editor-to-web` — skip the per-diff prompt; every diff (including
  `hash_mismatch`) flows editor→web. Useful when the editor is the canonical
  source for a CodeRabbit batch, ESI feature work, etc.
- `--direction=web-to-editor` — inverse.
- `--dry-run` — do the preflight, detect, and print the plan, but stop before
  copying. Always run this first when the surface count is > 20 or the user
  hasn't run a sync recently.
- `--no-commit` — apply the sync and validate, but leave the target repo
  with unstaged changes for the user to commit manually.

If no `--direction` is given, require interactive confirmation for every
diff. If no `--dry-run`, still treat the first preview pass as a plan — do
not copy before the user confirms.

## When to pick a different tool

- **A handful of known files, direction obvious:** just `cp` by hand and
  commit — faster than walking the full playbook.
- **Merge conflict in a shared file after a pull:** resolve the conflict
  normally; this skill is for silent drift, not merge state.
- **Shared dependency/version drift (`package.json`):** different problem —
  use `scripts/compare-dependencies.py` and align `package.json` manually
  (the `Shared Dependencies Sync` job is separate from this one).
- **Tooling config drift (`.prettierrc`, `eslint.config.*`, `tsconfig*`):**
  use `scripts/compare-tooling.py`; same pattern but different roots.

## Edge cases worth calling out

- **Test files with adapter-specific mocks.** Tests under `src/frontend/store/
  __tests__/` are shared surface, so they must be byte-identical. If a test
  legitimately needs to differ per platform, move the platform-specific
  parts into an adapter test (`middleware/adapters/*/_tests__/`), not into
  the shared test.
- **`src/types/` is NOT in the shared surface list.** Changes there don't
  trip the sync CI, so this skill won't touch them — but they may still need
  manual mirroring for type consistency.
- **CI compares against a web open PR as a fallback.** The sync job will
  pass with a warning if the editor's surfaces match an *open* web PR
  targeting the same base. Ideal flow: land the editor changes, sync to
  web, push both branches before merging either.
