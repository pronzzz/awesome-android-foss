#!/usr/bin/env node
'use strict';

// Add one app by hand, using the same checks as the discovery bot:
//
//   npm run add -- owner/repo
//   npm run add -- owner/repo --category music --name "Cool Player"
//   npm run add -- owner/repo --force      skip the "is it an Android app" check
//
// Writes data/apps.yml + data/metadata.json + the icon, then rebuilds README.md.

const gh = require('./lib/github');
const { key, loadApps, loadExcluded, loadCategories, loadMetadata, saveApps, saveMetadata } = require('./lib/data');
const { evaluate, prefilter } = require('./discover');

const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
    const valueFlags = new Set(['--category', '--name']);
    const input = args.find((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));
    const fullName = input && input.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/+$/g, '');
    if (!fullName || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
        console.error('Usage: npm run add -- owner/repo [--category id] [--name "Name"] [--force]');
        process.exit(2);
    }
    const categories = loadCategories();
    const category = opt('--category');
    if (category && !categories.some((c) => c.id === category)) {
        console.error(`Unknown category "${category}". Valid: ${categories.map((c) => c.id).join(', ')}`);
        process.exit(2);
    }

    const repo = await gh.getRepo(fullName);
    if (!repo) throw new Error(`Repository ${fullName} not found`);
    const apps = loadApps();
    const metadata = loadMetadata();
    const excluded = loadExcluded();
    const known = {
        ids: new Set([...Object.values(metadata).map((m) => m.id), ...excluded.map((e) => e.id)].filter(Boolean)),
        names: new Set([...apps.map(key), ...excluded.map((e) => e.repo.toLowerCase())]),
    };
    const reason = prefilter({ ...repo, stargazers_count: Infinity }, known);
    if (reason && !args.includes('--force')) throw new Error(`${repo.full_name} rejected: ${reason} (use --force to override)`);

    const res = await evaluate(repo, { categories, category, name: opt('--name'), force: args.includes('--force') });
    if (!res.ok) throw new Error(`${repo.full_name} rejected: ${res.reason} (use --force to override)`);

    apps.push(res.entry);
    metadata[key(res.entry)] = res.meta;
    saveApps(apps, categories);
    saveMetadata(metadata);
    console.log(`Added "${res.entry.name}" to ${res.entry.category} (icon: ${res.meta.iconKind}).`);
    console.log('Review the entry in data/apps.yml (name, category, description), then run `npm run build`.');
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
