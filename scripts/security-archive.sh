#!/usr/bin/env bash
#
# security-archive.sh — shared helper for the release workflows that store
# evidence on the orphan branch (default: security-archive).
#
#   scripts/security-archive.sh dir
#       Prints the release folder name for HEAD: pr-<n>-<date> when the commit
#       subject names a PR (#n), else commit-<sha>-<date>. The date is the commit
#       date (UTC), so every workflow that runs for the same commit gets the same
#       folder.
#
#   scripts/security-archive.sh publish <dir> <file>...
#       Copies the files into <dir>/ on the archive branch and pushes. Retries on
#       a rejected push, because the SBOM and vulnerability workflows run for the
#       same commit and may push at the same time. When ARCHIVE_PROVENANCE names a
#       file, it is written (commit, ref, run) only if the data files changed, so a
#       re-run of the same commit adds nothing.
#
# Env: GH_TOKEN (required for publish), GITHUB_REPOSITORY (set by Actions),
#      ARCHIVE_BRANCH (default security-archive; must start with security-archive),
#      ARCHIVE_PROVENANCE (optional file name, e.g. PROVENANCE-sbom.txt),
#      ARCHIVE_REMOTE_URL (optional; overrides the GitHub remote, for local tests).

set -euo pipefail

cmd="${1:-}"
shift || true

folder_name() {
  local subject pr date
  subject="$(git log -1 --format=%s)"
  pr="$(printf '%s' "$subject" | grep -oE '#[0-9]+' | head -1 | tr -d '#' || true)"
  date="$(TZ=UTC git log -1 --date=format-local:%Y-%m-%d --format=%cd)"
  if [ -n "$pr" ]; then
    echo "pr-${pr}-${date}"
  else
    echo "commit-$(git rev-parse --short HEAD)-${date}"
  fi
}

publish() {
  local dir="$1"; shift
  local branch="${ARCHIVE_BRANCH:-security-archive}"
  case "$branch" in
    security-archive*) ;;
    *) echo "::error::ARCHIVE_BRANCH must start with security-archive (got: $branch)"; exit 1 ;;
  esac
  [ "$#" -gt 0 ] || { echo "::error::publish needs at least one file"; exit 1; }
  for f in "$@"; do [ -f "$f" ] || { echo "::error::missing file to archive: $f"; exit 1; }; done

  # The token goes in an http.extraheader, never in the remote URL, so git error
  # messages and .git/config cannot echo it.
  local remote="${ARCHIVE_REMOTE_URL:-https://github.com/${GITHUB_REPOSITORY}.git}"
  local header=""
  if [ -z "${ARCHIVE_REMOTE_URL:-}" ]; then
    header="Authorization: Basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
  fi
  local sha
  sha="$(git rev-parse HEAD)"

  local work attempt
  for attempt in 1 2 3 4 5; do
    work="$(mktemp -d)"
    git init -q "$work"
    git -C "$work" remote add origin "$remote"
    [ -n "$header" ] && git -C "$work" config --local http.extraheader "$header"
    git -C "$work" config --local user.name "github-actions[bot]"
    git -C "$work" config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
    if git -C "$work" fetch -q --depth 1 origin "$branch" 2>/dev/null; then
      git -C "$work" checkout -q -B "$branch" FETCH_HEAD
    else
      git -C "$work" checkout -q --orphan "$branch"
    fi

    mkdir -p "$work/$dir"
    cp "$@" "$work/$dir/"
    git -C "$work" add "$dir"
    if git -C "$work" diff --cached --quiet; then
      echo "Nothing new to archive in $branch/$dir."
      rm -rf "$work"
      return 0
    fi
    if [ -n "${ARCHIVE_PROVENANCE:-}" ]; then
      printf 'commit: %s\nref: %s\nrun: %s/%s/actions/runs/%s\n' \
        "$sha" "${GITHUB_REF_NAME:-local}" "${GITHUB_SERVER_URL:-}" "${GITHUB_REPOSITORY:-}" "${GITHUB_RUN_ID:-}" \
        > "$work/$dir/$ARCHIVE_PROVENANCE"
      git -C "$work" add "$dir"
    fi
    git -C "$work" commit -q -m "chore(security): archive ${dir}: $(for f in "$@"; do basename "$f"; done | paste -sd ' ' -)"
    if git -C "$work" push -q origin "HEAD:refs/heads/$branch"; then
      echo "Archived $# file(s) to $branch/$dir"
      rm -rf "$work"
      return 0
    fi
    echo "Push rejected (attempt $attempt), retrying on the latest $branch..."
    rm -rf "$work"
    sleep $((attempt * 3))
  done
  echo "::error::could not push to $branch after 5 attempts"
  exit 1
}

case "$cmd" in
  dir) folder_name ;;
  publish) [ "$#" -ge 2 ] || { echo "usage: $0 publish <dir> <file>..."; exit 1; }; publish "$@" ;;
  *) echo "usage: $0 dir | publish <dir> <file>..."; exit 1 ;;
esac
