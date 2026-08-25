# folders module — sourced by ./smoke.sh, which provides check(), code(), $BASE, $JAR, $H
folders_url="$BASE/api/v1/folders"
f_id_of() { sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1; }
# Sibling names are unique among live rows, so a rerun needs fresh names.
suffix="$RANDOM"

f_new() { # f_new <name> [parentId]
  if [ -n "${2:-}" ]; then printf '{"name":"%s","parentId":"%s"}' "$1" "$2"
  else printf '{"name":"%s"}' "$1"; fi
}

check "folders: needs auth"      401 "$(code "$folders_url")"
check "folders: list"            200 "$(code -b "$JAR" "$folders_url")"
check "folders: root filter"     200 "$(code -b "$JAR" "$folders_url?parentId=root")"
check "folders: bad parentId"    400 "$(code -b "$JAR" "$folders_url?parentId=not-a-folder")"
check "folders: unknown sort_by" 400 "$(code -b "$JAR" "$folders_url?sort_by=secret")"
check "folders: blank name"      422 "$(code -b "$JAR" "${H[@]}" -X POST "$folders_url" -d '{"name":""}')"
check "folders: unknown field"   422 "$(code -b "$JAR" "${H[@]}" -X POST "$folders_url" -d '{"name":"x","colour":"red"}')"
check "folders: missing parent"  422 "$(code -b "$JAR" "${H[@]}" -X POST "$folders_url" \
  -d '{"name":"Orphan","parentId":"00000000-0000-0000-0000-000000000000"}')"

a=$(curl -s -b "$JAR" "${H[@]}" -X POST "$folders_url" -d "$(f_new "smoke-a-$suffix")" | f_id_of)
b=$(curl -s -b "$JAR" "${H[@]}" -X POST "$folders_url" -d "$(f_new "smoke-b-$suffix" "$a")" | f_id_of)
c=$(curl -s -b "$JAR" "${H[@]}" -X POST "$folders_url" -d "$(f_new "smoke-c-$suffix" "$b")" | f_id_of)
check "folders: created tree"    201 "$(code -b "$JAR" "${H[@]}" -X POST "$folders_url" -d "$(f_new "smoke-d-$suffix" "$c")")"
check "folders: duplicate name"  409 "$(code -b "$JAR" "${H[@]}" -X POST "$folders_url" -d "$(f_new "smoke-b-$suffix" "$a")")"

check "folders: get"             200 "$(code -b "$JAR" "$folders_url/$a")"
check "folders: tree"            200 "$(code -b "$JAR" "$folders_url/$a/tree")"
check "folders: rename"          200 "$(code -b "$JAR" "${H[@]}" -X PATCH "$folders_url/$c" -d "$(f_new "smoke-c2-$suffix")")"
check "folders: self parent"     409 "$(code -b "$JAR" "${H[@]}" -X PATCH "$folders_url/$a" \
  -d "$(printf '{"parentId":"%s"}' "$a")")"
# The important one: a → b → c, so moving a into c would close a cycle.
check "folders: cycle move"      409 "$(code -b "$JAR" "${H[@]}" -X PATCH "$folders_url/$a" \
  -d "$(printf '{"parentId":"%s"}' "$c")")"
check "folders: move to root"    200 "$(code -b "$JAR" "${H[@]}" -X PATCH "$folders_url/$c" -d '{"parentId":null}')"
check "folders: move back"       200 "$(code -b "$JAR" "${H[@]}" -X PATCH "$folders_url/$c" \
  -d "$(printf '{"parentId":"%s"}' "$b")")"

check "folders: delete blocked"  409 "$(code -b "$JAR" "${H[@]}" -X DELETE "$folders_url/$a")"
check "folders: delete leaf"     204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$folders_url/$c?force=true")"
check "folders: force delete"    204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$folders_url/$a?force=true")"
check "folders: gone"            404 "$(code -b "$JAR" "${H[@]}" -X DELETE "$folders_url/$a")"
check "folders: tree gone"       404 "$(code -b "$JAR" "$folders_url/$a/tree")"
check "folders: restore"         200 "$(code -b "$JAR" "${H[@]}" -X POST "$folders_url/$a:restore" -d '{}')"
# b is still deleted, so restoring c would hang it under a deleted parent.
check "folders: restore order"   409 "$(code -b "$JAR" "${H[@]}" -X POST "$folders_url/$c:restore" -d '{}')"
