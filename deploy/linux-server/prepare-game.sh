#!/bin/sh
set -eu

PIN_EXE=d3d41e614908d2befd518b27046d9822d6130ef12ba3504babbdb786bef9cff4
PIN_DXGI=9a431d7b6fd20c43fa92bebd91c3bc023ec7a3fcbc52871c41f4df293d4b0d1f
PIN_SERVER=a090e8b25044647ce409b313525501da578d632d3fcb9eb351f020ca94fa64fb

usage() {
  echo "usage: $0 --game-dir <folder containing Archon> [--repo <dauntless-revived checkout>]" >&2
  exit 2
}

game=
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
while [ "$#" -gt 0 ]; do
  case "$1" in
    --game-dir) [ "$#" -ge 2 ] || usage; game=$2; shift 2 ;;
    --repo) [ "$#" -ge 2 ] || usage; repo=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$game" ] || usage

win64="$game/Archon/Binaries/Win64"
exe="$win64/Dauntless-Win64-Shipping.exe"
[ -f "$exe" ] || { echo "game executable not found: $exe" >&2; exit 1; }

hash_file() {
  sha256sum "$1" | awk '{print $1}'
}

[ "$(hash_file "$exe")" = "$PIN_EXE" ] || {
  echo "refusing game build: Dauntless-Win64-Shipping.exe is not pinned 1.4.4" >&2
  exit 1
}

for spec in "dxgi.dll:$PIN_DXGI" "UndauntedInternalServer.dll:$PIN_SERVER"; do
  file=${spec%%:*}
  expected=${spec#*:}
  source="$repo/UndauntedLauncher/assets/$file"
  target="$win64/$file"
  [ -f "$source" ] || { echo "missing pinned asset: $source" >&2; exit 1; }
  [ "$(hash_file "$source")" = "$expected" ] || { echo "repo asset failed pin: $file" >&2; exit 1; }
  if [ ! -f "$target" ] || [ "$(hash_file "$target")" != "$expected" ]; then
    tmp="$target.dr-new"
    cp "$source" "$tmp"
    [ "$(hash_file "$tmp")" = "$expected" ] || { rm -f "$tmp"; echo "copy failed hash check: $file" >&2; exit 1; }
    mv "$tmp" "$target"
  fi
done

echo "game ready for Wine server launch: $game"
