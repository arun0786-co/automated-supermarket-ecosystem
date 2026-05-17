#!/bin/bash
# rewrites git commit messages to remove the conventional commit prefixes (feat:, chore: etc)
# run from the project root after cloning

set -e

FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter '
sed \
  -e "s/^chore: add Stage B docker-compose scaffold and Stage C hardware docs$/added stage B docker setup and stage C hardware notes/" \
  -e "s/^feat(stage-a): Flutter mobile app scaffold$/flutter app done - cart, wallet and home screens/" \
  -e "s/^feat(stage-a): Next.js web dashboard$/dashboard working - store map, scan feed, ledger, wallet cards/" \
  -e "s/^feat(stage-a): backend API simulator with trolley engine$/backend sim - trolley engine, product catalog, mock blockchain/" \
  -e "s/^docs: add architecture diagrams, API reference, and roadmap$/architecture docs, api reference and roadmap/" \
  -e "s/^init: project skeleton and spec PDF$/initial commit/"
' -- abd8962..HEAD

echo "done. run: git log --oneline to verify"
