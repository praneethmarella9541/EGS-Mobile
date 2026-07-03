#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=resolve-java.sh
source "$ROOT/scripts/resolve-java.sh"

PROFILE="${1:-production}"
PLATFORM="${2:-android}"

resolve_java_home || exit 1
echo "Using JAVA_HOME=$JAVA_HOME"
java -version

cd "$ROOT"
exec npx eas-cli build --platform "$PLATFORM" --profile "$PROFILE" --local "${@:3}"
