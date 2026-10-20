'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.join(__dirname, '..', '..');
const P = {
    root: ROOT,
    apps: path.join(ROOT, 'data/apps.yml'),
    excluded: path.join(ROOT, 'data/excluded.yml'),
    categories: path.join(ROOT, 'data/categories.yml'),
    metadata: path.join(ROOT, 'data/metadata.json'),
    stats: path.join(ROOT, 'data/stats.json'),
    icons: path.join(ROOT, 'assets/icons'),
    readme: path.join(ROOT, 'README.md'),
    template: path.join(ROOT, 'templates/README.template.md'),
};

const APPS_HEADER = `# The list. One entry per app; the README is generated from this file.
#
#   repo:        GitHub "owner/name" (required unless \`source\` is given)
#   source:      Source URL for apps not hosted on GitHub
#   category:    One of the ids in data/categories.yml
#   name:        Display name (default: detected app name or repo name)
#   description: One-line summary (default: cleaned GitHub description)
#   homepage:    Project website
#   fdroid:      Package id, if auto-detection gets it wrong
#   license:     SPDX id, if GitHub cannot detect it (e.g. dual-licensed)
#   icon:        Image URL or assets/ path, if auto-detection picks a bad icon
#   added:       Date the app joined the list
#
# Run \`npm run build\` after editing. See CONTRIBUTING.md.
`;

const EXCLUDED_HEADER = `# Repositories the discovery bot must never add (libraries, lists,
# duplicates, non-apps, or apps that were reviewed and rejected).
# Add an entry here instead of just deleting an app from apps.yml.
`;

const readYaml = (file, fallback) => (fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) || fallback : fallback);
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

const key = (app) => (app.repo || app.source).toLowerCase();

const loadApps = () => readYaml(P.apps, []);
const loadExcluded = () => readYaml(P.excluded, []);
const loadCategories = () => readYaml(P.categories, []);
const loadMetadata = () => readJson(P.metadata, {});

const FIELD_ORDER = ['name', 'repo', 'source', 'category', 'description', 'homepage', 'fdroid', 'license', 'icon', 'added'];

function saveApps(apps, categories = loadCategories()) {
    const order = new Map(categories.map((c, i) => [c.id, i]));
    const sorted = [...apps].sort((a, b) =>
        (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || key(a).localeCompare(key(b)));
    const clean = sorted.map((a) => {
        const o = {};
        for (const f of FIELD_ORDER) if (a[f] != null && a[f] !== '') o[f] = a[f];
        return o;
    });
    fs.writeFileSync(P.apps, APPS_HEADER + '\n' + YAML.stringify(clean, { lineWidth: 0 }).replace(/\n- /g, '\n\n- '));
}

function saveExcluded(list) {
    const sorted = [...list].sort((a, b) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase()));
    fs.writeFileSync(P.excluded, EXCLUDED_HEADER + '\n' + YAML.stringify(sorted, { lineWidth: 0 }));
}

function saveMetadata(meta) {
    const sorted = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(P.metadata, JSON.stringify(sorted, null, 2) + '\n');
}

module.exports = { P, key, loadApps, loadExcluded, loadCategories, loadMetadata, saveApps, saveExcluded, saveMetadata };
