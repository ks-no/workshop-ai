#!/bin/sh
# Trades one user's long-lived (but powerless-except-AssumeRole) access key for
# short-lived Bedrock session credentials, and writes them straight into an env
# file's BEDROCK_AWS_* lines. Nothing is ever printed to the terminal: the secret
# goes from the key file, through this process's memory, into the target file.
#
# Written as BEDROCK_AWS_* rather than plain AWS_*: a developer's own shell often
# already exports AWS_ACCESS_KEY_ID/etc for unrelated personal credentials, and
# both Compose and `node --env-file` prefer an already-set shell variable over one
# from a .env file — so a plain AWS_ACCESS_KEY_ID in .env would silently be
# shadowed by whatever the shell already has, pairing a personal permanent key
# with this service's temporary session token: "The security token included in
# the request is invalid." Confirmed happening in practice, not theoretical.
#
# Usage:
#   AWS_PROFILE_KEY_FILE=state/aws-keys/<username>.json \
#     ./scripts/aws-bedrock-assume.sh <role-arn> [env-file]
#
# Re-run this whenever the session expires (default 12h) — .env then has fresh
# short-lived creds instead of a permanent secret sitting in a dotfile.
set -eu

if [ $# -lt 1 ]; then
  echo "Usage: AWS_PROFILE_KEY_FILE=<path> $0 <role-arn> [env-file]" >&2
  exit 1
fi

ROLE_ARN="$1"
ENV_FILE="${2:-.env}"
REGION="${BEDROCK_AWS_REGION:-eu-north-1}"
# Matches ROLE_MAX_SESSION_SECONDS in aws-bedrock-setup.sh — that script sets
# the role's ceiling, this requests up to it. AssumeRole errors if this asks
# for more than the role's own MaxSessionDuration allows, so keep them equal.
DURATION_SECONDS="${DURATION_SECONDS:-43200}"
: "${AWS_PROFILE_KEY_FILE:?Set AWS_PROFILE_KEY_FILE to the key file from aws-bedrock-add-user.sh}"

USER_CREDS=$(node -e '
  const fs = require("fs");
  const key = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(key.AccessKey.AccessKeyId + " " + key.AccessKey.SecretAccessKey);
' "$AWS_PROFILE_KEY_FILE")
USER_AKID=$(echo "$USER_CREDS" | cut -d' ' -f1)
USER_ASECRET=$(echo "$USER_CREDS" | cut -d' ' -f2)

# The session name is the only thing that ties a Bedrock invocation (or a
# CloudTrail AssumeRole event) back to a person — the assumed-role session
# ARN Bedrock logs carries this verbatim. Deriving it from the key file's
# name (state/aws-keys/<username>.json, written by aws-bedrock-add-user.sh)
# means aws-bedrock-dashboard.ts can attribute usage per user without
# cross-referencing CloudTrail. The trailing epoch is what keeps concurrent
# sessions from the same user distinct; it's stripped back off by matching
# /-\d+$/, so it must stay numeric and last.
KEY_BASENAME=$(basename "$AWS_PROFILE_KEY_FILE")
USER_NAME="${KEY_BASENAME%.json}"

# env -i: a clean environment for this one call, so no ambient AWS_* creds from
# the calling shell can leak in or get mixed up with the user's key.
ASSUME_JSON=$(env -i PATH="$PATH" \
  AWS_ACCESS_KEY_ID="$USER_AKID" \
  AWS_SECRET_ACCESS_KEY="$USER_ASECRET" \
  AWS_DEFAULT_REGION="$REGION" \
  aws sts assume-role \
    --role-arn "$ROLE_ARN" \
    --role-session-name "${USER_NAME}-$(date +%s)" \
    --duration-seconds "$DURATION_SECONDS" \
    --output json)

node -e '
  const fs = require("fs");
  const assumed = JSON.parse(process.argv[1]).Credentials;
  const envFile = process.argv[2];
  const region = process.argv[3];

  const lines = { BEDROCK_AWS_REGION: region, BEDROCK_AWS_ACCESS_KEY_ID: assumed.AccessKeyId,
    BEDROCK_AWS_SECRET_ACCESS_KEY: assumed.SecretAccessKey, BEDROCK_AWS_SESSION_TOKEN: assumed.SessionToken };

  let content = "";
  try { content = fs.readFileSync(envFile, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  let rows = content.length ? content.split("\n") : [];

  for (const [key, value] of Object.entries(lines)) {
    const pattern = new RegExp("^" + key + "=.*$");
    const line = key + "=" + value;
    const index = rows.findIndex((row) => pattern.test(row));
    if (index >= 0) rows[index] = line; else rows.push(line);
  }

  fs.writeFileSync(envFile, rows.join("\n").replace(/\n{2,}$/, "\n"));
  console.log("Wrote BEDROCK_AWS_REGION/BEDROCK_AWS_ACCESS_KEY_ID/BEDROCK_AWS_SECRET_ACCESS_KEY/BEDROCK_AWS_SESSION_TOKEN to " + envFile + ".");
  console.log("Session expires: " + assumed.Expiration + " — re-run this script after that.");
' "$ASSUME_JSON" "$ENV_FILE" "$REGION"

echo
echo "Now: set AI_PROVIDER=bedrock (or switch it at http://localhost:8082/admin) and restart/refresh ai-gateway."
