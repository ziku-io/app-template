#!/usr/bin/env bash
# End-to-end check of the flows every app inherits: register, session, CRUD,
# query params, validation, sign-out. Run against a booted server:
#   ./smoke.sh http://localhost:3000
set -euo pipefail

BASE="${1:-http://localhost:3000}"
JAR=$(mktemp)
EMAIL="smoke-$RANDOM@ziku.dev"
PASS="correct-horse-1"
# Better Auth rejects state-changing requests whose Origin does not match.
H=(-H "Content-Type: application/json" -H "Origin: $BASE")
fail=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"
  else printf '  FAIL %s (expected %s, got %s)\n' "$1" "$2" "$3"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# Built with printf: inline braces would be brace-expanded into separate args.
credentials=$(printf '{"name":"Smoke","email":"%s","password":"%s"}' "$EMAIL" "$PASS")
wrong_password=$(printf '{"email":"%s","password":"nope"}' "$EMAIL")
new_project='{"name":"Smoke test","client":"Acme","status":"Lead","budget":100}'
bad_project='{"name":"","client":"x","status":"Nope","budget":-1}'

echo "smoke: $BASE"
check "health"             200 "$(code "$BASE/api/health")"
check "projects need auth" 401 "$(code "$BASE/api/projects")"
check "register"           200 "$(code -c "$JAR" "${H[@]}" -X POST "$BASE/api/auth/sign-up/email" -d "$credentials")"
check "session"            200 "$(code -b "$JAR" "$BASE/api/me")"
check "create"             201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/projects" -d "$new_project")"
check "reject bad body"    422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/projects" -d "$bad_project")"
check "list"               200 "$(code -b "$JAR" "$BASE/api/projects")"
check "search"             200 "$(code -b "$JAR" "$BASE/api/projects?q=smoke")"
check "sort"               200 "$(code -b "$JAR" "$BASE/api/projects?sort=-budget")"
check "filter"             200 "$(code -b "$JAR" "$BASE/api/projects?status=Lead")"

id=$(curl -s -b "$JAR" "$BASE/api/projects?q=Smoke" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "delete"             204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/projects/$id")"
check "delete is gone"     404 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/projects/$id")"
check "bad password"       401 "$(code "${H[@]}" -X POST "$BASE/api/auth/sign-in/email" -d "$wrong_password")"
check "sign out"           200 "$(code -b "$JAR" -c "$JAR" "${H[@]}" -X POST "$BASE/api/auth/sign-out" -d '{}')"
check "session is gone"    401 "$(code -b "$JAR" "$BASE/api/me")"
check "spa fallback"       200 "$(code "$BASE/projects")"

rm -f "$JAR"
[ "$fail" = 0 ] && echo "all good" || { echo "FAILED"; exit 1; }
