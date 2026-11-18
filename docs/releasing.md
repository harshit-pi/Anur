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

## Where it goes

- Bucket `anur-releases` in the aws-anur account (516737685507), private; CloudFront `EVKBSGJARHF1U` reads it.
- `https://do7t8q39ulre5.cloudfront.net/Anur.dmg`: always the newest; the link to share.
- `…/Anur-<version>-universal.dmg`: that version, kept.
- `…/latest-mac.yml`: the feed Anur checks on launch and every 4 hours. Updates download quietly; a card offers Restart, and an update not restarted for installs on quit.
