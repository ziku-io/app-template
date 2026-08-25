# tickets module — sourced by ./smoke.sh, which provides check(), code(), $BASE, $JAR, $H
new_ticket='{"subject":"Smoke ticket","priority":"high"}'
bad_status='{"subject":"Smoke ticket","status":"nope"}'
unknown_field='{"subject":"Smoke ticket","sujbect":"typo"}'
half_entity='{"subject":"Smoke ticket","entityType":"project"}'

check "tickets: needs auth"        401 "$(code "$BASE/api/v1/tickets")"
check "tickets: list"              200 "$(code -b "$JAR" "$BASE/api/v1/tickets")"
check "tickets: create"            201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets" -d "$new_ticket")"

# Rejections. Each one is a case the API must refuse, not quietly accept.
check "tickets: unknown sort_by"   400 "$(code -b "$JAR" "$BASE/api/v1/tickets?sort_by=nonsense")"
check "tickets: unknown filter"    400 "$(code -b "$JAR" "$BASE/api/v1/tickets?filter=nonsense:1")"
check "tickets: bad pageToken"     400 "$(code -b "$JAR" "$BASE/api/v1/tickets?pageToken=not-a-cursor")"
check "tickets: unknown body field" 422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets" -d "$unknown_field")"
check "tickets: bad status"        422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets" -d "$bad_status")"
check "tickets: half an entity"    422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets" -d "$half_entity")"

tid=$(curl -s -b "$JAR" "$BASE/api/v1/tickets?q=Smoke%20ticket" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)

check "tickets: get"               200 "$(code -b "$JAR" "$BASE/api/v1/tickets/$tid")"
check "tickets: post message"      201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid/messages" -d '{"bodyText":"hello"}')"
check "tickets: internal note"     201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid/messages" -d '{"bodyText":"staff only","internal":true}')"
check "tickets: list messages"     200 "$(code -b "$JAR" "$BASE/api/v1/tickets/$tid/messages")"
check "tickets: msg unknown sort"  400 "$(code -b "$JAR" "$BASE/api/v1/tickets/$tid/messages?sort_by=nonsense")"
check "tickets: msg unknown field" 422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid/messages" -d '{"bodyText":"hi","secret":true}')"
check "tickets: msg on ghost"      404 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/00000000-0000-0000-0000-000000000000/messages" -d '{"bodyText":"hi"}')"

# The smoke account is a member, which counts as staff for now, so it does see
# the internal note. An external role would get one message here, not two.
internal_seen=$(curl -s -b "$JAR" "$BASE/api/v1/tickets/$tid/messages" | grep -c '"internal":true' || true)
check "tickets: staff see internal" 1 "$internal_seen"

check "tickets: patch"             200 "$(code -b "$JAR" "${H[@]}" -X PATCH "$BASE/api/v1/tickets/$tid" -d '{"priority":"urgent"}')"
check "tickets: patch to closed"   422 "$(code -b "$JAR" "${H[@]}" -X PATCH "$BASE/api/v1/tickets/$tid" -d '{"status":"closed"}')"
check "tickets: unknown action"    404 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid:frobnicate" -d '{}')"
check "tickets: close"             200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid:close" -d '{}')"
check "tickets: close twice"       409 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid:close" -d '{}')"
check "tickets: msg while closed"  409 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid/messages" -d '{"bodyText":"too late"}')"
check "tickets: reopen"            200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid:reopen" -d '{}')"
check "tickets: reopen twice"      409 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid:reopen" -d '{}')"
check "tickets: delete"            204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/v1/tickets/$tid")"
check "tickets: gone"              404 "$(code -b "$JAR" "$BASE/api/v1/tickets/$tid")"
check "tickets: restore"           200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/tickets/$tid:restore" -d '{}')"
check "tickets: back"              200 "$(code -b "$JAR" "$BASE/api/v1/tickets/$tid")"

# Rate limit headers prove the limiter is mounted on this route.
check "tickets: rate limited"      200 "$(code -b "$JAR" -D /dev/null "$BASE/api/v1/tickets")"
has_limit=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/api/v1/tickets" | grep -ci '^ratelimit-limit:' || true)
check "tickets: RateLimit header"  1 "$has_limit"
