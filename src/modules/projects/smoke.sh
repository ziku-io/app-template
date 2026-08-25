# projects module — sourced by ./smoke.sh
new_project="{\"name\":\"Smoke $RUN\",\"client\":\"Acme\",\"status\":\"Lead\",\"budget\":100}"
blank_name='{"name":"","client":"x","status":"Lead","budget":1}'
bad_status='{"name":"x","client":"x","status":"Nope","budget":1}'
negative='{"name":"x","client":"x","status":"Lead","budget":-5}'
unknown_field='{"name":"x","client":"x","status":"Lead","budget":1,"secret":"y"}'
idem="{\"name\":\"Idem $RUN\",\"client\":\"Acme\",\"status\":\"Lead\",\"budget\":1,\"requestId\":\"$RUN-idem\"}"

check "projects: needs auth"    401 "$(code "$BASE/api/v1/projects")"
check "projects: create"        201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects" -d "$new_project")"
check "projects: list"          200 "$(code -b "$JAR" "$BASE/api/v1/projects")"
check "projects: sort_by"       200 "$(code -b "$JAR" "$BASE/api/v1/projects?sort_by=-budget")"
check "projects: filter"        200 "$(code -b "$JAR" "$BASE/api/v1/projects?filter=status:Lead")"
check "projects: search"        200 "$(code -b "$JAR" "$BASE/api/v1/projects?q=$RUN")"
check "projects: pageSize"      200 "$(code -b "$JAR" "$BASE/api/v1/projects?pageSize=1")"

# negative space: every guard gets a test
check "projects: blank name"    422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects" -d "$blank_name")"
check "projects: bad status"    422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects" -d "$bad_status")"
check "projects: negative"      422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects" -d "$negative")"
check "projects: unknown field" 422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects" -d "$unknown_field")"
check "projects: unknown sort"  400 "$(code -b "$JAR" "$BASE/api/v1/projects?sort_by=owner_id")"
check "projects: unknown filter" 400 "$(code -b "$JAR" "$BASE/api/v1/projects?filter=owner_id:1")"
check "projects: bad token"     400 "$(code -b "$JAR" "$BASE/api/v1/projects?pageToken=zzz")"

# idempotency: the same requestId must not create twice
check "projects: idempotent 1"  201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects" -d "$idem")"
check "projects: idempotent 2"  201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects" -d "$idem")"
idem_count=$(curl -s -b "$JAR" "$BASE/api/v1/projects?q=Idem+$RUN" | grep -oc "\"name\":\"Idem $RUN\"" || true)
check "projects: created once"  1 "$idem_count"

pid=$(curl -s -b "$JAR" "$BASE/api/v1/projects?q=Smoke+$RUN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "projects: get"           200 "$(code -b "$JAR" "$BASE/api/v1/projects/$pid")"
check "projects: delete"        204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/v1/projects/$pid")"
check "projects: hidden"        404 "$(code -b "$JAR" "$BASE/api/v1/projects/$pid")"
deleted_visible=$(curl -s -b "$JAR" "$BASE/api/v1/projects/$pid?includeDeleted=true" | grep -c '"id"')
check "projects: includeDeleted" 1 "$deleted_visible"
check "projects: restore"       200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects/$pid:restore")"
check "projects: back"          200 "$(code -b "$JAR" "$BASE/api/v1/projects/$pid")"
check "projects: bad action"    404 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/projects/$pid:explode")"
