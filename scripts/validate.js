#!/usr/bin/env node
'use strict';

// Schema and consistency checks for the data files. Runs in CI on every PR.
// Network-free, so it works for contributors without a token.

const fs = require('fs');
const path = require('path');
const { P, key, loadApps, loadExcluded, loadCategories, loadMetadata } = require('./lib/data');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const categories = loadCategories();
const apps = loadApps();
const excluded = loadExcluded();
const meta = loadMetadata();

// Categories
const catIds = new Set();
for (const c of categories) {
    if (!/^[a-z][a-z0-9-]*$/.test(c.id || '')) err(`categories.yml: invalid id "${c.id}"`);
    if (catIds.has(c.id)) err(`categories.yml: duplicate id "${c.id}"`);
    catIds.add(c.id);
    for (const f of ['title', 'emoji', 'description']) if (!c[f]) err(`categories.yml: "${c.id}" is missing ${f}`);
    // U+FE0F (emoji variation selector) ends up inside GitHub's heading anchors and breaks ToC links.
    if (c.emoji && /️/.test(c.emoji)) err(`categories.yml: emoji for "${c.id}" contains U+FE0F; pick one that doesn't need it`);
    if (!Array.isArray(c.keywords) || !c.keywords.length) warn(`categories.yml: "${c.id}" has no keywords, so nothing will be auto-sorted into it`);
}

// Apps
const ALLOWED = new Set(['name', 'repo', 'source', 'category', 'description', 'homepage', 'fdroid', 'license', 'icon', 'added']);
const seen = new Map();
const excludedNames = new Set(excluded.map((e) => e.repo.toLowerCase()));
apps.forEach((a, i) => {
    const label = a.name || a.repo || a.source || `entry #${i + 1}`;
    for (const k of Object.keys(a)) if (!ALLOWED.has(k)) err(`${label}: unknown field "${k}"`);
    if (!a.repo && !a.source) err(`${label}: needs "repo" or "source"`);
    if (a.repo && !/^[\w.-]+\/[\w.-]+$/.test(a.repo)) err(`${label}: repo must be "owner/name", got "${a.repo}"`);
    if (a.source && !/^https:\/\//.test(a.source)) err(`${label}: source must be an https URL`);
    if (a.source && (!a.name || !a.description)) err(`${label}: entries without a GitHub repo need a name and description`);
    if (!catIds.has(a.category)) err(`${label}: unknown category "${a.category}"`);
    if (a.description != null) {
        if (typeof a.description !== 'string' || a.description.length < 10) err(`${label}: description is too short`);
        else if (a.description.length > 160) err(`${label}: description is longer than 160 characters`);
        else if (!/[.!?)]$/.test(a.description)) err(`${label}: description should end with a full stop`);
    }
    if (a.homepage && !/^https?:\/\//.test(a.homepage)) err(`${label}: homepage must be a URL`);
    if (a.fdroid && !/^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/.test(a.fdroid)) err(`${label}: "${a.fdroid}" is not a valid package id`);
    if (a.added && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.added))) err(`${label}: added must be YYYY-MM-DD`);
    if (a.icon && !/^https:\/\//.test(a.icon) && !fs.existsSync(path.join(P.root, a.icon))) err(`${label}: icon file ${a.icon} does not exist`);
    const k = key(a);
    if (seen.has(k)) err(`${label}: duplicate of ${seen.get(k)}`);
    seen.set(k, label);
    if (excludedNames.has(k)) err(`${label}: ${a.repo} is in excluded.yml (${excluded.find((e) => e.repo.toLowerCase() === k).reason})`);

    const m = meta[k];
    if (!m) warn(`${label}: no metadata yet (the update workflow fills this in after merge)`);
    else if (m.icon && !fs.existsSync(path.join(P.root, m.icon))) warn(`${label}: icon ${m.icon} is missing`);
});

// Same GitHub repo listed twice under different names (rename/transfer).
const byId = new Map();
for (const a of apps) {
    const m = meta[key(a)];
    if (!m || !m.id) continue;
    if (byId.has(m.id)) err(`${a.repo} and ${byId.get(m.id)} are the same repository`);
    byId.set(m.id, a.repo);
}

for (const e of excluded) if (!e.repo || !e.reason) err(`excluded.yml: every entry needs repo and reason (${JSON.stringify(e)})`);

for (const w of warnings) console.warn(`⚠ ${w}`);
for (const e of errors) console.error(`✗ ${e}`);
if (process.env.GITHUB_ACTIONS) for (const e of errors) console.log(`::error file=data/apps.yml::${e}`);
console.log(`${apps.length} apps, ${categories.length} categories, ${excluded.length} excluded: ${errors.length} errors, ${warnings.length} warnings.`);
process.exit(errors.length ? 1 : 0);
