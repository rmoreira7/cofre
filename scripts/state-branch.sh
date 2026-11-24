#!/usr/bin/env bash
# The watcher's encrypted state (state.enc) lives alone on the watch-state branch, as one commit that is replaced on
# every change (no history to grow). Used by the watch and taps workflows:
#   scripts/state-branch.sh pull   → state/state.enc (absent on the first run)
#   scripts/state-branch.sh push   → replaces the branch when state/state.enc changed
# Needs GITHUB_TOKEN (contents: write) and GITHUB_REPOSITORY, as Actions provides them.
set -euo pipefail
BRANCH=watch-state
AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)"
URL="https://github.com/$GITHUB_REPOSITORY"
mkdir -p state
case "${1:-}" in
  pull)
    if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
      git fetch -q --depth=1 origin "$BRANCH"
      git show FETCH_HEAD:state.enc > state/state.enc
      sha256sum state/state.enc | cut -d' ' -f1 > state/.pulled
    fi ;;
  push)
    [ -f state/state.enc ] || exit 0
    now=$(sha256sum state/state.enc | cut -d' ' -f1)
    [ -f state/.pulled ] && [ "$now" = "$(cat state/.pulled)" ] && { echo "state unchanged"; exit 0; }
    tmp=$(mktemp -d); cp state/state.enc "$tmp/"
    cd "$tmp" && git init -q -b "$BRANCH" && git add state.enc
    git -c user.name="cofre-watch" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -qm "watcher state"
    git -c http.extraHeader="$AUTH" push -qf "$URL" "$BRANCH"
    echo "state saved" ;;
  *) echo "usage: $0 pull|push" >&2; exit 2 ;;
esac
