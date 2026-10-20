#!/usr/bin/env node
'use strict';

// Refreshes data/metadata.json for every app in data/apps.yml:
// stars, license, activity, canonical repo name (renames/transfers are
// written back to apps.yml), F-Droid/IzzyOnDroid availability and icons.
//
//   node scripts/refresh.js                 refresh everything
//   node scripts/refresh.js --missing       only apps without metadata (fast, used on push)
//   node scripts/refresh.js --only a/b,c/d  only these repos
//   node scripts/refresh.js --force-icons   re-resolve every icon
//   node scripts/refresh.js --deep          re-inspect repos (package id, app name)

const fs = require('fs');
const path = require('path');
const { P, key, loadApps, loadExcluded, loadMetadata, saveApps, saveExcluded, saveMetadata } = require('./lib/data');
const { enrichApp } = require('./lib/enrich');
const gh = require('./lib/github');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

async function pool(items, size, fn) {
    const queue = items.map((item, i) => [item, i]);
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
        while (queue.length) {
            const [item, i] = queue.shift();
            await fn(item, i);
        }
    }));
}

async function main() {
    if (!gh.hasToken) console.warn('⚠ No GITHUB_TOKEN set: limited to 60 API requests/hour.');
    const apps = loadApps();
    const excluded = loadExcluded();
    const prevMeta = loadMetadata();
    const only = opt('--only') ? new Set(opt('--only').toLowerCase().split(',')) : null;

    const todo = apps.filter((a) => {
        if (only) return only.has(key(a));
        if (flag('--missing')) return !prevMeta[key(a)] || !prevMeta[key(a)].icon || !fs.existsSync(path.join(P.root, prevMeta[key(a)].icon));
        return true;
    });
    console.log(`Refreshing ${todo.length}/${apps.length} apps…`);

    const results = new Map();
    let failures = 0;
    await pool(todo, Number(opt('--concurrency')) || 4, async (app) => {
        try {
            const meta = await enrichApp(app, prevMeta[key(app)], { forceIcon: flag('--force-icons'), deep: flag('--deep'), verbose: flag('--verbose') });
            results.set(app, meta);
            const note = meta.missing ? 'MISSING' : `icon: ${meta.iconKind}${meta.fdroid ? ' · f-droid' : ''}${meta.izzy ? ' · izzy' : ''}`;
            console.log(`  ${app.repo || app.name}: ${note}`);
        } catch (err) {
            failures++;
            console.error(`  ✗ ${app.repo || app.name}: ${err.message}`);
        }
    });

    // Merge results, follow renames, drop duplicates and deleted repos.
    const meta = {};
    const seenIds = new Map();
    const kept = [];
    for (const app of apps) {
        const m = results.has(app) ? results.get(app) : prevMeta[key(app)];
        if (m && m.missing && app.repo) {
            console.warn(`  ⚠ ${app.repo} no longer exists — moving to excluded.yml`);
            excluded.push({ repo: app.repo, reason: 'Repository no longer available' });
            continue;
        }
        if (m && m.fullName && app.repo && m.fullName !== app.repo) {
            console.log(`  ↪ ${app.repo} is now ${m.fullName}`);
            app.repo = m.fullName;
        }
        if (m && m.id) {
            if (seenIds.has(m.id)) {
                console.warn(`  ⚠ ${app.repo} duplicates ${seenIds.get(m.id)} — removed`);
                continue;
            }
            seenIds.set(m.id, app.repo);
        }
        if (m) meta[key(app)] = m;
        kept.push(app);
    }

    // Delete icon files nothing references any more.
    if (!only && !flag('--missing') && fs.existsSync(P.icons)) {
        const used = new Set(Object.values(meta).map((m) => m.icon && path.basename(m.icon)));
        for (const a of kept) if (a.icon && !/^https?:/.test(a.icon)) used.add(path.basename(a.icon));
        for (const f of fs.readdirSync(P.icons)) if (!used.has(f)) fs.unlinkSync(path.join(P.icons, f));
    }

    saveApps(kept);
    saveExcluded(excluded);
    saveMetadata(meta);
    console.log(`Done. ${kept.length} apps, ${failures} failures.`);
    if (failures > todo.length / 2) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
