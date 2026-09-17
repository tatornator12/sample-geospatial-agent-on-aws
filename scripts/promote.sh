#!/usr/bin/env bash
# Promote develop to the live demo: eval gate -> checklist -> explicit yes ->
# fast-forward demo-stable + tag -> stable deploy -> back to develop.
#
# Usage:
#   scripts/promote.sh              # the real thing (asks for confirmation)
#   DRY_RUN=1 scripts/promote.sh    # print the plan, run eval --dry-run, change nothing
#
# This is the ONLY sanctioned way demo-stable moves (see .kiro/steering/demo-program.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
TAG="deployed-$(date +%F)"

echo "=== Promotion: develop -> demo-stable ($TAG) ==="
echo ""

# --- Preconditions -------------------------------------------------------------------
BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "develop" ]; then
    echo "ERROR: promotions start from develop (currently on '$BRANCH')."
    exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: working tree is not clean. Commit or stash before promoting."
    [ "${DRY_RUN:-0}" = "1" ] || exit 1
    echo "(dry run: continuing anyway)"
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    TAG="$TAG-$(date +%H%M)"
    echo "Tag for today exists; using $TAG"
fi

# --- Gate: golden prompts against dev -------------------------------------------------
echo ""
echo "--- Gate: eval against the dev runtime ---"
if [ "${DRY_RUN:-0}" = "1" ]; then
    "$PYTHON" scripts/eval.py --target dev --dry-run
else
    "$PYTHON" scripts/eval.py --target dev
fi

# --- Checklist -------------------------------------------------------------------------
cat <<'CHECKLIST'

--- Promotion checklist (verify each item) ---
  [ ] pytest green:            cd geo_agent && ../.venv/bin/python -m pytest -q
  [ ] frontend tests green:    cd react-ui/frontend && npm test
  [ ] detector clean:          cd react-ui/frontend && npm run design:check
  [ ] env vars present on the dev runtime and one smoke invoke done after its last deploy
  [ ] local UI round-trip against the dev runtime looked right (map, steps, caption)
  [ ] no secrets staged (.env*, .bedrock_agentcore.yaml, mcp.json stay untracked)
CHECKLIST
echo ""

if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "[dry-run] would ask for confirmation, then:"
    echo "[dry-run]   git switch demo-stable && git merge --ff-only develop && git tag $TAG"
    echo "[dry-run]   cd geo_agent && DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh"
    echo "[dry-run]   git switch develop"
    exit 0
fi

printf 'Type yes to fast-forward demo-stable, tag %s and deploy stable: ' "$TAG"
read -r ANSWER
if [ "$ANSWER" != "yes" ]; then
    echo "Aborted (answer was not 'yes'). Nothing changed."
    exit 1
fi

# --- Promote (dry run exited above; from here everything is real) ----------------------
git switch demo-stable
git merge --ff-only develop
git tag "$TAG"

echo ""
echo "--- Deploying stable ---"
(cd geo_agent && DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh)

git switch develop
echo ""
echo "Promotion complete: demo-stable is at $(git rev-parse --short demo-stable), tagged $TAG."
echo "Follow-up: confirm env vars persisted on the stable runtime and run one smoke invoke."
