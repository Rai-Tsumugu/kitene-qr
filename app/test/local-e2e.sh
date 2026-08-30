#!/bin/sh
set -eu

base_url="${MEETQR_BASE_URL:-http://localhost:8787}"
env_file="${MEETQR_ENV_FILE:-./.dev.vars}"
db_flags="${MEETQR_DB_FLAGS:---local}"
run_id="$(node -e "process.stdout.write(require('crypto').randomBytes(8).toString('hex'))")"
reset_key="reset_${run_id}_primary"
second_reset_key="reset_${run_id}_second"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

set -a
. "$env_file"
set +a

assert_status() {
  actual="$1"
  expected="$2"
  label="$3"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL $label expected=$expected actual=$actual"
    exit 1
  fi
  echo "PASS $label status=$actual"
}

json_assert() {
  file="$1"
  expression="$2"
  label="$3"
  node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if (!(${expression})) process.exit(1)" "$file"
  echo "PASS $label"
}

status="$(curl -sS -o "$temp_dir/health.json" -w '%{http_code}' "$base_url/api/health")"
assert_status "$status" 200 health
json_assert "$temp_dir/health.json" "d.ok === true" health_body

status="$(curl -sS -c "$temp_dir/admin.cookies" -o "$temp_dir/admin.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  --data "{\"secret\":\"$DEMO_ADMIN_SECRET\"}" \
  "$base_url/api/admin/session")"
assert_status "$status" 200 admin_login

status="$(curl -sS -b "$temp_dir/admin.cookies" -c "$temp_dir/host.cookies" -o "$temp_dir/reset.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $reset_key" \
  --data '{}' "$base_url/api/admin/demo/reset")"
assert_status "$status" 200 demo_reset
json_assert "$temp_dir/reset.json" "d.ok === true && typeof d.data.inviteUrl === 'string'" reset_body

status="$(curl -sS -b "$temp_dir/admin.cookies" -c "$temp_dir/host-replay.cookies" -o "$temp_dir/reset-replay.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $reset_key" \
  --data '{}' "$base_url/api/admin/demo/reset")"
assert_status "$status" 200 demo_reset_replay
json_assert "$temp_dir/reset-replay.json" \
  "(a => d.data.inviteId === a.data.inviteId && d.data.inviteUrl === a.data.inviteUrl && d.data.expiresAt === a.data.expiresAt)(JSON.parse(require('fs').readFileSync('$temp_dir/reset.json','utf8')))" \
  reset_replay_converges

invite_url="$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(d.data.inviteUrl)" "$temp_dir/reset.json")"

status="$(curl -sS -b "$temp_dir/host.cookies" -o "$temp_dir/host-open.json" -w '%{http_code}' "$base_url/api/host/demo")"
assert_status "$status" 200 host_open
json_assert "$temp_dir/host-open.json" "d.data.invite.state === 'open' && d.data.invite.revision === 1" host_open_body

status="$(curl -sS -c "$temp_dir/participant.cookies" -o "$temp_dir/join.json" -w '%{http_code}' "$invite_url")"
assert_status "$status" 303 participant_join

status="$(curl -sS -b "$temp_dir/participant.cookies" -o "$temp_dir/participant-open.json" -w '%{http_code}' "$base_url/api/participant/invite")"
assert_status "$status" 200 participant_open

participant_key="participant_key_1234567890"
status="$(curl -sS -b "$temp_dir/participant.cookies" -o "$temp_dir/respond.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $participant_key" \
  --data '{"selection":"entrance","revision":1}' "$base_url/api/participant/respond")"
assert_status "$status" 200 participant_respond

rate_index=1
while [ "$rate_index" -le 4 ]; do
  status="$(curl -sS -b "$temp_dir/participant.cookies" -o "$temp_dir/participant-prefill-$rate_index.json" -w '%{http_code}' \
    -H 'Content-Type: application/json' -H "Idempotency-Key: participant_prefill_${run_id}_$rate_index" \
    --data '{"selection":"invalid","revision":1}' "$base_url/api/participant/respond")"
  assert_status "$status" 400 "participant_rate_prefill_$rate_index"
  rate_index=$((rate_index + 1))
done

status="$(curl -sS -b "$temp_dir/participant.cookies" -o "$temp_dir/respond-replay.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $participant_key" \
  --data '{"selection":"entrance","revision":1}' "$base_url/api/participant/respond")"
assert_status "$status" 200 participant_replay

status="$(curl -sS -b "$temp_dir/participant.cookies" -o "$temp_dir/respond-conflict.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $participant_key" \
  --data '{"selection":"reception","revision":1}' "$base_url/api/participant/respond")"
assert_status "$status" 409 participant_idempotency_conflict

status="$(curl -sS -b "$temp_dir/participant.cookies" -o "$temp_dir/participant-new-after-limit.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: participant_after_limit_${run_id}" \
  --data '{"selection":"reception","revision":1}' "$base_url/api/participant/respond")"
assert_status "$status" 429 participant_new_write_rate_limited

status="$(curl -sS -b "$temp_dir/host.cookies" -o "$temp_dir/host-requested.json" -w '%{http_code}' "$base_url/api/host/demo")"
assert_status "$status" 200 host_requested
json_assert "$temp_dir/host-requested.json" "d.data.invite.state === 'requested' && d.data.invite.selectedScope === 'entrance'" host_requested_body

host_key="host_confirm_key_1234567890"
status="$(curl -sS -b "$temp_dir/host.cookies" -o "$temp_dir/confirm.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $host_key" \
  --data '{"revision":1}' "$base_url/api/host/confirm")"
assert_status "$status" 200 host_confirm

rate_index=1
while [ "$rate_index" -le 4 ]; do
  status="$(curl -sS -b "$temp_dir/host.cookies" -o "$temp_dir/host-prefill-$rate_index.json" -w '%{http_code}' \
    -H 'Content-Type: application/json' -H "Idempotency-Key: host_prefill_${run_id}_$rate_index" \
    --data '{"revision":"invalid"}' "$base_url/api/host/confirm")"
  assert_status "$status" 400 "host_rate_prefill_$rate_index"
  rate_index=$((rate_index + 1))
done

status="$(curl -sS -b "$temp_dir/host.cookies" -o "$temp_dir/confirm-replay-after-limit.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $host_key" \
  --data '{"revision":1}' "$base_url/api/host/confirm")"
assert_status "$status" 200 host_replay_bypasses_rate_limit

status="$(curl -sS -b "$temp_dir/host.cookies" -o "$temp_dir/host-new-after-limit.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: host_after_limit_${run_id}" \
  --data '{"revision":1}' "$base_url/api/host/confirm")"
assert_status "$status" 429 host_new_write_rate_limited

status="$(curl -sS -b "$temp_dir/participant.cookies" -o "$temp_dir/participant-confirmed.json" -w '%{http_code}' "$base_url/api/participant/invite")"
assert_status "$status" 200 participant_confirmed
json_assert "$temp_dir/participant-confirmed.json" "d.data.invite.state === 'confirmed' && d.data.invite.revision === 2" confirmed_body

status="$(curl -sS -b "$temp_dir/admin.cookies" -c "$temp_dir/new-host.cookies" -o "$temp_dir/reset-2.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $second_reset_key" \
  --data '{}' "$base_url/api/admin/demo/reset")"
assert_status "$status" 200 demo_reset_again

status="$(curl -sS -o "$temp_dir/old-token.json" -w '%{http_code}' "$invite_url")"
assert_status "$status" 410 old_qr_revoked

status="$(curl -sS -b "$temp_dir/host.cookies" -o "$temp_dir/old-host.json" -w '%{http_code}' "$base_url/api/host/demo")"
assert_status "$status" 401 old_host_revoked

status="$(curl -sS -o "$temp_dir/unknown-token.json" -w '%{http_code}' "$base_url/join/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")"
assert_status "$status" 404 unknown_token

new_invite_url="$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(d.data.inviteUrl)" "$temp_dir/reset-2.json")"
status="$(curl -sS -c "$temp_dir/participant-2.cookies" -o "$temp_dir/join-2.json" -w '%{http_code}' "$new_invite_url")"
assert_status "$status" 303 participant_join_decline_case

status="$(curl -sS -b "$temp_dir/admin.cookies" -o "$temp_dir/wrong-role.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: wrong_role_key_123456' \
  --data '{"revision":1}' "$base_url/api/host/confirm")"
assert_status "$status" 401 wrong_role_rejected

status="$(curl -sS -b "$temp_dir/participant-2.cookies" -o "$temp_dir/decline.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: decline_key_1234567890' \
  --data '{"selection":"decline","revision":1}' "$base_url/api/participant/respond")"
assert_status "$status" 200 participant_decline

status="$(curl -sS -b "$temp_dir/new-host.cookies" -o "$temp_dir/host-declined.json" -w '%{http_code}' "$base_url/api/host/demo")"
assert_status "$status" 200 host_declined
json_assert "$temp_dir/host-declined.json" "d.data.invite.state === 'declined' && d.data.invite.selectedScope === 'decline'" declined_body

rate_index=1
while [ "$rate_index" -le 4 ]; do
  status="$(curl -sS -b "$temp_dir/participant-2.cookies" -o "$temp_dir/rate-$rate_index.json" -w '%{http_code}' \
    -H 'Content-Type: application/json' -H "Idempotency-Key: rate_key_123456789_$rate_index" \
    --data '{"selection":"invalid","revision":1}' "$base_url/api/participant/respond")"
  assert_status "$status" 400 "invalid_enum_$rate_index"
  rate_index=$((rate_index + 1))
done

status="$(curl -sS -b "$temp_dir/participant-2.cookies" -D "$temp_dir/rate-headers.txt" -o "$temp_dir/rate-limit.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: rate_key_123456789_5' \
  --data '{"selection":"invalid","revision":1}' "$base_url/api/participant/respond")"
assert_status "$status" 429 participant_rate_limit
grep -qi '^Retry-After:' "$temp_dir/rate-headers.txt"
echo "PASS rate_limit_retry_after"

json_assert "$temp_dir/rate-limit.json" "d.ok === false && d.error.code === 'RATE_LIMITED' && d.error.retryable === true" error_contract

interaction_counts="$(npx wrangler d1 execute DB $db_flags --command \
  "SELECT action, COUNT(*) AS count FROM interactions GROUP BY action ORDER BY action" --json)"
printf '%s' "$interaction_counts" | node -e \
  "const fs=require('fs');const rows=JSON.parse(fs.readFileSync(0,'utf8'))[0].results; if(!rows.some(r=>r.action==='reset'&&r.count>=2))process.exit(1)"
echo "PASS reset_interaction_audit"

if npx wrangler d1 execute DB $db_flags --command \
  "UPDATE interactions SET response_json='{}' WHERE action='reset'" >/dev/null 2>&1; then
  echo "FAIL interactions_immutable_update"
  exit 1
fi
echo "PASS interactions_immutable_update"

echo "PASS P0 E2E target=$base_url (token values redacted)"
