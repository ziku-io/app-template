# files module — sourced by ./smoke.sh
tmp=$(mktemp); echo "ziku smoke" > "$tmp"
empty=$(mktemp)
check "files: list"           200 "$(code -b "$JAR" "$BASE/api/v1/files")"
check "files: upload"         201 "$(code -b "$JAR" -H "Origin: $BASE" -X POST "$BASE/api/v1/files" -F "file=@$tmp")"
# negative space: the guards must fire
check "files: reject empty"   422 "$(code -b "$JAR" -H "Origin: $BASE" -X POST "$BASE/api/v1/files" -F "file=@$empty")"
check "files: reject no file" 422 "$(code -b "$JAR" -H "Origin: $BASE" -X POST "$BASE/api/v1/files" -F "notafile=x")"
check "files: reject sort"    400 "$(code -b "$JAR" "$BASE/api/v1/files?sort_by=secret")"
check "files: reject filter"  400 "$(code -b "$JAR" "$BASE/api/v1/files?filter=secret:1")"
check "files: reject cursor"  400 "$(code -b "$JAR" "$BASE/api/v1/files?pageToken=notatoken")"
fid=$(curl -s -b "$JAR" "$BASE/api/v1/files" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "files: download"       200 "$(code -b "$JAR" "$BASE/api/v1/files/$fid/content")"
check "files: delete"         204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/v1/files/$fid")"
check "files: hidden"         404 "$(code -b "$JAR" "$BASE/api/v1/files/$fid/content")"
check "files: restore"        200 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/files/$fid:restore")"
check "files: back"           200 "$(code -b "$JAR" "$BASE/api/v1/files/$fid/content")"
check "files: bad action"     404 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/files/$fid:explode")"
rm -f "$tmp" "$empty"
