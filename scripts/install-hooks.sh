#!/usr/bin/env bash
# Installs a pre-push hook that runs the leak gate with the private denylist.
# Usage: DENYLIST=/path/outside/repo/denylist.txt scripts/install-hooks.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${DENYLIST:?set DENYLIST to the private denylist path (outside this repo)}"
[[ -r "$DENYLIST" ]] || { echo "not readable: $DENYLIST"; exit 1; }
case "$(realpath "$DENYLIST")" in "$(pwd)"/*) echo "the denylist must live OUTSIDE the repo"; exit 1;; esac
cat > .git/hooks/pre-push <<EOF
#!/usr/bin/env bash
DENYLIST="$(realpath "$DENYLIST")" exec "\$(git rev-parse --show-toplevel)/scripts/check-no-personal-data.sh"
EOF
chmod +x .git/hooks/pre-push
echo "pre-push hook installed (denylist: $(realpath "$DENYLIST"))"
