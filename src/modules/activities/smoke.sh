# activities module — sourced by ./smoke.sh
note='{"entityType":"smoke","entityId":"'"$RUN"'","body":"hello"}'
unknown='{"entityType":"smoke","entityId":"'"$RUN"'","body":"hi","nope":true}'
check "activities: post"          201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/activities" -d "$note")"
check "activities: list"          200 "$(code -b "$JAR" "$BASE/api/v1/activities")"
check "activities: nested list"   200 "$(code -b "$JAR" "$BASE/api/v1/smoke/$RUN/activities")"
# negative space
check "activities: reject blank"  422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/activities" -d '{"entityType":"smoke","entityId":"'"$RUN"'","body":""}')"
check "activities: reject extra"  422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/activities" -d "$unknown")"
check "activities: reject sort"   400 "$(code -b "$JAR" "$BASE/api/v1/activities?sort_by=body")"
aid=$(curl -s -b "$JAR" "$BASE/api/v1/activities" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "activities: delete"        204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/v1/activities/$aid")"
check "activities: gone"          404 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/v1/activities/$aid")"
