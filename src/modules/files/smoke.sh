# files module — sourced by ./smoke.sh, which provides check(), code(), $BASE, $JAR, $H
tmp=$(mktemp); echo "ziku smoke" > "$tmp"
check "files: list"     200 "$(code -b "$JAR" "$BASE/api/files")"
check "files: upload"   201 "$(code -b "$JAR" -H "Origin: $BASE" -X POST "$BASE/api/files" -F "file=@$tmp")"
fid=$(curl -s -b "$JAR" "$BASE/api/files" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "files: download" 200 "$(code -b "$JAR" "$BASE/api/files/$fid/download")"
check "files: delete"   204 "$(code -b "$JAR" "${H[@]}" -X DELETE "$BASE/api/files/$fid")"
check "files: gone"     404 "$(code -b "$JAR" "$BASE/api/files/$fid/download")"
rm -f "$tmp"
