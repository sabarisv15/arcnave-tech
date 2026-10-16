#!/bin/bash
# Per-step gates on each commit, sequentially, in the step0 worktree (own database).
# Usage: edit WT (a scratch worktree with hardlinked node_modules) and the step list, then run it.
# Writes one file per step to $OUT: snapshot diff size, tsc, generation.ts and runTurn line counts, suite.
WT=/tmp/claude-0/-home-user-arcnave-tech/594f6b4c-41ed-5734-88e2-925619eabbdd/scratchpad/wt-step0
OUT=/tmp/claude-0/gates
mkdir -p $OUT
STEP0=b448929
for pair in "0:b448929" "1:d2ed7fc" "2:afd0895" "3:fbbb051" "4:3ea1e73" "5:25c26ba" "6:8524b64"; do
  n=${pair%%:*}; sha=${pair##*:}
  f=$OUT/step$n.txt
  git -C $WT checkout -q --detach $sha
  {
    echo "## step $n $sha"
    echo "\$ git log -1 --oneline"; git -C $WT log -1 --oneline
    echo "\$ git diff $STEP0 $sha -- '*.snap' | wc -c"; git -C $WT diff $STEP0 $sha -- '*.snap' | wc -c
    echo "\$ npx tsc --noEmit"; (cd $WT/backend && npx tsc --noEmit -p . 2>&1; echo "exit $?")
    echo "\$ wc -l src/services/generation.ts"; (cd $WT/backend && wc -l src/services/generation.ts)
    echo "\$ runTurn lines"; (cd $WT/backend && awk '/private async \*runTurn/{s=NR} s&&/^  }$/{print s"-"NR" = "NR-s+1" lines"; exit}' src/services/generation.ts)
    echo "\$ npx vitest run"; (cd $WT/backend && TEST_DATABASE_URL=postgres://arcnave:arcnave@localhost:5432/arcnave_test_step0 npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL|Duration"; echo "exit ${PIPESTATUS[0]}")
  } > $f 2>&1
done
echo ALL_DONE > $OUT/done
