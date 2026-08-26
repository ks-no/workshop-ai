#!/bin/sh
# One-time setup: turns on Bedrock model-invocation logging so
# aws-bedrock-dashboard.ts can show per-user request volume. Without this,
# there is no way to see who is calling Bedrock or how often — CloudTrail's
# management-events trail records sts:AssumeRole (who assumed the role, when,
# from where) but not the InvokeModel calls made with the resulting session.
#
# Deliberately metadata-only: textDataDeliveryEnabled / imageDataDeliveryEnabled
# / embeddingDataDeliveryEnabled / videoDataDeliveryEnabled are all set to
# false explicitly — AWS defaults videoDataDeliveryEnabled to true if it's
# left out of the request, even though nothing here ever sends video. This
# sandbox proxies
# citizen data (KRR, Folkeregister, SvarUt) through Bedrock prompts, so logging
# prompt/response content would put that data at rest in CloudWatch Logs — not
# a call this script should make on its own. What's captured either way:
# caller identity (assumed-role session ARN, which carries the username —
# see aws-bedrock-assume.sh), model id, timestamp, token counts, latency.
# That's enough to attribute usage per person and spot volume spikes without
# capturing what was actually asked or answered.
#
# Re-run to change LOG_GROUP/RETENTION_DAYS; safe to run more than once.
set -eu

REGION="${AWS_REGION:-eu-north-1}"
LOG_GROUP="${LOG_GROUP:-/ai-gateway/bedrock-invocations}"
LOGGING_ROLE_NAME="${LOGGING_ROLE_NAME:-ai-gateway-bedrock-logging}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "Account:    ${ACCOUNT_ID}"
echo "Region:     ${REGION}"
echo "Log group:  ${LOG_GROUP} (${RETENTION_DAYS}-day retention)"
echo

aws logs create-log-group --region "$REGION" --log-group-name "$LOG_GROUP" 2>/dev/null \
  && echo "Created log group ${LOG_GROUP}." \
  || echo "Log group ${LOG_GROUP} already exists."
aws logs put-retention-policy --region "$REGION" --log-group-name "$LOG_GROUP" \
  --retention-in-days "$RETENTION_DAYS"

TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "bedrock.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" },
        "ArnLike": { "aws:SourceArn": "arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:*" }
      }
    }
  ]
}
EOF
)

if aws iam get-role --role-name "$LOGGING_ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$LOGGING_ROLE_NAME" --policy-document "$TRUST_POLICY"
  echo "Role ${LOGGING_ROLE_NAME} already exists — trust policy refreshed."
else
  aws iam create-role \
    --role-name "$LOGGING_ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Lets Bedrock write ai-gateway model-invocation metadata to CloudWatch Logs" \
    >/dev/null
  echo "Created role ${LOGGING_ROLE_NAME}."
fi

PERMISSION_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:${LOG_GROUP}:*"
    }
  ]
}
EOF
)
aws iam put-role-policy \
  --role-name "$LOGGING_ROLE_NAME" \
  --policy-name "${LOGGING_ROLE_NAME}-write-logs" \
  --policy-document "$PERMISSION_POLICY"

LOGGING_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${LOGGING_ROLE_NAME}"

echo "Waiting a few seconds for IAM role propagation before Bedrock tries to assume it..."
sleep 10

aws bedrock put-model-invocation-logging-configuration --region "$REGION" --logging-config "$(cat <<EOF
{
  "cloudWatchConfig": {
    "logGroupName": "${LOG_GROUP}",
    "roleArn": "${LOGGING_ROLE_ARN}"
  },
  "textDataDeliveryEnabled": false,
  "imageDataDeliveryEnabled": false,
  "embeddingDataDeliveryEnabled": false,
  "videoDataDeliveryEnabled": false
}
EOF
)"

echo
echo "Bedrock model-invocation logging is on (metadata only, no prompt/response content)."
echo "New invocations will start appearing in ${LOG_GROUP} within a few minutes."
echo
echo "Next: node scripts/aws-bedrock-dashboard.ts"
