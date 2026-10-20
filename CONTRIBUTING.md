# Contributing

Thanks for helping grow the list! It focuses on **free and open source**, **privacy-respecting** Android apps that people can actually install and use.

## What belongs here

An app is a good fit when it:

1. **Is open source** under an [OSI-approved license](https://opensource.org/licenses/). "Source available" or unlicensed repos are rejected.
2. **Is an Android app** you can install: it ships an APK via F-Droid, IzzyOnDroid or GitHub Releases. Libraries, SDKs, plugins, sample projects, desktop tools and other lists don't belong here.
3. **Respects its users:** no ads, no trackers, no proprietary analytics.
4. **Is maintained:** it has had commits in the last year (older classics are fine, and get a 💤 marker).
5. **Is safe for work.**

## Suggest an app (no code)

[Open an app suggestion](https://github.com/pronzzz/awesome-android-foss/issues/new?template=app-suggestion.yml) with the repository link. That's it.

## Add an app yourself

**Do not edit `README.md`.** It is generated from [`data/apps.yml`](data/apps.yml), and CI rejects hand edits.

### Option A: edit the YAML (works from the GitHub web editor)

Add an entry anywhere in [`data/apps.yml`](data/apps.yml):

```yaml
- name: NetGuard
  repo: M66B/NetGuard
  category: privacy
  description: Block internet access per app without root, with optional traffic logging.
```

- `category` must be one of the ids in [`data/categories.yml`](data/categories.yml).
- `description` is one sentence of 160 characters or fewer, ending with a full stop. Say what the app does, not that it is "open source" or "privacy-friendly". Everything here is.
- Optional fields: `homepage`, `fdroid` (package id, if detection gets it wrong), `license` (if GitHub can't detect it) and `icon` (an image URL or `assets/…` path, if the automatic icon is wrong).

You don't need to add an icon, stars or install links. After your PR is merged, the update workflow fills those in and rebuilds the README.

### Option B: use the helper script

```bash
npm ci
GITHUB_TOKEN=<token> npm run add -- owner/repo --category music
npm run build
```

`npm run add` runs the same checks as the discovery bot (license, Android app detection, duplicates), picks a category, fetches the icon and writes the entry. Review the generated name and description in `data/apps.yml` before committing.

### Before opening the PR

```bash
npm run validate   # schema, duplicates, categories
npm test
```

## Removing an app

If an app is abandoned, turned proprietary, or added by mistake, move it from `data/apps.yml` to [`data/excluded.yml`](data/excluded.yml) with a short `reason`. That stops the discovery bot from re-adding it.

## Fixing a wrong icon or category

- **Category:** change `category:` on the entry.
- **Icon:** set `icon:` to a better image URL, or commit a square PNG under `assets/overrides/` and point `icon:` at it.

## Code of Conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
