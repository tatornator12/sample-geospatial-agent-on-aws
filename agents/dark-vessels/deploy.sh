#!/bin/bash
# Deploy Dark Vessels (Act 3) to its own AgentCore runtime.
#
#   DEPLOY_TARGET=dev ./deploy.sh                       # dark_vessels_dev, reads .env.dev
#   DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh # dark_vessels, reads .env (promotion only)
#   DRY_RUN=1 DEPLOY_TARGET=dev ./deploy.sh             # print the commands, run nothing
#
# VESSEL_CACHE_PREFIX (task 9a's rehearsal, e.g. vessels/cache/v1r) is passed to the runtime only
# when .env.dev sets it, and only on dev; unset, the runtime reads vessels/cache/v1.
#
# The runtime never calls Global Fishing Watch and never holds its token: GFW_API_TOKEN in .env is
# for the offline build (scripts/build_vessel_cache.py) only and is never passed below.
set -e
cd "$(dirname "$0")"

export STABLE_AGENT_NAME="dark_vessels"
export DEV_AGENT_NAME="dark_vessels_dev"
source ../../geo_agent/deploy_lib.sh
resolve_deploy_target

echo "Loading configuration from ${ENV_FILE}..."
set -a
source "${ENV_FILE}"
set +a

required_vars=("S3_BUCKET_NAME" "AGENTCORE_ARN")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "Error: Required environment variable $var is not set in ${ENV_FILE}"
        exit 1
    fi
done

cache_env=()
if [ -n "${VESSEL_CACHE_PREFIX:-}" ]; then
    if [ "${DEPLOY_TARGET}" != "dev" ]; then
        echo "Error: VESSEL_CACHE_PREFIX is for the dev runtime only; remove it from ${ENV_FILE}." >&2
        exit 1
    fi
    if ! [[ "${VESSEL_CACHE_PREFIX}" =~ ^vessels/cache/v1[a-z0-9-]*$ ]]; then
        echo "Error: VESSEL_CACHE_PREFIX must match ^vessels/cache/v1[a-z0-9-]*\$ (got ${VESSEL_CACHE_PREFIX})." >&2
        exit 1
    fi
    cache_env=(--env "VESSEL_CACHE_PREFIX=${VESSEL_CACHE_PREFIX}")
fi

MODEL_ID="${MODEL_ID:-us.anthropic.claude-sonnet-4-6}"
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_REGION
export AWS_DEFAULT_REGION="${AWS_REGION}"

if [ "${DRY_RUN:-0}" = "1" ]; then
    AWS_ACCOUNT_ID="123456789012"
else
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
fi
ECR_SHORT_NAME="bedrock-agentcore-${AGENT_NAME}"
ECR_REPO_NAME="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_SHORT_NAME}"

if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "[dry-run] aws ecr describe-repositories --repository-names ${ECR_SHORT_NAME} || aws ecr create-repository --repository-name ${ECR_SHORT_NAME} --image-scanning-configuration scanOnPush=true"
elif aws ecr describe-repositories --repository-names "${ECR_SHORT_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    echo "ECR repo ${ECR_SHORT_NAME} exists"
else
    echo "Creating ECR repo ${ECR_SHORT_NAME}..."
    aws ecr create-repository --repository-name "${ECR_SHORT_NAME}" --region "${AWS_REGION}" \
        --image-scanning-configuration scanOnPush=true >/dev/null
fi

echo "Configuration:"
echo "   Target: ${DEPLOY_TARGET} (${AGENT_NAME})"
echo "   S3 Bucket: ${S3_BUCKET_NAME}"
echo "   Model: ${MODEL_ID}"
echo "   Region: ${AWS_REGION}"
echo "   ECR Repo: ${ECR_REPO_NAME}"
echo "   Cache prefix: ${VESSEL_CACHE_PREFIX:-vessels/cache/v1 (default)}"
echo ""

# Shared platform code + requirements + Dockerfile into this build context (gitignored).
echo "Staging shared platform code..."
run ../../geo_agent/stage_shared.sh . dark_vessels

echo "Configuring agent ${AGENT_NAME}..."
run "${AGENTCORE_BIN}" configure \
    --deployment-type container \
    --entrypoint dark_vessels.py \
    --name "${AGENT_NAME}" \
    --ecr "${ECR_REPO_NAME}" \
    --execution-role "${AGENTCORE_ARN}" \
    --disable-memory \
    --disable-otel \
    --non-interactive

# `configure` overwrites the Dockerfile; regenerate it from the platform's.
run ../../geo_agent/stage_shared.sh . dark_vessels dockerfile

echo ""
echo "Launching agent ${AGENT_NAME}..."
run "${AGENTCORE_BIN}" launch \
    --agent "${AGENT_NAME}" \
    --env "AWS_REGION=${AWS_REGION}" \
    --env "S3_BUCKET_NAME=${S3_BUCKET_NAME}" \
    --env "MODEL_ID=${MODEL_ID}" \
    --env "BEDROCK_MODEL_ID=${MODEL_ID}" \
    --env "DISABLE_ADOT_OBSERVABILITY=${DISABLE_ADOT_OBSERVABILITY:-true}" \
    "${cache_env[@]}" \
    --auto-update-on-conflict

echo ""
echo "Deployment complete! (target: ${DEPLOY_TARGET}, agent: ${AGENT_NAME})"
echo "Next steps:"
echo "   1. ARN: grep -A3 '^  ${AGENT_NAME}:' .bedrock_agentcore.yaml | grep agent_arn"
echo "   2. Confirm env vars persisted: ../../.venv/bin/python ../../scripts/runtimes.py check-env --agent vessels --target ${DEPLOY_TARGET}"
echo "   3. Smoke: ../../.venv/bin/python ../../scripts/eval.py --agent vessels --target ${DEPLOY_TARGET} --only open-question"
