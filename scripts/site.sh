#!/bin/sh
# Publishes site/ to spaces.hianur.com: the bucket behind CloudFront, beside the app's files.
set -eu
cd "$(dirname "$0")/../site"
export AWS_PROFILE="${AWS_PROFILE:-aws-anur}"
aws s3 cp index.html s3://anur-releases/index.html --content-type "text/html; charset=utf-8" --cache-control "public, max-age=300"
for f in anur-icon.png favicon.png; do
  aws s3 cp "$f" "s3://anur-releases/$f" --content-type image/png --cache-control "public, max-age=86400"
done
for f in fonts/*.woff2; do
  aws s3 cp "$f" "s3://anur-releases/$f" --content-type font/woff2 --cache-control "public, max-age=31536000, immutable"
done
aws cloudfront create-invalidation --distribution-id EVKBSGJARHF1U --paths / /index.html "/fonts/*" /anur-icon.png /favicon.png >/dev/null
echo "✓ https://spaces.hianur.com"
