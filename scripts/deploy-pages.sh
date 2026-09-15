#!/usr/bin/env sh
# Publish dist/ to the gh-pages branch as a single orphan snapshot commit.
# Runs tests, the production build, and the no-network guard first, so a
# regression can never reach the live site. No dependencies beyond git.
set -eu

cd "$(dirname "$0")/.."
npm test
npm run build
npm run check:no-network

# Build the commit from dist/ with a throwaway index; the working tree and
# current branch are untouched. Git rejects an existing empty index file,
# so only the reserved path is kept.
GIT_INDEX_FILE=$(mktemp)
rm -f "$GIT_INDEX_FILE"
export GIT_INDEX_FILE
git --work-tree=dist add -A
TREE=$(git write-tree)
COMMIT=$(git commit-tree "$TREE" -m "Deploy site $(git rev-parse --short HEAD)")
rm -f "$GIT_INDEX_FILE"
unset GIT_INDEX_FILE

git update-ref refs/heads/gh-pages "$COMMIT"
git push --force origin gh-pages
echo "Published $COMMIT to gh-pages."
