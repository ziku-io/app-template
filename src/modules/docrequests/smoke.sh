# docrequests module — sourced by ./smoke.sh, which provides check(), code(), $BASE, $JAR, $H
# Public path is /api/v1/document-requests; the folder is `docrequests` because
# the module id doubles as a JS import identifier in the generated registry.
new_request='{"title":"Smoke doc request '"$RUN"'","notes":"please send"}'
unknown_field='{"title":"Smoke doc request","titel":"typo"}'
forbidden_field='{"title":"Smoke doc request","status":"fulfilled"}'
half_entity='{"title":"Smoke doc request","entityId":"'"$RUN"'"}'

check "docrequests: needs auth"        401 "$(code "$BASE/api/v1/document-requests")"
check "docrequests: list"              200 "$(code -b "$JAR" "$BASE/api/v1/document-requests")"
check "docrequests: create"            201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests" -d "$new_request")"

# Rejections.
check "docrequests: unknown sort_by"   400 "$(code -b "$JAR" "$BASE/api/v1/document-requests?sort_by=nonsense")"
check "docrequests: unknown filter"    400 "$(code -b "$JAR" "$BASE/api/v1/document-requests?filter=nonsense:1")"
check "docrequests: unknown body field" 422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests" -d "$unknown_field")"
check "docrequests: status is a verb"  422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests" -d "$forbidden_field")"
check "docrequests: half an entity"    422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests" -d "$half_entity")"

rid=$(curl -s -b "$JAR" "$BASE/api/v1/document-requests?q=$RUN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)

check "docrequests: get"               200 "$(code -b "$JAR" "$BASE/api/v1/document-requests/$rid")"
check "docrequests: patch"             200 "$(code -b "$JAR" "${H[@]}" -X PATCH "$BASE/api/v1/document-requests/$rid" -d '{"notes":"still waiting"}')"
check "docrequests: unknown action"    404 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$rid:frobnicate" -d '{}')"
# A fulfilment has to name its file: that is the whole invariant.
check "docrequests: fulfil needs file" 422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$rid:fulfil" -d '{}')"
check "docrequests: fulfil ghost file" 422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$rid:fulfil" -d '{"fileId":"00000000-0000-0000-0000-000000000000"}')"

# Upload something real, then fulfil with it.
tmp=$(mktemp); echo "ziku smoke document" > "$tmp"
curl -s -b "$JAR" -H "Origin: $BASE" -X POST "$BASE/api/v1/files" -F "file=@$tmp" > /dev/null || true
fid=$(curl -s -b "$JAR" "$BASE/api/v1/files" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
rm -f "$tmp"

check "docrequests: fulfil"            200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$rid:fulfil" -d "{\"fileId\":\"$fid\"}")"
# The 409 guards: a request answers exactly once.
check "docrequests: fulfil twice"      409 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$rid:fulfil" -d "{\"fileId\":\"$fid\"}")"
check "docrequests: cancel fulfilled"  409 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$rid:cancel" -d '{}')"
check "docrequests: patch fulfilled"   409 "$(code -b "$JAR" "${H[@]}" -X PATCH "$BASE/api/v1/document-requests/$rid" -d '{"notes":"too late"}')"

# A second request, this one cancelled.
curl -s -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests" -d "{\"title\":\"Cancelme$RUN\"}" > /dev/null
cid=$(curl -s -b "$JAR" "$BASE/api/v1/document-requests?q=Cancelme$RUN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "docrequests: cancel"            200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$cid:cancel" -d '{}')"
check "docrequests: cancel twice"      409 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$cid:cancel" -d '{}')"
check "docrequests: fulfil cancelled"  409 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$cid:fulfil" -d "{\"fileId\":\"$fid\"}")"

check "docrequests: delete"            204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/v1/document-requests/$cid")"
check "docrequests: gone"              404 "$(code -b "$JAR" "$BASE/api/v1/document-requests/$cid")"
check "docrequests: restore"           200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/document-requests/$cid:restore" -d '{}')"
check "docrequests: back"              200 "$(code -b "$JAR" "$BASE/api/v1/document-requests/$cid")"

has_limit=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/api/v1/document-requests" | grep -ci '^ratelimit-limit:' || true)
check "docrequests: RateLimit header"  1 "$has_limit"
