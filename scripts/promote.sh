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
# The archaeologist joins the default with Release 3 at G4 (Oct 31; ai-archaeologist decision 7).
PROMOTE_AGENTS="${PROMOTE_AGENTS:-earth methane}"

# One row per agent (a new agent is a new row; bash 3.2 has no associative arrays):
#   id | directory | stable smoke prompt | keys its stable .env must set | AGENT_RUNTIMES id | label | description
# The Earth Analyst's entries ("stable", "dev") are written by hand; the others are registered
# from their stable deploy's ARN before the UI deploys.
AGENT_TABLE='
earth|geo_agent|similar-central-park|S3_BUCKET_NAME AGENTCORE_ARN ARCGIS_MCP_TOKEN|||
methane|agents/methane-hunter|strongest-plume|S3_BUCKET_NAME AGENTCORE_ARN ARCGIS_MCP_TOKEN EARTHDATA_TOKEN|methane|Methane Hunter|EMIT methane plumes, deployed from demo-stable
archaeologist|agents/ai-archaeologist|great-circle-measure|S3_BUCKET_NAME AGENTCORE_ARN ARCGIS_MCP_TOKEN|archaeologist|AI Archaeologist|Known earthworks in 1 m LiDAR, deployed from demo-stable
'
agent_field() { awk -F'|' -v id="$1" -v col="$2" '$1 == id { print $col; exit }' <<<"$AGENT_TABLE"; }
agent_dir() { local d; d="$(agent_field "$1" 2)"; [ -n "$d" ] && echo "$d"; }
agent_smoke() { agent_field "$1" 3; }
agent_env_keys() { agent_field "$1" 4; }
agent_register_id() { agent_field "$1" 5; }
KNOWN_AGENTS="$(awk -F'|' 'NF > 1 { printf "%s%s", sep, $1; sep = ", " }' <<<"$AGENT_TABLE")"
for agent in $PROMOTE_AGENTS; do
    agent_dir "$agent" >/dev/null || { echo "ERROR: unknown agent '$agent' in PROMOTE_AGENTS ($KNOWN_AGENTS)"; exit 1; }
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
        continue
    fi
    missing=""
    bom="$(printf '\357\273\277')"   # a UTF-8 byte-order mark on line 1 must not hide the first key
    for key in $(agent_env_keys "$agent"); do
        LC_ALL=C sed "1s/^${bom}//" "$env_file" | grep -Eq "^(export )?${key}=.+" || missing="$missing $key"
    done
    if [ -n "$missing" ]; then
        hint=""
        [[ " $missing " == *" EARTHDATA_TOKEN "* ]] && hint=" (Methane Hunter triage needs EARTHDATA_TOKEN; tokens expire after 60 days)"
        fail "$env_file has no${missing}${hint}."
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
    # cdk deploy builds the UI image locally, after demo-stable has moved and both runtimes are
    # deployed; a stopped Docker daemon failed exactly there on Oct 12. Check it before anything moves.
    CONTAINER_CLI="${CDK_DOCKER:-docker}"
    if "$CONTAINER_CLI" info >/dev/null 2>&1; then
        echo "  $CONTAINER_CLI is running (cdk deploy builds the UI image)"
    else
        fail "$CONTAINER_CLI is not running; cdk deploy needs it to build the UI image (start Docker Desktop, then rerun)."
    fi
    echo "Frontend deploy requested (PROMOTE_FRONTEND=1); checking frontend-cdk/.env ..."
    if frontend_env_ok; then
        echo "  frontend-cdk/.env has AGENT_RUNTIME_ARN, AGENT_RUNTIMES (stable + dev), ADMIN_EMAIL, S3_BUCKET_NAME"
        for agent in $PROMOTE_AGENTS; do
            rid="$(agent_register_id "$agent")"
            if [ -n "$rid" ]; then
                echo "  \"$rid\" is (re)registered from the stable deploy's ARN before the UI deploys"
            fi
        done
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
                               cd agents/<each agent> && ../../.venv/bin/python -m pytest -q
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
# runtimes.py register arguments for an agent with an AGENT_RUNTIMES id (none for the Earth Analyst).
register_args() {
    REGISTER_ARGS=(--env frontend-cdk/.env --id "$(agent_register_id "$1")" --agent "$1" --target stable
                   --label "$(agent_field "$1" 6)" --description "$(agent_field "$1" 7)")
}

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
        for agent in $PROMOTE_AGENTS; do
            [ -n "$(agent_register_id "$agent")" ] || continue
            register_args "$agent"
            echo "[dry-run]   $PYTHON scripts/runtimes.py register ${REGISTER_ARGS[*]}"
        done
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
        for agent in $PROMOTE_AGENTS; do
            [ -n "$(agent_register_id "$agent")" ] || continue
            register_args "$agent"
            "$PYTHON" scripts/runtimes.py register "${REGISTER_ARGS[@]}"
        done
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
