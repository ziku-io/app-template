# users module — sourced by ./smoke.sh. The smoke account is a member, so the
# admin-only routes must refuse it.
check "users: members refused" 403 "$(code -b "$JAR" "$BASE/api/users")"
