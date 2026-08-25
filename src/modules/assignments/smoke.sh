# assignments module — sourced by ./smoke.sh, which provides check(), code(), $BASE, $JAR, $H
A="$BASE/api/v1/assignments"
first_id() { sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1; }

uid=$(curl -s -b "$JAR" "$BASE/api/v1/me" | first_id)

# A second account, so ownership has somewhere to go. The user FK means a made-up
# id would be a database error rather than a test.
JAR2=$(mktemp)
EMAIL2="smoke-assign-$RANDOM@ziku.dev"
mate=$(printf '{"name":"Mate","email":"%s","password":"%s"}' "$EMAIL2" "$PASS")
curl -s -o /dev/null -c "$JAR2" "${H[@]}" -X POST "$BASE/api/auth/sign-up/email" -d "$mate"
uid2=$(curl -s -b "$JAR2" "$BASE/api/v1/me" | first_id)

owner=$(printf '{"entityType":"smoke","entityId":"'"$RUN"'","userId":"%s","role":"owner"}' "$uid")
member=$(printf '{"entityType":"smoke","entityId":"'"$RUN"'","userId":"%s","role":"member"}' "$uid")
bad_role=$(printf '{"entityType":"smoke","entityId":"'"$RUN"'","userId":"%s","role":"admin"}' "$uid")
unknown_field=$(printf '{"entityType":"smoke","entityId":"'"$RUN"'","userId":"%s","isOwner":true}' "$uid")
blank_entity=$(printf '{"entityType":"","entityId":"'"$RUN"'","userId":"%s"}' "$uid")

check "assignments: needs auth"     401 "$(code "$A")"
check "assignments: assign owner"   201 "$(code -b "$JAR" "${H[@]}" -X POST "$A" -d "$owner")"
check "assignments: duplicate"      409 "$(code -b "$JAR" "${H[@]}" -X POST "$A" -d "$member")"
# Negative space: each of these must be refused, not quietly accepted.
check "assignments: bad role"       422 "$(code -b "$JAR" "${H[@]}" -X POST "$A" -d "$bad_role")"
check "assignments: unknown field"  422 "$(code -b "$JAR" "${H[@]}" -X POST "$A" -d "$unknown_field")"
check "assignments: blank entity"   422 "$(code -b "$JAR" "${H[@]}" -X POST "$A" -d "$blank_entity")"
check "assignments: unknown sort"   400 "$(code -b "$JAR" "$A?sort_by=nope")"
check "assignments: unknown filter" 400 "$(code -b "$JAR" "$A?filter=nope:1")"

check "assignments: list"           200 "$(code -b "$JAR" "$A?entityType=smoke&entityId=$RUN")"
check "assignments: by user"        200 "$(code -b "$JAR" "$A?userId=$uid")"
check "assignments: by role"        200 "$(code -b "$JAR" "$A?role=owner")"

aid=$(curl -s -b "$JAR" "$A?entityType=smoke&entityId=$RUN&userId=$uid" | first_id)
check "assignments: get one"        200 "$(code -b "$JAR" "$A/$aid")"

# The invariant: a record must never lose its last owner.
check "assignments: last owner"     409 "$(code -b "$JAR" "${H[@]}" -X DELETE "$A/$aid")"

transfer=$(printf '{"toUserId":"%s"}' "$uid2")
check "assignments: transfer"       200 "$(code -b "$JAR" "${H[@]}" -X POST "$A/$aid:transferOwnership" -d "$transfer")"
# Transferring demoted the first assignment, so it is now removable...
check "assignments: unassign"       204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$A/$aid")"
# ...and the new owner is now the last one.
bid=$(curl -s -b "$JAR" "$A?entityType=smoke&entityId=$RUN&userId=$uid2" | first_id)
check "assignments: last owner 2"   409 "$(code -b "$JAR" "${H[@]}" -X DELETE "$A/$bid")"

# Transferring from a live assignment that is not the owner is refused. This
# needs its own record: on the one above, $uid already has a live row, and the
# unique index would make the setup itself a 409.
other="$RUN-b"
curl -s -b "$JAR" "${H[@]}" -X POST "$A" -d "$(printf '{"entityType":"smoke","entityId":"%s","userId":"%s","role":"owner"}' "$other" "$uid2")" > /dev/null
curl -s -b "$JAR" "${H[@]}" -X POST "$A" -d "$(printf '{"entityType":"smoke","entityId":"%s","userId":"%s","role":"member"}' "$other" "$uid")" > /dev/null
mid=$(curl -s -b "$JAR" "$A?entityType=smoke&entityId=$other&userId=$uid" | first_id)
check "assignments: not an owner"   409 "$(code -b "$JAR" "${H[@]}" -X POST "$A/$mid:transferOwnership" -d "$transfer")"
# A soft-deleted row is a 404, not a 409: it is gone, not merely ineligible.
check "assignments: deleted row"    404 "$(code -b "$JAR" "${H[@]}" -X POST "$A/$aid:transferOwnership" -d "$transfer")"

check "assignments: restore"        200 "$(code -b "$JAR" "${H[@]}" -X POST "$A/$aid:restore" -d '{}')"
# Restore is idempotent: a live assignment restores to itself.
check "assignments: restore twice"  200 "$(code -b "$JAR" "${H[@]}" -X POST "$A/$aid:restore" -d '{}')"
check "assignments: unknown action" 404 "$(code -b "$JAR" "${H[@]}" -X POST "$A/$aid:explode" -d '{}')"
check "assignments: transfer needs toUserId" 422 "$(code -b "$JAR" "${H[@]}" -X POST "$A/$bid:transferOwnership" -d '{}')"

# Tidy up what can go: the owner stays, which is the point of the guard.
check "assignments: cleanup member" 204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$A/$aid")"
rm -f "$JAR2"
