#!/usr/bin/env bash
# End-to-end check of the flows every app inherits, plus whatever each
# installed module contributes. Run against a booted server:
#   ./smoke.sh http://localhost:3000
set -euo pipefail
cd "$(dirname "$0")"

BASE="${1:-http://localhost:3000}"
JAR=$(mktemp)
EMAIL="smoke-$RANDOM-$$@ziku.dev"
# Fixtures are namespaced per run: without this a second run against the same
# database sees the first run's rows and the guards look broken.
RUN="run$RANDOM$$"
PASS="correct-horse-1"
# Better Auth rejects state-changing requests whose Origin does not match.
H=(-H "Content-Type: application/json" -H "Origin: $BASE")
fail=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"
  else printf '  FAIL %s (expected %s, got %s)\n' "$1" "$2" "$3"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# A skipped check says so out loud. A silently passing test is worse than none.
skip() { printf '  skip %s (%s)\n' "$1" "$2"; }

# Built with printf: inline braces would be brace-expanded into separate args.
credentials=$(printf '{"name":"Smoke","email":"%s","password":"%s"}' "$EMAIL" "$PASS")
wrong_password=$(printf '{"email":"%s","password":"nope"}' "$EMAIL")

echo "smoke: $BASE"
check "health"          200 "$(code "$BASE/api/health")"
check "guarded route"   401 "$(code "$BASE/api/v1/me")"
check "register"        200 "$(code -c "$JAR" "${H[@]}" -X POST "$BASE/api/auth/sign-up/email" -d "$credentials")"
check "session"         200 "$(code -b "$JAR" "$BASE/api/v1/me")"
check "spa fallback"    200 "$(code "$BASE/")"

# Modules run here, while the smoke account is signed in. Each contributes its
# own checks and inherits check(), code(), $BASE, $JAR and $H.
for module in src/modules/*/smoke.sh; do
  [ -e "$module" ] || continue
  echo "  -- $(basename "$(dirname "$module")")"
  # shellcheck disable=SC1090
  . "$module"
done

check "bad password"    401 "$(code "${H[@]}" -X POST "$BASE/api/auth/sign-in/email" -d "$wrong_password")"
check "sign out"        200 "$(code -b "$JAR" -c "$JAR" "${H[@]}" -X POST "$BASE/api/auth/sign-out" -d '{}')"
check "session is gone" 401 "$(code -b "$JAR" "$BASE/api/v1/me")"

rm -f "$JAR"
[ "$fail" = 0 ] && echo "all good" || { echo "FAILED"; exit 1; }
