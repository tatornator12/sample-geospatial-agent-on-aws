#!/usr/bin/env bash
# Promote develop to the live demo: eval gate -> checklist -> explicit yes ->
# fast-forward demo-stable + tag -> stable deploy -> back to develop.
#
# Usage:
#   scripts/promote.sh                     # the real thing (asks for confirmation)
#   DRY_RUN=1 scripts/promote.sh           # print the plan, run eval --dry-run, change nothing
#   PROMOTE_FRONTEND=1 scripts/promote.sh  # also deploy the CloudFront/Fargate UI (frontend-cdk)
#
# The frontend step is opt-in because most promotions change only the agent. When the UI
# changed (a new prepared prompt, a new layer style), pass PROMOTE_FRONTEND=1 so the
# CloudFront URL shows the same release as the stable runtime. Without it the script prints
# the exact command to run by hand.
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

# --- Frontend pre-check (only reads variable NAMES from the gitignored .env, never values) ---
FRONTEND_ENV="$REPO_ROOT/frontend-cdk/.env"
frontend_env_ok() {
    [ -f "$FRONTEND_ENV" ] || return 1
    for key in AGENT_RUNTIME_ARN AGENT_RUNTIMES ADMIN_EMAIL; do
        grep -Eq "^${key}=.+" "$FRONTEND_ENV" || { echo "  frontend-cdk/.env is missing ${key}"; return 1; }
    done
    # Both runtimes must be named so the switcher offers dev and stable after the deploy.
    grep -Eq '^AGENT_RUNTIMES=.*"stable"' "$FRONTEND_ENV" || { echo "  AGENT_RUNTIMES has no \"stable\" entry"; return 1; }
    grep -Eq '^AGENT_RUNTIMES=.*"dev"' "$FRONTEND_ENV" || { echo "  AGENT_RUNTIMES has no \"dev\" entry"; return 1; }
    return 0
}
if [ "${PROMOTE_FRONTEND:-0}" = "1" ]; then
    echo "Frontend deploy requested (PROMOTE_FRONTEND=1); checking frontend-cdk/.env ..."
    if frontend_env_ok; then
        echo "  frontend-cdk/.env has AGENT_RUNTIME_ARN, AGENT_RUNTIMES (dev + stable), ADMIN_EMAIL"
    else
        echo "ERROR: frontend-cdk/.env is not ready for a deploy (see above)."
        [ "${DRY_RUN:-0}" = "1" ] || exit 1
        echo "(dry run: continuing anyway)"
    fi
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
  [ ] if the UI changed: PROMOTE_FRONTEND=1 so the CloudFront URL gets the same release;
      afterwards hard-reload it and confirm the new prepared prompt / layer group is there
CHECKLIST
echo ""

if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "[dry-run] would ask for confirmation, then:"
    echo "[dry-run]   git switch demo-stable && git merge --ff-only develop && git tag $TAG"
    echo "[dry-run]   cd geo_agent && DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh"
    if [ "${PROMOTE_FRONTEND:-0}" = "1" ]; then
        echo "[dry-run]   cd frontend-cdk && set -a && source .env && set +a && npx cdk deploy GeospatialAgentStack --require-approval never"
    else
        echo "[dry-run]   (frontend not deployed; PROMOTE_FRONTEND=1 adds: cd frontend-cdk && npx cdk deploy GeospatialAgentStack)"
    fi
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

if [ "${PROMOTE_FRONTEND:-0}" = "1" ]; then
    echo ""
    echo "--- Deploying the CloudFront/Fargate UI (frontend-cdk) ---"
    # The stack reads AGENT_RUNTIME_ARN / AGENT_RUNTIMES / ADMIN_EMAIL from the environment;
    # source the gitignored .env in a subshell so nothing leaks into this shell afterwards.
    (cd frontend-cdk && set -a && source .env && set +a && npx cdk deploy GeospatialAgentStack --require-approval never)
else
    echo ""
    echo "Frontend NOT deployed. If the UI changed in this release, run:"
    echo "  cd frontend-cdk && set -a && source .env && set +a && npx cdk deploy GeospatialAgentStack --require-approval never"
fi

git switch develop
echo ""
echo "Promotion complete: demo-stable is at $(git rev-parse --short demo-stable), tagged $TAG."
echo "Follow-up: confirm env vars persisted on the stable runtime and run one smoke invoke;"
echo "           hard-reload the CloudFront URL and check the release is visible there too."
