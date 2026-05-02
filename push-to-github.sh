#!/bin/bash
# Push to GitHub with correct author email so Vercel accepts the commits.
# Make sure GITHUB_PERSONAL_ACCESS_TOKEN is set in your Replit secrets.

REPO="https://anjani-sharma:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/anjani-sharma/dukan.git"

WRONG_EMAIL="40913131-anjanisharma11@users.noreply.replit.com"
CORRECT_EMAIL="anjani.sharma1@gmail.com"
CORRECT_NAME="Anjani Sharma"

echo "Rewriting commit author emails..."
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter "
  if [ \"\$GIT_AUTHOR_EMAIL\" = \"$WRONG_EMAIL\" ]; then
    export GIT_AUTHOR_EMAIL=\"$CORRECT_EMAIL\"
    export GIT_AUTHOR_NAME=\"$CORRECT_NAME\"
  fi
  if [ \"\$GIT_COMMITTER_EMAIL\" = \"$WRONG_EMAIL\" ]; then
    export GIT_COMMITTER_EMAIL=\"$CORRECT_EMAIL\"
    export GIT_COMMITTER_NAME=\"$CORRECT_NAME\"
  fi
" HEAD

echo "Pushing to GitHub..."
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git push -f -u origin main

echo ""
echo "Done! Code is on GitHub with author: $CORRECT_EMAIL"
echo "Vercel will now accept and deploy the commits automatically."
