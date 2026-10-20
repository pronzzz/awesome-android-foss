#!/usr/bin/env node
'use strict';

// Monthly discovery of new FOSS Android apps.
//
// Pipeline per candidate:
//   1. GitHub search across several rotating queries (sorted by stars, recent activity only)
//   2. Cheap filters: already listed (by numeric repo id, so renames can't sneak back in),
//      excluded, fork/archived, OSI license, stars, libraries/lists/samples, NSFW
//   3. Repo inspection: must contain an Android *application* module
//   4. Auto-categorise, fetch store availability + icon, append to data/apps.yml
//
//   node scripts/discover.js [--max 5] [--min-stars 100] [--dry-run]

const fs = require('fs');
const path = require('path');
const gh = require('./lib/github');
const { inspectApp } = require('./lib/android');
const { classify } = require('./lib/classify');
const { enrichApp } = require('./lib/enrich');
const { cleanDescription, humanizeRepoName, today } = require('./lib/text');
const { P, key, loadApps, loadExcluded, loadCategories, loadMetadata, saveApps, saveMetadata } = require('./lib/data');

const CACHE = path.join(P.root, 'data/discovery-cache.json');
const CACHE_DAYS = 120;

const OSI_LICENSES = new Set([
    'Apache-2.0', 'MIT', 'GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0', 'BSD-2-Clause',
    'BSD-3-Clause', 'BSD-3-Clause-Clear', 'ISC', 'EUPL-1.1', 'EUPL-1.2', 'Unlicense', '0BSD', 'Zlib', 'Artistic-2.0',
    'BSL-1.0', 'ECL-2.0', 'EPL-1.0', 'EPL-2.0', 'MS-PL', 'OSL-3.0', 'UPL-1.0', 'NCSA', 'MulanPSL-2.0', 'CECILL-2.1',
]);

// Not apps: libraries, plugins, lists, samples. Matched against name + topics.
const NOT_APP_TOPICS = new Set(['awesome', 'awesome-list', 'awesome-lists', 'curated-list', 'list', 'android-library', 'library', 'sdk',
    'android-sdk', 'framework', 'gradle-plugin', 'plugin', 'boilerplate', 'template', 'android-template', 'starter', 'sample', 'samples',
    'sample-app', 'android-sample', 'demo', 'demo-app', 'example', 'tutorial', 'tutorials', 'course', 'learning-resources', 'interview',
    'interview-questions', 'showcase', 'portfolio', 'roadmap', 'cheatsheet', 'jetpack-compose-library', 'compose-library', 'ui-library',
    'component-library', 'design-system', 'mcp-server', 'automation-framework', 'testing-tools', 'xposed-module', 'lsposed-module', 'magisk-module']);
const NOT_APP_NAME = /(^|[-_.])(awesome|lib|library|sdk|plugin|sample|samples|example|examples|demo|tutorial|template|boilerplate|starter|showcase|playground|codelab|kit)([-_.]|$)/i;
const NOT_APP_DESC = [
    /\b(an?|the|tiny|small|simple|lightweight|kotlin|java|android|compose|jetpack compose|flutter|react native|multiplatform|kmp)\s+(ui\s+)?(library|sdk|framework|plugin|toolkit)\b/i,
    /\b(library|sdk) (for|to|that|which)\b/i,
    /\b(list|collection) of\b.*\b(apps|applications|software|resources|tools)\b/i,
    /\b(gradle|kotlin compiler|ide|intellij|android studio) plugin\b/i,
    /\b(sample|demo|example|tutorial|learning|boilerplate|template|starter) (app|project|code|repository)\b/i,
    /\b(magisk|xposed|lsposed|kernelsu) module\b/i,
];
const NSFW = /\b(nsfw|hentai|e-?hentai|exhentai|nhentai|porn|porno|doujin(shi)?|xxx|r-?18|18\+|adult content|onlyfans)\b/i;

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const MAX_NEW = Number(opt('--max', process.env.DISCOVER_MAX || 5));
const MIN_STARS = Number(opt('--min-stars', process.env.DISCOVER_MIN_STARS || 100));
const DRY = args.includes('--dry-run');

const isoDaysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

function queries() {
    const base = `stars:>=${MIN_STARS} pushed:>=${isoDaysAgo(365)} archived:false fork:false`;
    const list = [
        'topic:android-app', 'topic:fdroid', 'topic:f-droid', 'topic:izzyondroid', 'topic:android topic:foss',
        'topic:android topic:open-source', 'topic:android topic:privacy', 'topic:android topic:material-you',
        'topic:android topic:jetpack-compose', 'topic:android topic:flutter', 'topic:android topic:self-hosted',
        'topic:android topic:kotlin topic:app', `topic:android created:>=${isoDaysAgo(180)}`,
    ].map((q) => `${q} ${base}`);
    // Rotate the order each month so the same queries don't always consume the budget.
    const now = new Date();
    const month = now.getUTCFullYear() * 12 + now.getUTCMonth();
    return list.map((q, i) => [q, (i * 7919 + month * 104729) % 1000]).sort((a, b) => a[1] - b[1]).map(([q]) => q);
}

/** Prefer the most "English-looking" segment of bilingual descriptions ("中文 | English"). */
function pickDescription(raw) {
    if (!raw) return '';
    const parts = raw.split(/\s+[|｜]\s+/).filter(Boolean);
    const latin = (s) => (s.match(/[A-Za-z]/g) || []).length / Math.max(s.length, 1);
    return parts.sort((a, b) => latin(b) - latin(a))[0];
}

const needsEnglish = (d) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}]{2,}/u.test(d);

/** Free checks that need no extra API calls. Returns a rejection reason or null. */
function prefilter(repo, known) {
    if (known.ids.has(repo.id) || known.names.has(repo.full_name.toLowerCase())) return 'already listed or excluded';
    if (repo.fork || repo.archived || repo.disabled || repo.is_template) return 'fork/archived/template';
    const spdx = repo.license && repo.license.spdx_id;
    if (!spdx || !OSI_LICENSES.has(spdx)) return `license ${spdx || 'none'} not OSI-approved/detected`;
    if (repo.stargazers_count < MIN_STARS) return 'not enough stars';
    if (!repo.description || repo.description.trim().length < 10) return 'no description';
    const topics = repo.topics || [];
    const text = `${repo.name} ${repo.description} ${topics.join(' ')}`;
    if (NSFW.test(text)) return 'nsfw';
    if (topics.some((t) => NOT_APP_TOPICS.has(t))) return `topic: ${topics.find((t) => NOT_APP_TOPICS.has(t))}`;
    if (NOT_APP_NAME.test(repo.name)) return 'name looks like a library/sample/list';
    const descHit = NOT_APP_DESC.find((re) => re.test(repo.description));
    if (descHit) return 'description looks like a library/sample/list';
    return null;
}

/**
 * Full evaluation of one repo. Shared with scripts/add.js.
 * Returns { ok, reason, entry, meta, ranked }.
 */
async function evaluate(repo, { categories, category, name, force = false } = {}) {
    const tree = await gh.getTree(repo.full_name, repo.default_branch);
    const inspection = await inspectApp(repo, tree);
    if (!inspection.isApp && !force) return { ok: false, reason: 'no Android application module found' };

    const description = cleanDescription(pickDescription(repo.description));
    const appName = inspection.appName && !/debug|test/i.test(inspection.appName) && inspection.appName.length <= 30 ? inspection.appName : null;
    const { category: guessed, ranked } = classify(categories, {
        topics: repo.topics || [],
        name: `${repo.name} ${appName || ''}`,
        description: repo.description || '',
    });
    const entry = {
        name: name || appName || humanizeRepoName(repo.name),
        repo: repo.full_name,
        category: category || guessed,
        description,
        homepage: repo.homepage && !/github\.(com|io)/.test(repo.homepage) ? repo.homepage : undefined,
        added: today(),
    };
    const meta = await enrichApp(entry, {}, { repo });
    return { ok: true, entry, meta, ranked };
}

async function main() {
    if (!gh.hasToken) console.warn('⚠ No GITHUB_TOKEN set: search is limited to 10 requests/min.');
    const categories = loadCategories();
    const apps = loadApps();
    const metadata = loadMetadata();
    const excluded = loadExcluded();
    const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
    const cutoff = Date.now() - CACHE_DAYS * 864e5;
    for (const [id, c] of Object.entries(cache)) if (Date.parse(c.checked) < cutoff) delete cache[id];

    const known = {
        ids: new Set([...Object.values(metadata).map((m) => m.id), ...excluded.map((e) => e.id)].filter(Boolean)),
        names: new Set([...apps.map((a) => key(a)), ...excluded.map((e) => e.repo.toLowerCase())]),
    };

    const added = [];
    const rejected = [];
    const seen = new Set();
    for (const q of queries()) {
        if (added.length >= MAX_NEW) break;
        for (let page = 1; page <= 3 && added.length < MAX_NEW; page++) {
            let items;
            try {
                items = await gh.searchRepos(q, { perPage: 50, page });
            } catch (err) {
                console.warn(`Search failed (${q}): ${err.message}`);
                break;
            }
            await gh.sleep(2500); // stay well under the 30 searches/min limit
            if (!items.length) break;
            for (const repo of items) {
                if (added.length >= MAX_NEW) break;
                if (seen.has(repo.id) || cache[repo.id]) continue;
                seen.add(repo.id);
                const reason = prefilter(repo, known);
                if (reason) {
                    if (reason !== 'already listed or excluded') rejected.push({ repo: repo.full_name, reason });
                    continue;
                }
                console.log(`Inspecting ${repo.full_name} (★${repo.stargazers_count})`);
                try {
                    const res = await evaluate(repo, { categories });
                    if (!res.ok) {
                        cache[repo.id] = { repo: repo.full_name, reason: res.reason, checked: new Date().toISOString() };
                        rejected.push({ repo: repo.full_name, reason: res.reason });
                        console.log(`  ✗ ${res.reason}`);
                        continue;
                    }
                    const top = res.ranked.slice(0, 3).map((r) => `${r.id}:${r.score}`).join(', ');
                    console.log(`  ✓ "${res.entry.name}" → ${res.entry.category} [${top}] · icon: ${res.meta.iconKind}`);
                    added.push(res);
                    known.ids.add(repo.id);
                    known.names.add(repo.full_name.toLowerCase());
                } catch (err) {
                    console.warn(`  ! ${repo.full_name}: ${err.message}`);
                }
            }
        }
    }

    if (!DRY && added.length) {
        for (const { entry, meta } of added) {
            apps.push(entry);
            metadata[key(entry)] = meta;
        }
        saveApps(apps, categories);
        saveMetadata(metadata);
    }
    if (DRY) {
        // Evaluating a candidate downloads its icon; a dry run must leave no trace.
        for (const { meta } of added) if (meta.icon && fs.existsSync(path.join(P.root, meta.icon))) fs.unlinkSync(path.join(P.root, meta.icon));
    } else {
        fs.writeFileSync(CACHE, JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 2) + '\n');
    }

    const catTitle = new Map(categories.map((c) => [c.id, `${c.emoji} ${c.title}`]));
    const summary = [
        `### 🤖 Discovery: ${added.length} new app${added.length === 1 ? '' : 's'}`,
        '',
        ...(added.length ? ['| App | Category | Stars | Description |', '|---|---|---|---|',
            ...added.map(({ entry, meta }) => `| [${entry.name}](${meta.url}) | ${catTitle.get(entry.category)} | ${meta.stars} | ${entry.description}${needsEnglish(entry.description) ? ' ⚠️ *needs an English description*' : ''} |`)] : ['Nothing new this time.']),
        '',
        `<details><summary>${rejected.length} candidates skipped</summary>`,
        '',
        ...rejected.slice(0, 100).map((r) => `- \`${r.repo}\`: ${r.reason}`),
        '',
        '</details>',
    ].join('\n');
    console.log('\n' + summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    if (process.env.DISCOVERY_SUMMARY_FILE) fs.writeFileSync(process.env.DISCOVERY_SUMMARY_FILE, summary + '\n');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.length}\nnames=${added.map((a) => a.entry.name).join(', ')}\n`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { evaluate, prefilter, pickDescription, queries, OSI_LICENSES };
