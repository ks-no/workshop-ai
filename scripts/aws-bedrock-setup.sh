#!/bin/sh
# One-time setup: creates a single shared IAM role that can call bedrock:InvokeModel
# on exactly the models ai-gateway's BEDROCK_MODELS list knows about (see
# apps/ai-gateway/src/server.ts), nothing broader.
#
# Run this once. Adding people who can use it is a separate, repeatable step —
# see aws-bedrock-add-user.sh.
#
# Why a role instead of handing out access keys with bedrock:InvokeModel directly:
# every user this creates (aws-bedrock-add-user.sh) gets a key that can do exactly
# one thing — sts:AssumeRole into this role — and nothing else. The actual
# Bedrock permission lives in one place, so widening or narrowing the model list
# later is one policy edit, not N.
set -eu

REGION="${AWS_REGION:-eu-north-1}"
ROLE_NAME="${ROLE_NAME:-ai-gateway-bedrock-invoke}"

# Keep this in sync with BEDROCK_MODELS in apps/ai-gateway/src/server.ts. These are
# inference-profile ids, not bare model ids: InvokeModel rejects a bare id for these
# models with "on-demand throughput isn't supported ... retry with an inference
# profile" (confirmed against a real account 2026-08-21 — an earlier version of this
# list named Claude 3.x models AWS has since retired).
#
# claude-sonnet-5 is deliberately not here: Bedrock refuses it with a Marketplace
# subscription error that bedrock:InvokeModel plus aws-marketplace:ViewSubscriptions/
# Subscribe did not resolve in testing — it needs a one-time subscription via the
# Bedrock console, not something this script can grant. Add it once that is done.
PROFILE_IDS="
eu.anthropic.claude-sonnet-4-5-20250929-v1:0
eu.anthropic.claude-haiku-4-5-20251001-v1:0
eu.anthropic.claude-opus-4-5-20251101-v1:0
eu.anthropic.claude-opus-5
"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

echo "Account:  ${ACCOUNT_ID}"
echo "Region:   ${REGION}"
echo "Role:     ${ROLE_NAME}"
echo

# A cross-region inference profile forwards to the same foundation model in several
# regions, and Bedrock checks permission on whichever one it lands on — so InvokeModel
# needs bedrock:InvokeModel on the profile ARN *and* every regional model ARN the
# profile can forward to, not just the profile. get-inference-profile is the only
# way to learn that regional fan-out; it is not derivable from the profile id alone.
RESOURCES="["
first=1
count=0
for profile_id in $PROFILE_IDS; do
  [ -z "$profile_id" ] && continue
  count=$((count + 1))

  if [ "$first" -eq 1 ]; then first=0; else RESOURCES="${RESOURCES},"; fi
  RESOURCES="${RESOURCES}\"arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:inference-profile/${profile_id}\""

  model_arns=$(aws bedrock get-inference-profile \
    --region "$REGION" \
    --inference-profile-identifier "$profile_id" \
    --query "models[].modelArn" \
    --output text)
  for model_arn in $model_arns; do
    RESOURCES="${RESOURCES},\"${model_arn}\""
  done
done
RESOURCES="${RESOURCES}]"

TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::${ACCOUNT_ID}:root" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
)
# Trusting the account root here does NOT mean "anyone in the account can assume
# this role" — it means IAM inside this account decides. The actual gate is each
# user's own identity policy (see aws-bedrock-add-user.sh), which must separately
# grant sts:AssumeRole on this exact role ARN before AssumeRole succeeds.

PERMISSION_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": ${RESOURCES}
    }
  ]
}
EOF
)

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "Role ${ROLE_NAME} already exists — updating its trust policy and permissions."
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST_POLICY"
else
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "ai-gateway: bedrock:InvokeModel on the models in BEDROCK_MODELS, nothing else" \
    >/dev/null
  echo "Created role ${ROLE_NAME}."
fi

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "${ROLE_NAME}-invoke-policy" \
  --policy-document "$PERMISSION_POLICY"
echo "Attached invoke policy: bedrock:InvokeModel on ${count} inference profile(s) (and the model ARNs each forwards to) in ${REGION}."

echo
echo "Role ARN: ${ROLE_ARN}"
echo
echo "Next: ./scripts/aws-bedrock-add-user.sh <username> [source-ip-cidr]"
echo
echo "Reminder — IAM is not enough on its own: open the Bedrock console for"
echo "${REGION} -> Model access, and request/enable access to the Anthropic"
echo "models above. bedrock:InvokeModel with model access not granted fails the"
echo "same way a missing IAM permission does."
