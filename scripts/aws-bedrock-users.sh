#!/bin/sh
# Lists / revokes the IAM users created by aws-bedrock-add-user.sh.
#
# Membership isn't tracked anywhere separate - a user counts as an
# ai-gateway user if it has the inline policy aws-bedrock-add-user.sh
# always attaches, named "assume-${ROLE_NAME}". Nothing else creates a
# policy with that exact name, so checking for it is enough.
#
# Usage:
#   ./scripts/aws-bedrock-users.sh list
#   ./scripts/aws-bedrock-users.sh revoke <username>
#   ./scripts/aws-bedrock-users.sh reactivate <username>
set -eu

ROLE_NAME="${ROLE_NAME:-ai-gateway-bedrock-invoke}"
POLICY_NAME="assume-${ROLE_NAME}"

find_ai_gateway_users() {
  for u in $(aws iam list-users --query "Users[].UserName" --output text); do
    if aws iam get-user-policy --user-name "$u" --policy-name "$POLICY_NAME" >/dev/null 2>&1; then
      echo "$u"
    fi
  done
}

first_key_field() {
  # $1 = username, $2 = jmespath field (AccessKeyId | Status)
  aws iam list-access-keys --user-name "$1" --query "AccessKeyMetadata[0].$2" --output text
}

cmd_list() {
  printf "%-24s %-10s %-20s\n" "USER" "STATUS" "LAST USED"
  for u in $(find_ai_gateway_users); do
    key_id=$(first_key_field "$u" "AccessKeyId")
    if [ "$key_id" = "None" ] || [ -z "$key_id" ]; then
      printf "%-24s %-10s %-20s\n" "$u" "no-key" "-"
      continue
    fi
    status=$(first_key_field "$u" "Status")
    last_used=$(aws iam get-access-key-last-used --access-key-id "$key_id" \
      --query "AccessKeyLastUsed.LastUsedDate" --output text)
    printf "%-24s %-10s %-20s\n" "$u" "$status" "$last_used"
  done
}

cmd_revoke() {
  u="$1"
  key_id=$(first_key_field "$u" "AccessKeyId")
  [ "$key_id" != "None" ] && [ -n "$key_id" ] || { echo "No access key for $u" >&2; exit 1; }
  aws iam update-access-key --user-name "$u" --access-key-id "$key_id" --status Inactive
  echo "Deactivated access key for $u."
  echo "New sts:AssumeRole calls fail immediately. A session already handed out"
  echo "before this still works until it expires on its own (max 12h, see"
  echo "MaxSessionDuration on ai-gateway-bedrock-invoke) - there is no way to"
  echo "invalidate an already-issued STS session token early."
}

cmd_reactivate() {
  u="$1"
  key_id=$(first_key_field "$u" "AccessKeyId")
  [ "$key_id" != "None" ] && [ -n "$key_id" ] || { echo "No access key for $u" >&2; exit 1; }
  aws iam update-access-key --user-name "$u" --access-key-id "$key_id" --status Active
  echo "Reactivated access key for $u."
}

case "${1:-list}" in
  list) cmd_list ;;
  revoke)
    [ $# -ge 2 ] || { echo "Usage: $0 revoke <username>" >&2; exit 1; }
    cmd_revoke "$2"
    ;;
  reactivate)
    [ $# -ge 2 ] || { echo "Usage: $0 reactivate <username>" >&2; exit 1; }
    cmd_reactivate "$2"
    ;;
  *)
    echo "Usage: $0 {list|revoke <username>|reactivate <username>}" >&2
    exit 1
    ;;
esac
