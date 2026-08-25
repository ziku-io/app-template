# projects module — sourced by ./smoke.sh
new_project='{"name":"Smoke test","client":"Acme","status":"Lead","budget":100}'
bad_project='{"name":"","client":"x","status":"Nope","budget":-1}'
check "projects: needs auth"  401 "$(code "$BASE/api/projects")"
check "projects: create"      201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/projects" -d "$new_project")"
check "projects: reject bad"  422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/projects" -d "$bad_project")"
check "projects: search"      200 "$(code -b "$JAR" "$BASE/api/projects?q=smoke")"
check "projects: sort"        200 "$(code -b "$JAR" "$BASE/api/projects?sort=-budget")"
check "projects: filter"      200 "$(code -b "$JAR" "$BASE/api/projects?status=Lead")"
pid=$(curl -s -b "$JAR" "$BASE/api/projects?q=Smoke" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "projects: delete"      204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/projects/$pid")"
check "projects: gone"        404 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/projects/$pid")"
