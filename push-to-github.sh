#!/bin/bash
# Run this once from the Replit shell to push to GitHub
# Make sure GITHUB_PERSONAL_ACCESS_TOKEN is set in your secrets

REPO="https://anjani-sharma:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/anjani-sharma/dukan.git"

git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git push -u origin main

echo ""
echo "Done! Your code is now on GitHub."
echo "You can now connect this repo to Render and Vercel."
