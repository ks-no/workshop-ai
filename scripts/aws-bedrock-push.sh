#!/bin/sh
# Wraps aws-bedrock-assume.sh for the actual hand-off flow in use: you hold
# everyone's long-lived key file, assume on their behalf, and give them only
# the resulting ~12h session - never the standing key. Prints a ready-to-paste
# .env block and nothing else on stdout, so this drops straight into
# pwpush.com (or `| pbcopy` on macOS) without editing a file first.
#
# Usage:
#   ./scripts/aws-bedrock-push.sh <username> [role-arn]
#
# username needs a key file at state/aws-keys/<username>.json, created by
# aws-bedrock-add-user.sh. role-arn defaults to this account's
# ai-gateway-bedrock-invoke role, looked up via your own (admin) AWS
# credentials - the target user's key is only ever used for the AssumeRole
# call itself, same as aws-bedrock-assume.sh.
set -eu

if [ $# -lt 1 ]; then
  echo "Usage: $0 <username> [role-arn]" >&2
  exit 1
fi

USER_NAME="$1"
ROLE_NAME="${ROLE_NAME:-ai-gateway-bedrock-invoke}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KEY_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/state/aws-keys/${USER_NAME}.json"

if [ ! -f "$KEY_FILE" ]; then
  echo "No key file at ${KEY_FILE} - run ./scripts/aws-bedrock-add-user.sh ${USER_NAME} first." >&2
  exit 1
fi

if [ $# -ge 2 ]; then
  ROLE_ARN="$2"
else
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
fi

TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT

# assume.sh's own progress messages (session expiry, "wrote to ...") go to
# stdout by design for its normal (edit-.env-in-place) use - redirected to
# stderr here so this script's stdout is only ever the paste block below.
AWS_PROFILE_KEY_FILE="$KEY_FILE" "$SCRIPT_DIR/aws-bedrock-assume.sh" "$ROLE_ARN" "$TMP_ENV" >&2

echo "# ai-gateway Bedrock creds for ${USER_NAME} - issued $(date -u +%Y-%m-%dT%H:%M:%SZ), valid ~12h"
echo "AI_PROVIDER=bedrock"
cat "$TMP_ENV"
