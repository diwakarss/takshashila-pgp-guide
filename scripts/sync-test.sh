#!/bin/zsh
# End-to-end weekly-delivery test against a RUNNING app (isolated data dir —
# never the real brain). Builds a fake corpus origin, starts the app with the
# PGP_DEV_SYNCTEST probe, lands "this week's classes" on origin while the app
# is up, and expects the probe to pull + import only the delta.
#
#   scripts/sync-test.sh [path-to-new-class.md ...]
#
# With no args, a small built-in fixture plays the new class.
set -e
cd "$(dirname "$0")/.."

TMP=$(mktemp -d /tmp/pgp-synctest-XXXXXX)
ORIGIN="$TMP/origin.git"
CLONE="$TMP/clone"
DATA="$TMP/userdata"
mkdir -p "$DATA"

git init -q --bare "$ORIGIN"
git clone -q "$ORIGIN" "$TMP/seed"
mkdir -p "$TMP/seed/pgp"
cat > "$TMP/seed/pgp/baseline-1.md" <<'EOF'
---
type: study-notes
course: "PP231: Microeconomics I"
title: Baseline Class (Part 1/1)
---

## TL;DR

Demand slopes down; supply slopes up. The baseline week.
EOF
git -C "$TMP/seed" add -A && git -C "$TMP/seed" -c user.email=t@t -c user.name=t commit -qm baseline && git -C "$TMP/seed" push -q
git clone -q "$ORIGIN" "$CLONE"

echo "[driver] starting app (probe does baseline import, then waits)…"
PGP_USERDATA="$DATA" PGP_CORPUS_DIR="$CLONE/pgp" PGP_DEV_SYNCTEST=1 \
  PGP_SYNC_EXPECT="${PGP_SYNC_EXPECT:-comparative advantage}" \
  PGP_SYNC_NEWSLUG="${PGP_SYNC_NEWSLUG:-new-class}" \
  npm run dev > "$TMP/app.log" 2>&1 &
APP=$!

# Wait for the probe's baseline-done signal, then land the new week on origin.
for i in {1..120}; do [ -f "$DATA/synctest/ready" ] && break; sleep 1; done
[ -f "$DATA/synctest/ready" ] || { echo "[driver] app never got ready"; tail -30 "$TMP/app.log"; kill $APP; exit 1; }
echo "[driver] baseline imported ($(cat "$DATA/synctest/ready") pages) — landing new classes on origin…"

if [ $# -gt 0 ]; then
  cp "$@" "$TMP/seed/pgp/"
else
  cat > "$TMP/seed/pgp/new-class-1.md" <<'EOF'
---
type: study-notes
course: "PP231: Microeconomics I"
title: Trade (Part 1/1)
---

## TL;DR

Comparative advantage: countries gain by trading what they produce at the
lowest opportunity cost. The new week's class.
EOF
fi
git -C "$TMP/seed" add -A && git -C "$TMP/seed" -c user.email=t@t -c user.name=t commit -qm "week: new classes" && git -C "$TMP/seed" push -q
touch "$DATA/synctest/pushed"

wait $APP || true
echo "--- probe output ---"
grep "\[sync\]" "$TMP/app.log" || tail -30 "$TMP/app.log"
grep -q "PASS ✓" "$TMP/app.log" && { echo "[driver] SYNC TEST PASSED"; rm -rf "$TMP"; } || { echo "[driver] SYNC TEST FAILED — log: $TMP/app.log"; exit 1; }
