#!/bin/bash
# Shared deploy guard for the AgentCore deploy scripts (deploy.sh, deploy_with_langfuse.sh).
#
# Why this exists: a bare `./deploy.sh` used to update the LIVE demo runtime on every
# run. Every deploy now has to name its target explicitly, and the stable runtime
# additionally requires CONFIRM_STABLE=yes.
#
#   DEPLOY_TARGET=dev ./deploy.sh                          # dev runtime, reads .env.dev
#   DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh    # live demo runtime, reads .env
#   DRY_RUN=1 DEPLOY_TARGET=dev ./deploy.sh                # print the commands, touch nothing
#
# Optional (set by other agents' deploy scripts, e.g. agents/methane-hunter/deploy.sh):
#   STABLE_AGENT_NAME=methane_hunter      # stable runtime name (default geospatial_agent_on_aws)
#   DEV_AGENT_NAME=methane_hunter_dev     # dev runtime name (default geospatial_agent_dev)
#   AGENTCORE_BIN=/path/to/agentcore      # the bedrock-agentcore-starter-toolkit CLI
#
# Usage from a deploy script:
#   source "$(cd "$(dirname "$0")" && pwd)/deploy_lib.sh"
#   resolve_deploy_target      # sets AGENT_NAME, ENV_FILE, AGENTCORE_BIN
#   run <command...>           # executes, or prints (with secrets redacted) when DRY_RUN=1

# The directory of this library, so the venv CLI is found wherever the calling script lives.
DEPLOY_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_REPO_ROOT="$(cd "${DEPLOY_LIB_DIR}/.." && pwd)"

resolve_deploy_target() {
    local stable_name="${STABLE_AGENT_NAME:-geospatial_agent_on_aws}"
    case "${DEPLOY_TARGET:-}" in
        stable)
            AGENT_NAME="${stable_name}"
            ENV_FILE=".env"
            if [ "${CONFIRM_STABLE:-}" != "yes" ]; then
                echo "Refusing to deploy to the STABLE demo runtime (${AGENT_NAME}) without CONFIRM_STABLE=yes." >&2
                echo "  DEPLOY_TARGET=stable CONFIRM_STABLE=yes $0" >&2
                exit 1
            fi
            ;;
        dev)
            AGENT_NAME="${DEV_AGENT_NAME:-geospatial_agent_dev}"
            ENV_FILE=".env.dev"
            if [ "${AGENT_NAME}" = "${stable_name}" ] || [ "${AGENT_NAME}" = "geospatial_agent_on_aws" ]; then
                echo "Refusing: DEV_AGENT_NAME must not be a stable runtime name." >&2
                exit 1
            fi
            ;;
        "")
            cat >&2 <<'EOF'
Refusing to deploy: DEPLOY_TARGET is not set.

  DEPLOY_TARGET=dev ./deploy.sh                          # dev runtime (reads .env.dev)
  DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh    # live demo runtime (reads .env)
  DRY_RUN=1 DEPLOY_TARGET=dev ./deploy.sh                # show what would run
EOF
            exit 1
            ;;
        *)
            echo "Unknown DEPLOY_TARGET '${DEPLOY_TARGET}' (expected: stable | dev)" >&2
            exit 1
            ;;
    esac

    if [ ! -f "${ENV_FILE}" ]; then
        echo "Error: ${ENV_FILE} not found (required for DEPLOY_TARGET=${DEPLOY_TARGET})." >&2
        if [ "${DEPLOY_TARGET}" = "dev" ]; then
            echo "  Create it from .env (same bucket and role are fine): cp .env .env.dev" >&2
        fi
        exit 1
    fi

    # The Homebrew `agentcore` (AgentCore CLI, CDK-based) has no configure/launch commands.
    # Prefer the starter-toolkit CLI in the project venv unless AGENTCORE_BIN is set.
    if [ -z "${AGENTCORE_BIN:-}" ]; then
        if [ -x "${DEPLOY_REPO_ROOT}/.venv/bin/agentcore" ]; then
            AGENTCORE_BIN="${DEPLOY_REPO_ROOT}/.venv/bin/agentcore"
        else
            AGENTCORE_BIN="agentcore"
        fi
    fi
    if [ "${DRY_RUN:-0}" != "1" ] && ! "${AGENTCORE_BIN}" configure --help >/dev/null 2>&1; then
        echo "Error: '${AGENTCORE_BIN}' is not the bedrock-agentcore-starter-toolkit CLI (no 'configure' command)." >&2
        echo "  Set AGENTCORE_BIN to the toolkit binary, e.g. AGENTCORE_BIN=../.venv/bin/agentcore" >&2
        exit 1
    fi

    export AGENT_NAME ENV_FILE AGENTCORE_BIN
    echo "Deploy target: ${DEPLOY_TARGET}  (agent: ${AGENT_NAME}, env: ${ENV_FILE}, cli: ${AGENTCORE_BIN})"
    if [ "${DRY_RUN:-0}" = "1" ]; then
        echo "DRY RUN: commands are printed, nothing is executed."
    fi
}

# Run a command, or print it (redacting secret-looking KEY=VALUE args) when DRY_RUN=1.
run() {
    if [ "${DRY_RUN:-0}" = "1" ]; then
        printf '[dry-run]'
        local arg
        for arg in "$@"; do
            case "${arg}" in
                *TOKEN=*|*SECRET*=*|*_KEY=*|*PASSWORD*=*|*OTEL_EXPORTER_OTLP_HEADERS=*)
                    printf ' %s=<redacted>' "${arg%%=*}" ;;
                *)
                    printf ' %q' "${arg}" ;;
            esac
        done
        printf '\n'
    else
        "$@"
    fi
}
