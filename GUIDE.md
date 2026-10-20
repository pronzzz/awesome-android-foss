# Maintainer guide

How the list is built, how the automation works, and how to steer it.

## Layout

| Path | What it is | Edited by |
| --- | --- | --- |
| `data/apps.yml` | The list: one entry per app (name, repo, category, description). | Humans + discovery bot |
| `data/categories.yml` | Categories in display order, with emoji, blurb and auto-sort keywords. | Humans |
| `data/excluded.yml` | Repos the bot must never add, each with a reason. | Humans + refresh bot |
| `data/metadata.json` | Stars, license, package id, F-Droid/Izzy availability, icon source. | Bot only |
| `data/discovery-cache.json` | Repos already inspected and rejected (re-checked after 120 days). | Bot only |
| `data/stats.json` | Counts for badges. | Bot only |
| `assets/icons/` | Normalised 128×128 app icons, named `owner--repo.png`. | Bot only |
| `assets/overrides/` | Hand-picked icons referenced by `icon:` in apps.yml. | Humans |
| `templates/README.template.md` | Everything in the README that isn't generated. | Humans |
| `README.md` | **Generated.** Never edit directly. | `npm run build` |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run discover` | Search GitHub for new apps and append the good ones to `apps.yml`. `--max N`, `--min-stars N`, `--dry-run`. |
| `npm run refresh` | Update metadata and icons for every app. `--missing`, `--only owner/repo`, `--force-icons`, `--deep`, `--verbose`. |
| `npm run build` | Render `README.md` and `stats.json`. `--check` exits 1 if the README is stale. |
| `npm run add -- owner/repo` | Add one app with the same checks as the bot. |
| `npm run validate` | Offline schema and duplicate checks. |
| `npm test` | Unit tests for the classifier, Android detection, icon validation and README rendering. |

Scripts that call GitHub need `GITHUB_TOKEN` in the environment (`GITHUB_TOKEN=$(gh auth token) npm run refresh`).

## Automation

### Update list (`.github/workflows/update.yml`)

| Trigger | What runs |
| --- | --- |
| Sundays 03:17 UTC | discover → full refresh → build → validate/test → commit |
| Push to `main` touching data, templates or scripts | refresh of apps without metadata → build → commit |
| Manual (Actions tab) | choose discovery on/off, max apps, force icons, and **commit** vs **pull request** |

Pick **pull-request** mode if you'd rather review discoveries before they go live. Note that PRs opened with the default `GITHUB_TOKEN` don't trigger CI; the workflow already runs validation and tests before opening one.

### CI (`.github/workflows/ci.yml`)

Runs on every PR and on pushes to `main`: unit tests, data validation, awesome-lint, and a check that `README.md` wasn't hand-edited.

### Snake (`.github/workflows/snake.yml`)

Daily render of the contribution snake into the `output` branch, shown at the bottom of the README.

## How discovery decides

1. **Search.** It runs 13 GitHub searches (`topic:android-app`, `topic:fdroid`, `topic:android topic:foss`, …), each limited to ≥100 stars, a push in the last 12 months, and no archived repos or forks. The query order rotates weekly.
2. **Free filters.** It drops anything already listed or excluded, compared by **numeric repo id** so renamed or transferred repos can't be added twice. It also drops repos without an OSI license, libraries, SDKs, plugins, samples, lists and NSFW content.
3. **App check.** It reads the repo's file tree and requires a real Android application module. That covers Gradle, Kotlin Multiplatform, Flutter, React Native, Expo and Capacitor projects, and it requires the `com.android.application` plugin, a launcher icon or fastlane metadata. It also reads the package id (including `gradle.properties` and version-catalog indirection) and the app's display name.
4. **Category.** A weighted keyword classifier scores each category using topics ×3, name ×2 and description ×1, with `!keywords` counting double. Weak or ambiguous results go to *System & Utilities*. Tune it by editing `keywords` in `categories.yml`.
5. **Install links.** It queries the F-Droid and IzzyOnDroid APIs for the package id, and otherwise looks for APKs in the latest GitHub release.

## How icons are chosen

Candidates are tried in this order. Each download is decoded and checked: it must be at least 48 px, roughly square, not blank or transparent, and not a stock Android Studio/Flutter/React Native/Expo template icon (checked by perceptual hash).

1. `icon:` override in `apps.yml`
2. Fastlane / Triple-T store icon (`metadata/android/en-US/images/icon.png`)
3. F-Droid, then IzzyOnDroid, repository icon for the package id
4. `ic_launcher-playstore.png`, then the launcher icon declared in `AndroidManifest.xml` at the highest density
5. Logo/icon images in the repo (`logo.png`, `assets/icon.png`, …)
6. The organisation avatar, only when the org is clearly the app itself (e.g. `TeamNewPipe`)
7. A generated monogram (never a random person's avatar)

Accepted icons are resized to 128×128 PNG. Icons that came from a fallback are retried on every refresh, so they upgrade automatically when a better source appears.
