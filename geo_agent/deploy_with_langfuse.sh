#!/bin/bash

# Deploy AgentCore agent with Langfuse environment variables
# This script deploys the satellite image analyzer agent with Langfuse observability enabled
#
# Every run must name its target (see deploy_lib.sh):
#   DEPLOY_TARGET=dev ./deploy_with_langfuse.sh
#   DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy_with_langfuse.sh
#   DRY_RUN=1 DEPLOY_TARGET=dev ./deploy_with_langfuse.sh

set -e

cd "$(dirname "$0")"
source ./deploy_lib.sh
resolve_deploy_target

echo "📋 Loading configuration from ${ENV_FILE}..."

# Load environment variables from the target's env file
set -a  # automatically export all variables
source "${ENV_FILE}"
set +a  # stop automatically exporting

# Validate required variables
required_vars=("S3_BUCKET_NAME" "LANGFUSE_SECRET_KEY" "LANGFUSE_PUBLIC_KEY" "LANGFUSE_BASE_URL" "AGENTCORE_ARN" "ARCGIS_MCP_TOKEN")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Error: Required environment variable $var is not set in ${ENV_FILE}"
        exit 1
    fi
done

echo "🚀 Deploying AgentCore agent ${AGENT_NAME} with Langfuse observability..."

# Set defaults for optional variables
BEDROCK_MODEL_ID="${MODEL_ID:-us.anthropic.claude-sonnet-4-6}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ARCGIS_MCP_URL="${ARCGIS_MCP_URL:-https://esri.geospatial.tfc.aws.dev/hosting/platform/mcp}"
export AWS_REGION
export AWS_DEFAULT_REGION="${AWS_REGION}"

# Build Basic Auth header for OTEL
LANGFUSE_AUTH=$(echo -n "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" | base64)
OTEL_ENDPOINT="${LANGFUSE_BASE_URL}/api/public/otel"
OTEL_HEADERS="Authorization=Basic ${LANGFUSE_AUTH}"

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

echo "📝 Configuration:"
echo "   Target: ${DEPLOY_TARGET}"
echo "   Agent: ${AGENT_NAME}"
echo "   Entrypoint: geospatial_agent_on_aws.py"
echo "   AWS_ACCOUNT_ID: ${AWS_ACCOUNT_ID}"
echo "   Langfuse URL: ${LANGFUSE_BASE_URL}"
echo "   OTEL Endpoint: ${OTEL_ENDPOINT}"
echo "   ECR_REPO_NAME: ${ECR_REPO_NAME}"
echo "   LGND Embeddings: ${LGND_EMBEDDINGS_ENABLED:-false}"
echo ""

# Configure agent
echo "⚙️  Configuring agent ${AGENT_NAME}..."
run "${AGENTCORE_BIN}" configure \
  --entrypoint geospatial_agent_on_aws.py \
  --name "${AGENT_NAME}" \
  --deployment-type container \
  --ecr "${ECR_REPO_NAME}" \
  --execution-role "${AGENTCORE_ARN}" \
  --disable-memory \
  --disable-otel \
  --non-interactive

echo ""
echo "🚀 Launching agent ${AGENT_NAME} with Langfuse environment variables..."

#overwrite Dockerfile with custom Docker
run cp Dockerfile_geospatial_agent_on_aws Dockerfile

# Deploy with environment variables for LangFuse observability and app configuration
# (always addressed by agent name, never the yaml default)
run "${AGENTCORE_BIN}" launch \
  --agent "${AGENT_NAME}" \
  --env "AWS_REGION=${AWS_REGION}" \
  --env "S3_BUCKET_NAME=${S3_BUCKET_NAME}" \
  --env "MODEL_ID=${BEDROCK_MODEL_ID}" \
  --env "BEDROCK_MODEL_ID=${BEDROCK_MODEL_ID}" \
  --env "LGND_EMBEDDINGS_ENABLED=${LGND_EMBEDDINGS_ENABLED:-false}" \
  --env "ARCGIS_MCP_URL=${ARCGIS_MCP_URL}" \
  --env "ARCGIS_MCP_TOKEN=${ARCGIS_MCP_TOKEN}" \
  --env "OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_ENDPOINT}" \
  --env "LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY}" \
  --env "LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}" \
  --env "LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL}" \
  --env "OTEL_EXPORTER_OTLP_HEADERS=${OTEL_HEADERS}" \
  --env "LANGFUSE_PROJECT_NAME=${LANGFUSE_PROJECT_NAME}" \
  --env "DISABLE_ADOT_OBSERVABILITY=true" \
  --auto-update-on-conflict

echo ""
echo "✅ Deployment complete! (target: ${DEPLOY_TARGET}, agent: ${AGENT_NAME})"
echo "📊 Langfuse observability is enabled"
echo "🔗 View traces at: ${LANGFUSE_BASE_URL}"
echo ""
echo "💡 Next steps:"
echo "   1. Invoke your agent: ${AGENTCORE_BIN} invoke --agent ${AGENT_NAME} '{\"prompt\": \"...\"}'"
echo "   2. Check CloudWatch logs for: '✅ OTLP exporter initialized'"
echo "   3. View traces in Langfuse dashboard"
