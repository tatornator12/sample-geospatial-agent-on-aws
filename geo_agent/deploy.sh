#!/bin/bash

# Deploy AgentCore agent without Langfuse observability
# Simpler deployment using only required environment variables
#
# Every run must name its target (see deploy_lib.sh):
#   DEPLOY_TARGET=dev ./deploy.sh
#   DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh
#   DRY_RUN=1 DEPLOY_TARGET=dev ./deploy.sh

set -e

cd "$(dirname "$0")"
source ./deploy_lib.sh
resolve_deploy_target

echo "Loading configuration from ${ENV_FILE}..."

# Load environment variables from the target's env file
set -a
source "${ENV_FILE}"
set +a

# Validate required variables
required_vars=("S3_BUCKET_NAME" "AGENTCORE_ARN" "ARCGIS_MCP_TOKEN")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "Error: Required environment variable $var is not set in ${ENV_FILE}"
        exit 1
    fi
done

# Set defaults for optional variables
MODEL_ID="${MODEL_ID:-us.anthropic.claude-sonnet-4-6}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ARCGIS_MCP_URL="${ARCGIS_MCP_URL:-https://esri.geospatial.tfc.aws.dev/hosting/platform/mcp}"

# Export region so agentcore CLI deploys to the correct region
export AWS_REGION
export AWS_DEFAULT_REGION="${AWS_REGION}"

if [ "${DRY_RUN:-0}" = "1" ]; then
    AWS_ACCOUNT_ID="123456789012"
else
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
fi
# One ECR repo per agent runtime so dev/side agents never overwrite the stable image
ECR_SHORT_NAME="bedrock-agentcore-${AGENT_NAME}"
ECR_REPO_NAME="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_SHORT_NAME}"

# Ensure ECR repo exists (first deploy needs this). Kept out of `run` so the dry run
# still shows the step instead of losing it in the redirects.
if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "[dry-run] aws ecr describe-repositories --repository-names ${ECR_SHORT_NAME} --region ${AWS_REGION} || aws ecr create-repository --repository-name ${ECR_SHORT_NAME} --region ${AWS_REGION}"
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
echo "   LGND Embeddings: ${LGND_EMBEDDINGS_ENABLED:-false}"
echo ""

# Configure agent
echo "Configuring agent ${AGENT_NAME}..."
run "${AGENTCORE_BIN}" configure \
    --deployment-type container \
    --entrypoint geospatial_agent_on_aws.py \
    --name "${AGENT_NAME}" \
    --ecr "${ECR_REPO_NAME}" \
    --execution-role "${AGENTCORE_ARN}" \
    --disable-memory \
    --disable-otel \
    --non-interactive

# Restore Dockerfile
run cp Dockerfile_geospatial_agent_on_aws Dockerfile

echo ""
echo "Launching agent ${AGENT_NAME}..."

# Deploy with environment variables (always addressed by agent name, never the yaml default)
run "${AGENTCORE_BIN}" launch \
    --agent "${AGENT_NAME}" \
    --env "AWS_REGION=${AWS_REGION}" \
    --env "S3_BUCKET_NAME=${S3_BUCKET_NAME}" \
    --env "MODEL_ID=${MODEL_ID}" \
    --env "BEDROCK_MODEL_ID=${MODEL_ID}" \
    --env "LGND_EMBEDDINGS_ENABLED=${LGND_EMBEDDINGS_ENABLED:-false}" \
    --env "ARCGIS_MCP_URL=${ARCGIS_MCP_URL}" \
    --env "ARCGIS_MCP_TOKEN=${ARCGIS_MCP_TOKEN}" \
    --env "DISABLE_ADOT_OBSERVABILITY=${DISABLE_ADOT_OBSERVABILITY:-false}" \
    --auto-update-on-conflict

echo ""
echo "Deployment complete! (target: ${DEPLOY_TARGET}, agent: ${AGENT_NAME})"
echo ""
echo "Next steps:"
echo "   1. Get the Agent Runtime ARN: grep -A3 '^  ${AGENT_NAME}:' -n .bedrock_agentcore.yaml | grep agent_arn"
echo "   2. Confirm env vars persisted on the runtime (a launch without --env once crash-looped it)"
echo "   3. Test: ${AGENTCORE_BIN} invoke --agent ${AGENT_NAME} '{\"prompt\": \"Show vegetation for Hyde Park London\"}'"
