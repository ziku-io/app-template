#!/usr/bin/env bash
#
# Cut a release: verify, build, bump, tag, push.
#
#   ./scripts/release.sh patch          0.1.0 -> 0.1.1
#   ./scripts/release.sh minor          0.1.0 -> 0.2.0
#   ./scripts/release.sh 1.0.0          an exact version
#   ./scripts/release.sh patch --dry-run
#
# A tag here marks the version of the template a client app was generated from,
# so `git log` on that app can be read against a known starting point. Once
# pushed it is never moved.
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-}"
DRY_RUN=false
[ "${2:-}" = "--dry-run" ] && DRY_RUN=true

die() { printf '\n  %s\n\n' "$1" >&2; exit 1; }
step() { printf '\n▸ %s\n' "$1"; }

case "$BUMP" in
  patch|minor|major) ;;
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) die "usage: ./scripts/release.sh <patch|minor|major|x.y.z> [--dry-run]" ;;
esac

# ── Refuse to release from a state we cannot reproduce ──────────────
step "Checking the working tree"

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || die "On '$branch'. Releases are cut from main."

[ -z "$(git status --porcelain)" ] || die "Working tree is dirty. Commit or stash first."

git fetch --quiet origin main --tags
local_head=$(git rev-parse HEAD)
remote_head=$(git rev-parse origin/main)
[ "$local_head" = "$remote_head" ] ||
  die "main and origin/main have diverged. Pull or push first."

current=$(node -p "require('./package.json').version")
if [ "$BUMP" = "patch" ] || [ "$BUMP" = "minor" ] || [ "$BUMP" = "major" ]; then
  next=$(npm version "$BUMP" --no-git-tag-version --allow-same-version | tr -d 'v')
  # Put it back: nothing is written until every check has passed.
  npm version "$current" --no-git-tag-version --allow-same-version > /dev/null
else
  next="$BUMP"
fi

tag="v$next"
git rev-parse -q --verify "refs/tags/$tag" > /dev/null &&
  die "Tag $tag already exists locally. A published tag is never moved."
git ls-remote --exit-code --tags origin "$tag" > /dev/null 2>&1 &&
  die "Tag $tag already exists on origin. Bump to the next version instead."

# Two separate rules, because they answer different questions.
#
#   - Above every existing tag: a published tag is immutable, so a new one has
#     to move forward. Sorted by version, not by date — a hotfix on an old line
#     tags out of order.
#   - Not below package.json: releasing 0.0.9 when the source says 0.4.0 ships
#     a lie. Equal is fine, and is exactly what a first release looks like:
#     package.json carries a version that was never tagged.
highest=$(git tag --list 'v*' | sed 's/^v//' | sort -V | tail -1)

if [ -n "$highest" ] &&
   { [ "$next" = "$highest" ] ||
     [ "$(printf '%s\n%s\n' "$highest" "$next" | sort -V | tail -1)" != "$next" ]; }; then
  die "$next must be above the highest tag v$highest."
fi

if [ "$(printf '%s\n%s\n' "$current" "$next" | sort -V | tail -1)" != "$next" ]; then
  die "$next is below the version in package.json ($current)."
fi

printf '  %s -> %s\n' "$current" "$next"

# ── Everything that ships has to pass ───────────────────────────────
step "Running checks"
pnpm typecheck
pnpm test

step "Building"
pnpm build

if [ "$DRY_RUN" = true ]; then
  step "Dry run: nothing committed, tagged or pushed."
  exit 0
fi

# ── Commit, tag, push ───────────────────────────────────────────────
step "Tagging $tag"
npm version "$next" --no-git-tag-version --allow-same-version > /dev/null

# A release of a version already in package.json has nothing to commit. That is
# a valid release, not a failure: tag the commit as it stands.
if [ -n "$(git status --porcelain -- package.json)" ]; then
  git add package.json
  git -c user.email="$(git config user.email)" commit -q -m "chore(release): $tag"
else
  printf '  Nothing changed; tagging the current commit.\n'
fi

git tag -a "$tag" -m "$tag"

step "Pushing"
git push --quiet origin main
git push --quiet origin "$tag"

printf '\n  Released %s\n  https://github.com/ziku-io/app-template/releases/tag/%s\n\n' "$tag" "$tag"
printf '  Start a client app from it with:\n    git clone --branch %s git@github.com:ziku-io/app-template.git acme-portal\n\n' "$tag"
