# tasks module — sourced by ./smoke.sh, which provides check(), code(), $BASE, $JAR, $H
tasks_url="$BASE/api/v1/tasks"
id_of() { sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1; }

new_task='{"title":"Smoke task","priority":"high"}'
# Rejections, one invariant each.
blank_title='{"title":""}'
bad_status='{"title":"Smoke","status":"maybe"}'
unknown_field='{"title":"Smoke","colour":"red"}'
derived_field='{"title":"Smoke","completedAt":"2026-01-01T00:00:00Z"}'

check "tasks: needs auth"       401 "$(code "$tasks_url")"
check "tasks: list"             200 "$(code -b "$JAR" "$tasks_url")"
check "tasks: search"           200 "$(code -b "$JAR" "$tasks_url?q=smoke")"
check "tasks: filter"           200 "$(code -b "$JAR" "$tasks_url?filter=status:todo,doing")"
check "tasks: sort"             200 "$(code -b "$JAR" "$tasks_url?sort_by=-created_at")"
check "tasks: unknown sort_by"  400 "$(code -b "$JAR" "$tasks_url?sort_by=secret")"
check "tasks: unknown filter"   400 "$(code -b "$JAR" "$tasks_url?filter=secret:1")"
check "tasks: blank title"      422 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" -d "$blank_title")"
check "tasks: bad status"       422 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" -d "$bad_status")"
check "tasks: unknown field"    422 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" -d "$unknown_field")"
check "tasks: derived field"    422 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" -d "$derived_field")"
check "tasks: create"           201 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" -d "$new_task")"

parent=$(curl -s -b "$JAR" "${H[@]}" -X POST "$tasks_url" -d "$new_task" | id_of)
child=$(curl -s -b "$JAR" "${H[@]}" -X POST "$tasks_url" \
  -d "$(printf '{"title":"Smoke subtask","parentId":"%s"}' "$parent")" | id_of)
check "tasks: subtask"          201 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" \
  -d "$(printf '{"title":"Another subtask","parentId":"%s"}' "$parent")")"
# One level deep: a subtask cannot be a parent.
check "tasks: subtask depth"    409 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" \
  -d "$(printf '{"title":"Too deep","parentId":"%s"}' "$child")")"
check "tasks: self parent"      409 "$(code -b "$JAR" "${H[@]}" -X PATCH "$tasks_url/$parent" \
  -d "$(printf '{"parentId":"%s"}' "$parent")")"
# A task with subtasks cannot become one.
check "tasks: parent demoted"   409 "$(code -b "$JAR" "${H[@]}" -X PATCH "$tasks_url/$parent" \
  -d "$(printf '{"parentId":"%s"}' "$child")")"
check "tasks: missing parent"   422 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url" \
  -d '{"title":"Orphan","parentId":"00000000-0000-0000-0000-000000000000"}')"

check "tasks: get"              200 "$(code -b "$JAR" "$tasks_url/$child")"
check "tasks: patch"            200 "$(code -b "$JAR" "${H[@]}" -X PATCH "$tasks_url/$child" -d '{"priority":"urgent"}')"
check "tasks: complete"         200 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url/$child:complete" -d '{}')"
# Completing a done task is a retry, not an error.
check "tasks: complete again"   200 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url/$child:complete" -d '{}')"
check "tasks: reopen"           200 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url/$child:reopen" -d '{}')"
check "tasks: unknown action"   404 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url/$child:teleport" -d '{}')"
check "tasks: delete"           204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$tasks_url/$child")"
check "tasks: gone"             404 "$(code -b "$JAR" "${H[@]}" -X DELETE "$tasks_url/$child")"
check "tasks: restore"          200 "$(code -b "$JAR" "${H[@]}" -X POST "$tasks_url/$child:restore" -d '{}')"
