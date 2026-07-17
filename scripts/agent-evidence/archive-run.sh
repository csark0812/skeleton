#!/usr/bin/env bash
# Archive a compare out-dir into agent-suites/evidence/runs/<stamp>-run-NNN/
# Usage: scripts/agent-evidence/archive-run.sh <out-dir> [run-number]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-}"
NUM="${2:-}"
if [[ -z "$OUT" || ! -f "$OUT/compare-report.json" ]]; then
	echo "usage: $0 <compare-out-dir> [run-number]" >&2
	echo "  compare-out-dir must contain compare-report.json" >&2
	exit 1
fi
if [[ -z "$NUM" ]]; then
	existing="$(find "$ROOT/agent-suites/evidence/runs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
	NUM=$((existing + 1))
fi
ID="$(date +%Y-%m-%d)-run-$(printf '%03d' "$NUM")"
DEST="$ROOT/agent-suites/evidence/runs/$ID"
mkdir -p "$DEST"
cp "$OUT/compare-report.json" "$DEST/"
cp "$OUT"/*.suite-report.json "$DEST/" 2>/dev/null || true
echo "archived -> $DEST"
echo "next: bun run agent:evidence:aggregate"
