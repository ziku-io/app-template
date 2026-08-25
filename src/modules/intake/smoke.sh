# intake module — sourced by ./smoke.sh
#
# NOTE: the last check deliberately exhausts the public rate limit (10/min per
# IP by default). Two runs inside the same minute will see 429s here — that is
# the limiter working, not a failure. For back-to-back runs start the server
# with RATE_LIMIT_PUBLIC=1000; the burst check then reports itself skipped.
submission='{"name":"Smoke","email":"smoke@example.com","message":"hello there","website":""}'
honeypot='{"name":"Bot","email":"bot@example.com","message":"buy pills","website":"http://spam"}'
unknown_field='{"name":"Smoke","email":"smoke@example.com","message":"hi","utm":"x"}'
bad_email='{"name":"Smoke","email":"not-an-email","message":"hi"}'
blank_message='{"name":"Smoke","email":"smoke@example.com","message":""}'

# PUBLIC: no cookie jar, on purpose. This is the marketing form.
check "intake: public post"        201 "$(code "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$submission")"
# A tripped honeypot answers 201 like everything else. Telling a bot it failed
# teaches it which field to leave alone next time.
check "intake: honeypot accepted"  201 "$(code "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$honeypot")"

# Rejections.
check "intake: unknown body field" 422 "$(code "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$unknown_field")"
check "intake: bad email"          422 "$(code "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$bad_email")"
check "intake: blank message"      422 "$(code "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$blank_message")"

# The public limiter is real: a burst past the budget must be refused. The
# budget is read from the response rather than hardcoded, so this still tests
# the right thing when RATE_LIMIT_PUBLIC is raised. Run it last for this
# endpoint — everything after here would be limited too.
budget=$(curl -s -D - -o /dev/null "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$submission" \
  | tr -d '\r' | sed -n 's/^[Rr]ate[Ll]imit-[Ll]imit: *//p')

if [ -z "$budget" ]; then
  check "intake: public rate limit" "a RateLimit-Limit header" "nothing"
elif [ "$budget" -gt 40 ]; then
  skip "intake: public rate limit" "budget raised to $budget; too many requests to burst"
else
  status=0
  for _ in $(seq 1 "$((budget + 2))"); do
    status=$(code "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$submission")
  done
  check "intake: public rate limit"  429 "$status"
fi
has_limit=$(curl -s -D - -o /dev/null "${H[@]}" -X POST "$BASE/api/v1/intake" -d "$submission" | grep -ci '^ratelimit-limit:' || true)
check "intake: RateLimit header"   1 "$has_limit"

# Admin-only surfaces. A signed-in member is not enough.
check "intake: list needs admin"   403 "$(code -b "$JAR" "$BASE/api/v1/intake")"
check "intake: delete needs admin" 403 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/v1/intake/00000000-0000-0000-0000-000000000000")"
check "intake: list needs auth"    401 "$(code "$BASE/api/v1/intake")"
