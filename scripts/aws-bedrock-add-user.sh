#!/bin/sh
# Adds one IAM user who can use the shared Bedrock role from aws-bedrock-setup.sh.
# Repeatable — run it again with a new username for each additional person.
#
# Usage:
#   ./scripts/aws-bedrock-add-user.sh <username> [source-ip-cidr]
#
# The user this creates has exactly one permission: sts:AssumeRole on the shared
# role. It cannot call Bedrock directly — the access key is only good for trading
# itself for short-lived session credentials (see the assume-role command this
# script prints at the end). If [source-ip-cidr] is given, even that AssumeRole
# call is rejected from any other IP.
set -eu

if [ $# -lt 1 ]; then
  echo "Usage: $0 <username> [source-ip-cidr]" >&2
  exit 1
fi

USER_NAME="$1"
SOURCE_CIDR="${2:-}"
ROLE_NAME="${ROLE_NAME:-ai-gateway-bedrock-invoke}"
KEY_DIR="$(cd "$(dirname "$0")/.." && pwd)/state/aws-keys"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

if [ -n "$SOURCE_CIDR" ]; then
  ASSUME_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "${ROLE_ARN}",
      "Condition": { "IpAddress": { "aws:SourceIp": ["${SOURCE_CIDR}"] } }
    }
  ]
}
EOF
)
else
  ASSUME_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "${ROLE_ARN}"
    }
  ]
}
EOF
)
  echo "No source-ip-cidr given — this user can call AssumeRole from anywhere." >&2
  echo "Re-run with a CIDR later and this script will overwrite the policy to add the restriction." >&2
fi

if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  echo "User ${USER_NAME} already exists — updating its assume-role policy only."
else
  aws iam create-user --user-name "$USER_NAME" >/dev/null
  echo "Created user ${USER_NAME}."
fi

aws iam put-user-policy \
  --user-name "$USER_NAME" \
  --policy-name "assume-${ROLE_NAME}" \
  --policy-document "$ASSUME_POLICY"
echo "Policy set: ${USER_NAME} may sts:AssumeRole on ${ROLE_ARN}$( [ -n "$SOURCE_CIDR" ] && echo " from ${SOURCE_CIDR} only")."

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"
KEY_FILE="${KEY_DIR}/${USER_NAME}.json"

if [ -f "$KEY_FILE" ]; then
  echo "Key file ${KEY_FILE} already exists — not creating a second access key."
  echo "Delete it and re-run if you actually want to rotate this user's key."
else
  # Redirected straight to a file: the secret access key never appears in this
  # terminal's scrollback or in any tool output, only in the file itself.
  aws iam create-access-key --user-name "$USER_NAME" --output json > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "Access key created, saved to ${KEY_FILE} (chmod 600, under state/ — gitignored)."
fi

echo
echo "This key is a long-lived credential that can do exactly one thing:"
echo "trade itself for short-lived Bedrock credentials. To mint those (valid ~1h)"
echo "for AI_PROVIDER=bedrock in .env:"
echo
echo "  AWS_PROFILE_KEY_FILE=${KEY_FILE} ./scripts/aws-bedrock-assume.sh ${ROLE_ARN}"
