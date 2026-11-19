# Releasing Anur

Two apps come from one code:

- **Anur**: the signed release people install. Bundle id `ai.heyanur.anur-desktop`, data in `~/Library/Application Support/Anur Desktop`. Updates itself from the feed below.
- **Anur Dev**: what `pnpm dev` runs and `pnpm package` builds (unsigned, `dist/`). Bundle id `ai.heyanur.anur-desktop.dev`, data in `~/Library/Application Support/Anur Dev`. Never updates itself.

Only the name, data folder, bundle id and updates differ. Both share folder locks, so they can't both open one folder.

## Cutting a release

Releases happen only when someone runs the release command; a commit or a merge never releases. From a clean checkout at `origin/main`:

```bash
git checkout --detach origin/main
pnpm --filter @anur/desktop release 0.1.0
```

It runs the checks, builds a universal app (Apple silicon and Intel), signs it with the Developer ID (team D3YY6RV4C3), notarises and staples the app and the DMG, uploads them and `latest-mac.yml` to S3, tags `v0.1.0` and makes a GitHub release with the changes since the last tag.

Once per Mac, first:

```bash
xcrun notarytool store-credentials anur-notary --apple-id <Apple ID> --team-id D3YY6RV4C3
aws sso login --profile aws-anur
```

## Plugins

- `pnpm release` checks Anur's plugins first (`pnpm plugins:check`): a plugin whose code changed without a new `version` in its `manifest.json` stops the release before the long build. After the app is up, it publishes the plugins newer than the live feed (`pnpm plugins:publish`); the rest are left as they are.
- The feed is `…/plugins/index.json`, signed with the plugin key (Keychain `anur-plugin-signing`, backed up in AWS Secrets Manager as `anur/plugin-signing-key`), beside each version's file, kept for good. Installed plugins update themselves from it.
- Between releases, `pnpm plugins:publish` from main ships plugins alone.

## Where it goes

- Bucket `anur-releases` in the aws-anur account (516737685507), private; CloudFront `EVKBSGJARHF1U` reads it and serves it at `spaces.hianur.com` (DNS for hianur.com is at Hostinger: `spaces` is a CNAME to `do7t8q39ulre5.cloudfront.net`; the certificate is in ACM us-east-1). Older installs use the CloudFront address, which still works.
- `https://spaces.hianur.com/apps/Anur.dmg`: always the newest; the link to share. `…/Anur.dmg` at the root is the same file, kept for links sent before.
- `…/Anur-<version>-universal.dmg`: that version, kept.
- `…/latest-mac.yml`: the feed Anur checks on launch, every 4 hours, and on Anur → Check for Updates…. With Install updates automatically on (the default, in Settings → General), updates download quietly, a card offers Restart, and an update not restarted for installs on quit; off, Anur says one is available and downloads when asked. Anur never restarts by itself.

## The website

- `site/` is the page at `https://spaces.hianur.com`: one `index.html`, the app icon and a favicon, with colours from `brand/tokens.css`. It has no analytics or cookies, and CloudFront and S3 keep no access logs, so "We don't collect any data" stays true; keep it that way.
- `pnpm site:publish` uploads it to the same bucket and clears the cache. CloudFront serves `index.html` for `/`.
