#!/usr/bin/env node
'use strict';

// Renders README.md and data/stats.json from data/apps.yml + data/metadata.json
// using templates/README.template.md. Never edits README.md by hand-parsing it.
//
//   node scripts/build-readme.js          write README.md and stats.json
//   node scripts/build-readme.js --check  exit 1 if README.md is out of date

const fs = require('fs');
const path = require('path');
const { P, key, loadApps, loadCategories, loadMetadata } = require('./lib/data');
const { cleanDescription, formatCount, anchor, escapeCell, humanizeRepoName } = require('./lib/text');

const RECENT_COUNT = 6;
const STALE_DAYS = 365;
const ICON = 48;

const badge = (label, color, logo, href) =>
    `<a href="${href}"><img src="https://img.shields.io/badge/${encodeURIComponent(label.replace(/-/g, '--'))}-${color}?style=flat-square${logo ? `&logo=${logo}&logoColor=white` : ''}" alt="${label}"></a>`;

/** Merge curated fields (apps.yml) over generated ones (metadata.json). */
function resolve(app, meta = {}) {
    const name = app.name || meta.appName || humanizeRepoName((app.repo || '').split('/').pop() || app.source);
    const url = meta.url || (app.repo ? `https://github.com/${app.repo}` : app.source);
    const daysIdle = meta.pushedAt ? (Date.now() - Date.parse(meta.pushedAt)) / 864e5 : 0;
    return {
        ...app,
        name,
        url,
        description: cleanDescription(app.description || meta.description || ''),
        icon: meta.icon || null,
        stars: meta.stars,
        license: app.license || meta.license || null,
        packageId: app.fdroid || meta.packageId || null,
        fdroid: Boolean(meta.fdroid),
        izzy: Boolean(meta.izzy),
        release: meta.release || null,
        archived: Boolean(meta.archived),
        stale: daysIdle > STALE_DAYS,
    };
}

function installLinks(a) {
    const links = [];
    if (a.fdroid) links.push(badge('F-Droid', '1976D2', 'fdroid', `https://f-droid.org/packages/${a.packageId}/`));
    if (a.izzy) links.push(badge('IzzyOnDroid', '5C4D9E', 'android', `https://apt.izzysoft.de/fdroid/index/apk/${a.packageId}`));
    if (a.release) links.push(badge('Releases', '24292F', 'github', `${a.url}/releases/latest`));
    if (!links.length && a.homepage) links.push(badge('Website', '3DDC84', null, a.homepage));
    if (!links.length) links.push(badge('Source', '24292F', a.url.includes('github.com') ? 'github' : null, a.url));
    return links.join(' ');
}

function row(a) {
    const icon = a.icon ? `<img src="${a.icon}" width="${ICON}" height="${ICON}" alt="${escapeCell(a.name)} icon">` : '';
    const facts = [
        a.stars != null ? `⭐ ${formatCount(a.stars)}` : null,
        a.license,
        a.archived ? '🗄️ archived' : a.stale ? '💤' : null,
    ].filter(Boolean).join(' · ');
    const title = `**[${escapeCell(a.name)}](${a.homepage && !a.url.includes('github.com') ? a.homepage : a.url})**` + (facts ? `<br><sub>${facts}</sub>` : '');
    return `| ${icon} | ${title} | ${escapeCell(a.description)} | ${installLinks(a)} |`;
}

const sortApps = (list) => [...list].sort((x, y) =>
    (x.archived - y.archived) || ((y.stars ?? -1) - (x.stars ?? -1)) || x.name.localeCompare(y.name));

function render() {
    const categories = loadCategories();
    const meta = loadMetadata();
    const apps = loadApps().map((a) => resolve(a, meta[key(a)]));
    const byCat = new Map(categories.map((c) => [c.id, []]));
    for (const a of apps) {
        if (!byCat.has(a.category)) throw new Error(`Unknown category "${a.category}" for ${a.name}`);
        byCat.get(a.category).push(a);
    }
    const used = categories.filter((c) => byCat.get(c.id).length);
    const heading = (c) => `${c.emoji} ${c.title}`;

    // awesome-lint requires the ToC to mirror the section headings, in order.
    const toc = [
        '- [Recently Added](#recently-added)',
        ...used.map((c) => `- [${heading(c)}](#${anchor(heading(c))}) (${byCat.get(c.id).length})`),
    ].join('\n');

    const recent = [...apps].filter((a) => a.added).sort((x, y) => String(y.added).localeCompare(String(x.added)) || x.name.localeCompare(y.name)).slice(0, RECENT_COUNT);
    const catById = new Map(categories.map((c) => [c.id, c]));
    const recentTable = [
        '<table>',
        '<tr>',
        ...recent.map((a) => `<td align="center" width="${Math.floor(100 / RECENT_COUNT)}%"><a href="${a.url}"><img src="${a.icon}" width="${ICON}" height="${ICON}" alt="${a.name} icon"><br><b>${a.name}</b></a><br><sub>${catById.get(a.category).emoji} ${String(a.added)}</sub></td>`),
        '</tr>',
        '</table>',
    ].join('\n');

    const sections = used.map((c) => [
        `## ${heading(c)}`,
        '',
        `*${c.description}*`,
        '',
        '| | App | Description | Get it |',
        '|:-:|:--|:--|:--|',
        ...sortApps(byCat.get(c.id)).map(row),
        '',
        '<div align="right"><a href="#contents">⬆ Back to contents</a></div>',
    ].join('\n')).join('\n\n');

    const updated = new Date().toISOString().slice(0, 10);
    const vars = {
        APP_COUNT: apps.length,
        CATEGORY_COUNT: used.length,
        UPDATED: updated,
        UPDATED_BADGE: updated.replace(/-/g, '--'),
        TOC: toc,
        RECENT: recentTable,
        CATEGORIES: sections,
    };
    const readme = fs.readFileSync(P.template, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

    const stats = {
        apps: apps.length,
        categories: used.length,
        fdroid: apps.filter((a) => a.fdroid).length,
        izzyondroid: apps.filter((a) => a.izzy).length,
        byCategory: Object.fromEntries(used.map((c) => [c.id, byCat.get(c.id).length])),
    };
    return { readme, stats };
}

// The "updated" date legitimately differs between builds; compare everything else.
const withoutDate = (s) => s.replace(/updated-[\d-]+-555|Updated \d{4}-\d\d-\d\d/g, '');

function main() {
    const { readme, stats } = render();
    const current = fs.existsSync(P.readme) ? fs.readFileSync(P.readme, 'utf8') : '';
    const changed = withoutDate(current) !== withoutDate(readme);
    if (process.argv.includes('--check')) {
        if (changed) {
            console.error('README.md is out of date. Run `npm run build` and commit the result.');
            process.exit(1);
        }
        console.log('README.md is up to date.');
        return;
    }
    // Keep the date stable when nothing else changed, so the bot doesn't commit date-only diffs.
    if (changed) fs.writeFileSync(P.readme, readme);
    fs.writeFileSync(P.stats, JSON.stringify(stats, null, 2) + '\n');
    console.log(`Built README.md: ${stats.apps} apps in ${stats.categories} categories.`);
}

if (require.main === module) main();
module.exports = { render, resolve };
