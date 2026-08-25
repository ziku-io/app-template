# contacts module — sourced by ./smoke.sh, which provides check(), code(), $BASE, $JAR, $H
C="$BASE/api/v1/contacts"
new_contact='{"entityType":"smoke","entityId":"'"$RUN"'","name":"Ada Lovelace","email":"ada@example.com","role":"Billing"}'
second_contact='{"entityType":"smoke","entityId":"'"$RUN"'","name":"Grace Hopper","email":"grace@example.com"}'
blank_name='{"entityType":"smoke","entityId":"'"$RUN"'","name":""}'
bad_email='{"entityType":"smoke","entityId":"'"$RUN"'","name":"Nope","email":"not-an-email"}'
unknown_field='{"entityType":"smoke","entityId":"'"$RUN"'","name":"Nope","isPrimary":true}'

check "contacts: needs auth"      401 "$(code "$C")"
check "contacts: create"          201 "$(code -b "$JAR" "${H[@]}" -X POST "$C" -d "$new_contact")"
check "contacts: create second"   201 "$(code -b "$JAR" "${H[@]}" -X POST "$C" -d "$second_contact")"
# Negative space: each of these must be refused, not quietly accepted.
check "contacts: blank name"      422 "$(code -b "$JAR" "${H[@]}" -X POST "$C" -d "$blank_name")"
check "contacts: bad email"       422 "$(code -b "$JAR" "${H[@]}" -X POST "$C" -d "$bad_email")"
check "contacts: unknown field"   422 "$(code -b "$JAR" "${H[@]}" -X POST "$C" -d "$unknown_field")"
check "contacts: unknown sort"    400 "$(code -b "$JAR" "$C?sort_by=nope")"
check "contacts: unknown filter"  400 "$(code -b "$JAR" "$C?filter=nope:1")"

check "contacts: list"            200 "$(code -b "$JAR" "$C?entityType=smoke&entityId=$RUN")"
check "contacts: search"          200 "$(code -b "$JAR" "$C?q=lovelace")"
check "contacts: filter role"     200 "$(code -b "$JAR" "$C?role=Billing")"
check "contacts: sort"            200 "$(code -b "$JAR" "$C?sort_by=-name")"

cid=$(curl -s -b "$JAR" "$C?entityType=smoke&entityId=$RUN&q=Lovelace" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
cid2=$(curl -s -b "$JAR" "$C?entityType=smoke&entityId=$RUN&q=Hopper" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)

check "contacts: get one"         200 "$(code -b "$JAR" "$C/$cid")"
check "contacts: patch"           200 "$(code -b "$JAR" "${H[@]}" -X PATCH "$C/$cid" -d '{"phone":"+44 20 7946 0000"}')"
check "contacts: makePrimary"     200 "$(code -b "$JAR" "${H[@]}" -X POST "$C/$cid:makePrimary")"
# Only one primary per entity: promoting the second demotes the first rather
# than tripping the partial unique index.
check "contacts: reprimary"       200 "$(code -b "$JAR" "${H[@]}" -X POST "$C/$cid2:makePrimary")"
check "contacts: unknown action"  404 "$(code -b "$JAR" "${H[@]}" -X POST "$C/$cid:explode")"

check "contacts: delete"          204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$C/$cid")"
check "contacts: gone"            404 "$(code -b "$JAR" "${H[@]}" -X DELETE "$C/$cid")"
check "contacts: patch deleted"   404 "$(code -b "$JAR" "${H[@]}" -X PATCH "$C/$cid" -d '{"phone":"x"}')"
check "contacts: restore"         200 "$(code -b "$JAR" "${H[@]}" -X POST "$C/$cid:restore")"
check "contacts: delete again"    204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$C/$cid")"
check "contacts: delete second"   204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$C/$cid2")"
