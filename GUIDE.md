# 📘 The Guide to Awesome Android UI Fun

Welcome to the detailed guide for maintaining and using this repository. This isn't just a list; it's a curated experience.

## 🏗️ Project Structure

- **`README.md`**: The storefront. Uses HTML tables for grid layout and TypingSVG for the header.
- **`data/stats.json`**: Powers the "Apps | 50+" badge. Update this manually when adding apps.
- **`scripts/discover.js`**: A Node.js bot that hunts for new Android apps on GitHub.
- **`.github/workflows/`**: The engine room.
    - `snake.yml`: Generates the contribution graph animation.
    - `lint.yml`: Enforces "Awesome List" standards.
    - `discover.yml`: runs the discovery bot monthly.

## 🤖 Automation Explained

### 1. The Snake 🐍
Every 24 hours, `snake.yml` eats your commit history and poops out a beautiful SVG animation into the `dist` branch. This is displayed at the bottom of the README.

### 2. The Discovery Bot 🕵️
On the **1st of every month**, `discover.yml` wakes up `scripts/discover.js`.
1. It searches GitHub for repositories with topics `android` AND `open-source`.
2. It filters for apps with >50 stars and recent activity.
3. It generates a `DISCOVERIES.md` file.
4. It creates a **Pull Request** titled "🕵️ Monthly App Discoveries".

**Your Job:** Review the PR. If you see a cool app, manually add it to `README.md` following the grid layout rules in `CONTRIBUTING.md`.

## 🎨 Design Guide

### Adding GIFs
To keep the "fun" vibe, we use GIFs.
- **Source**: Use uncopyrighted or open-license GIFs (e.g., from Giphy with attribution if needed, or custom made).
- **Placement**: Don't clutter. Use them to break up sections or as headers.

### The Grid
We use HTML tables because Markdown lacks a grid system.
**ALWAYS** use the template in `CONTRIBUTING.md`. If you break the table, the layout will look terrible on mobile.

## 🚀 How to Promote

1. **Submit to Awesome Lists**: Send a PR to the main `sindresorhus/awesome` list (after you have more stars/content).
2. **Reddit**: Post on r/androidapps, r/opensource, r/privacy.
3. **Twitter/X**: Share with hashtags #Android #OpenSource #FOSS.

---

*Stay Awesome.*
