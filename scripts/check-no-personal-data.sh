#!/usr/bin/env bash
# Fails if the tree contains anything that looks like personal financial data.
# Two layers:
#   1. Generic patterns (always): CPF, CNPJ, UUID-like IDs, emails, formatted BRL amounts >= R$ 1.000.
#   2. A private denylist (names, IDs, keys) passed with DENYLIST=<path>. It lives OUTSIDE this repo
#      and is never committed. CI runs layer 1 only; the local pre-push hook runs both.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mapfile -d '' files < <(git ls-files -z -co --exclude-standard)
self="scripts/check-no-personal-data.sh"
targets=()
for f in "${files[@]}"; do [[ "$f" == "$self" || ! -f "$f" ]] || targets+=("$f"); done
[[ ${#targets[@]} -gt 0 ]] || { echo "leak gate: nothing to scan"; exit 0; }

fail=0
check() {
  local label=$1; shift
  local hits
  hits=$(grep -nIE "$@" -- "${targets[@]}" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo "✗ $label"
    echo "$hits" | cut -c1-160 | sed 's/^/    /'
    fail=1
  fi
}

check "CPF"                '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'
check "CNPJ"               '[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}'
check "UUID-like id"       '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
check "email"              '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
check "BRL amount ≥ 1.000" 'R\$ ?[0-9]{1,3}(\.[0-9]{3})+'

if [[ -n "${DENYLIST:-}" ]]; then
  [[ -r "$DENYLIST" ]] || { echo "✗ DENYLIST set but not readable: $DENYLIST"; exit 2; }
  hits=$(grep -nIiF -f <(grep -v '^\s*\(#\|$\)' "$DENYLIST") -- "${targets[@]}" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo "✗ private denylist ($(echo "$hits" | wc -l) line(s)). Matched lines withheld; run locally to inspect:"
    echo "$hits" | cut -d: -f1,2 | sed 's/^/    /'
    fail=1
  fi
  layer="generic + denylist"
else
  layer="generic only"
fi

if [[ $fail -eq 0 ]]; then echo "✓ leak gate clean (${#targets[@]} files, $layer)"; fi
exit $fail
