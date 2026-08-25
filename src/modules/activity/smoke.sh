# activity module — sourced by ./smoke.sh
note='{"entityType":"smoke","entityId":"1","text":"hello"}'
check "activity: needs scope" 422 "$(code -b "$JAR" "$BASE/api/activity")"
check "activity: post"        201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/activity" -d "$note")"
check "activity: list"        200 "$(code -b "$JAR" "$BASE/api/activity?entityType=smoke&entityId=1")"
aid=$(curl -s -b "$JAR" "$BASE/api/activity?entityType=smoke&entityId=1" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "activity: delete"      204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/activity/$aid")"
