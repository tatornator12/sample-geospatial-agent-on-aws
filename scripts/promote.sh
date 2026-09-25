#!/usr/bin/env bash
# Promote develop to the live demo: eval gates -> checklist -> explicit yes ->
# fast-forward demo-stable + tag -> stable deploys (every agent) -> env + smoke checks ->
# (optional) the CloudFront UI -> back to develop.
#
# Usage:
#   scripts/promote.sh                         # the real thing (asks for confirmation)
#   DRY_RUN=1 scripts/promote.sh               # print the plan, run the evals with --dry-run, change nothing
#   PROMOTE_FRONTEND=1 scripts/promote.sh      # also deploy the CloudFront/Fargate UI (frontend-cdk)
#   PROMOTE_AGENTS="earth" scripts/promote.sh  # fallback: promote only some agents (default: all)
#
# Every agent is promoted in one run under one tag (design decision 7 in
# .kiro/specs/methane-hunter/design.md); PROMOTE_AGENTS is the documented fallback, e.g. when
# one agent's upstream data is down on promotion day.
#
# The frontend step is opt-in because most promotions change only the agents. With it, the
# Methane Hunter's stable runtime is registered in frontend-cdk/.env's AGENT_RUNTIMES (as
# "methane") after its deploy, so the CloudFront switcher offers it with the right ARN and the
# task role is granted exactly that runtime. The UI deploys only if every smoke check passed.
#
# This is the ONLY sanctioned way demo-stable moves (see .kiro/steering/demo-program.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
TAG="deployed-$(date +%F)"
DRY="${DRY_RUN:-0}"
PROMOTE_AGENTS="${PROMOTE_AGENTS:-earth methane}"

# Per agent: its directory and the prompt that smokes its stable runtime after the deploy.
agent_dir() { case "$1" in earth) echo geo_agent ;; methane) echo agents/methane-hunter ;; *) return 1 ;; esac; }
agent_smoke() { case "$1" in earth) echo similar-central-park ;; methane) echo strongest-plume ;; esac; }
for agent in $PROMOTE_AGENTS; do
    agent_dir "$agent" >/dev/null || { echo "ERROR: unknown agent '$agent' in PROMOTE_AGENTS (earth, methane)"; exit 1; }
done

echo "=== Promotion: develop -> demo-stable ($TAG) — agents: $PROMOTE_AGENTS ==="
echo ""

# --- Preconditions -------------------------------------------------------------------
fail() {
    echo "ERROR: $1"
    [ "$DRY" = "1" ] || exit 1
    echo "(dry run: continuing anyway)"
}
BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "develop" ]; then
    echo "ERROR: promotions start from develop (currently on '$BRANCH')."
    exit 1
fi
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean. Commit or stash before promoting."
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    TAG="$TAG-$(date +%H%M)"
    echo "Tag for today exists; using $TAG"
fi

# Each agent's stable env file (gitignored). Only variable NAMES are read, never values.
for agent in $PROMOTE_AGENTS; do
    env_file="$(agent_dir "$agent")/.env"
    if [ ! -f "$env_file" ]; then
        fail "$env_file not found (the $agent stable deploy reads it)."
    elif [ "$agent" = "methane" ] && ! grep -Eq '^EARTHDATA_TOKEN=.+' "$env_file"; then
        fail "$env_file has no EARTHDATA_TOKEN (Methane Hunter triage needs it; tokens expire after 60 days)."
    else
        echo "  $env_file present"
    fi
done

FRONTEND_ENV="$REPO_ROOT/frontend-cdk/.env"
frontend_env_ok() {
    [ -f "$FRONTEND_ENV" ] || { echo "  frontend-cdk/.env not found"; return 1; }
    for key in AGENT_RUNTIME_ARN AGENT_RUNTIMES ADMIN_EMAIL S3_BUCKET_NAME; do
        grep -Eq "^${key}=.+" "$FRONTEND_ENV" || { echo "  frontend-cdk/.env is missing ${key}"; return 1; }
    done
    # The Earth Analyst's two runtimes must be named so the switcher offers dev and stable.
    grep -Eq '^AGENT_RUNTIMES=.*"stable"' "$FRONTEND_ENV" || { echo "  AGENT_RUNTIMES has no \"stable\" entry"; return 1; }
    grep -Eq '^AGENT_RUNTIMES=.*"dev"' "$FRONTEND_ENV" || { echo "  AGENT_RUNTIMES has no \"dev\" entry"; return 1; }
    return 0
}
if [ "${PROMOTE_FRONTEND:-0}" = "1" ]; then
    echo "Frontend deploy requested (PROMOTE_FRONTEND=1); checking frontend-cdk/.env ..."
    if frontend_env_ok; then
        echo "  frontend-cdk/.env has AGENT_RUNTIME_ARN, AGENT_RUNTIMES (stable + dev), ADMIN_EMAIL, S3_BUCKET_NAME"
        if [[ " $PROMOTE_AGENTS " == *" methane "* ]]; then
            echo "  \"methane\" is (re)registered from the stable deploy's ARN before the UI deploys"
        fi
    else
        fail "frontend-cdk/.env is not ready for a deploy (see above)."
    fi
fi

# --- Gates: golden prompts against every agent's dev runtime ----------------------------
for agent in $PROMOTE_AGENTS; do
    echo ""
    echo "--- Gate: eval ($agent) against its dev runtime ---"
    if [ "$DRY" = "1" ]; then
        "$PYTHON" scripts/eval.py --agent "$agent" --target dev --dry-run
    else
        "$PYTHON" scripts/eval.py --agent "$agent" --target dev
    fi
done

# --- Checklist -------------------------------------------------------------------------
cat <<'CHECKLIST'

--- Promotion checklist (verify each item) ---
  [ ] pytest green:            cd geo_agent && ../.venv/bin/python -m pytest -q
                               cd agents/methane-hunter && ../../.venv/bin/python -m pytest -q
  [ ] frontend tests green:    cd react-ui/frontend && npm test
  [ ] backend tests green:     cd react-ui/backend && npm test
  [ ] detector clean:          cd react-ui/frontend && npm run design:check
  [ ] env vars present on each dev runtime and one smoke invoke done after its last deploy
  [ ] local UI round-trip against the dev runtimes looked right (map, steps, caption), per act
  [ ] no secrets staged (.env*, .bedrock_agentcore.yaml, mcp.json stay untracked)
  [ ] Earthdata token in agents/methane-hunter/.env valid past the next rehearsal (expires 2026-11-16)
  [ ] if the UI changed: PROMOTE_FRONTEND=1 so the CloudFront URL gets the same release;
      afterwards hard-reload it and confirm every act is in the switcher
CHECKLIST
echo ""

FRONTEND_CMD='cd frontend-cdk && set -a && source .env && set +a && npx cdk deploy GeospatialAgentStack --require-approval never'
REGISTER_ARGS=(--env frontend-cdk/.env --id methane --agent methane --target stable
               --label "Methane Hunter" --description "EMIT methane plumes, deployed from demo-stable")

if [ "$DRY" = "1" ]; then
    echo "[dry-run] would ask for confirmation, then:"
    echo "[dry-run]   git switch demo-stable && git merge --ff-only develop && git tag $TAG"
    for agent in $PROMOTE_AGENTS; do
        echo "[dry-run]   cd $(agent_dir "$agent") && DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh"
    done
    for agent in $PROMOTE_AGENTS; do
        echo "[dry-run]   $PYTHON scripts/runtimes.py check-env --agent $agent --target stable"
        echo "[dry-run]   $PYTHON scripts/eval.py --agent $agent --target stable --only $(agent_smoke "$agent")"
    done
    if [ "${PROMOTE_FRONTEND:-0}" = "1" ]; then
        if [[ " $PROMOTE_AGENTS " == *" methane "* ]]; then
            echo "[dry-run]   $PYTHON scripts/runtimes.py register ${REGISTER_ARGS[*]}"
        fi
        echo "[dry-run]   (only if every check above passed) $FRONTEND_CMD"
    else
        echo "[dry-run]   (frontend not deployed; PROMOTE_FRONTEND=1 adds: $FRONTEND_CMD)"
    fi
    echo "[dry-run]   git switch develop"
    exit 0
fi

printf 'Type yes to fast-forward demo-stable, tag %s and deploy stable (%s): ' "$TAG" "$PROMOTE_AGENTS"
read -r ANSWER
if [ "$ANSWER" != "yes" ]; then
    echo "Aborted (answer was not 'yes'). Nothing changed."
    exit 1
fi

# --- Promote (dry run exited above; from here everything is real) ----------------------
git switch demo-stable
# Whatever happens next, end on develop (a failed deploy must not leave the tree on demo-stable).
trap 'git switch -q develop 2>/dev/null || true' EXIT
git merge --ff-only develop
git tag "$TAG"

for agent in $PROMOTE_AGENTS; do
    echo ""
    echo "--- Deploying $agent to stable ---"
    (cd "$(agent_dir "$agent")" && DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh)
done

# --- After every deploy: env vars persisted, one smoke per agent -------------------------
CHECKS_OK=1
for agent in $PROMOTE_AGENTS; do
    echo ""
    echo "--- Checking $agent's stable runtime ---"
    "$PYTHON" scripts/runtimes.py check-env --agent "$agent" --target stable || CHECKS_OK=0
    "$PYTHON" scripts/eval.py --agent "$agent" --target stable --only "$(agent_smoke "$agent")" || CHECKS_OK=0
done

if [ "${PROMOTE_FRONTEND:-0}" = "1" ]; then
    echo ""
    if [ "$CHECKS_OK" != "1" ]; then
        echo "Frontend NOT deployed: a stable runtime check failed (see above). The previous UI stays live."
        echo "Fix or roll back the runtime, then run:  $FRONTEND_CMD"
    else
        if [[ " $PROMOTE_AGENTS " == *" methane "* ]]; then
            "$PYTHON" scripts/runtimes.py register "${REGISTER_ARGS[@]}"
        fi
        echo "--- Deploying the CloudFront/Fargate UI (frontend-cdk) ---"
        # The stack reads AGENT_RUNTIME_ARN / AGENT_RUNTIMES / ADMIN_EMAIL from the environment;
        # source the gitignored .env in a subshell so nothing leaks into this shell afterwards.
        (eval "$FRONTEND_CMD")
    fi
else
    echo ""
    echo "Frontend NOT deployed. If the UI changed in this release, run:"
    echo "  $FRONTEND_CMD"
fi

git switch develop
echo ""
echo "Promotion complete: demo-stable is at $(git rev-parse --short demo-stable), tagged $TAG."
[ "$CHECKS_OK" = "1" ] || echo "WARNING: at least one stable runtime check failed; see above before the next rehearsal."
echo "Follow-up: push develop, demo-stable and $TAG; hard-reload the CloudFront URL and check every act."
