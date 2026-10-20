'use strict';

// Builds the generated metadata record for one app: GitHub stats, canonical
// repo name (follows renames/transfers), detected package id and app name,
// F-Droid / IzzyOnDroid availability, and a validated icon.

const fs = require('fs');
const path = require('path');
const gh = require('./github');
const { inspectApp } = require('./android');
const { resolveIcon } = require('./icons');
const { repoId } = require('./text');
const { P } = require('./data');

async function storeInfo(pkg) {
    if (!pkg) return { fdroid: false, izzy: false };
    const [f, i] = await Promise.all([
        gh.getJson(`https://f-droid.org/api/v1/packages/${pkg}`),
        gh.getJson(`https://apt.izzysoft.de/fdroid/api/v1/packages/${pkg}`),
    ]);
    return {
        fdroid: Boolean(f && f.packageName),
        izzy: Boolean(i && i.packageName),
        versionCode: (f && f.suggestedVersionCode) || null,
    };
}

const iconExists = (icon) => icon && fs.existsSync(path.join(P.root, icon));

/**
 * @param app   entry from apps.yml
 * @param prev  previous metadata record (may be undefined)
 * @param opts  { forceIcon, deep, repo } — `repo` lets discovery pass an already-fetched API object
 */
async function enrichApp(app, prev = {}, opts = {}) {
    if (!app.repo) return enrichExternal(app, prev, opts);

    const repo = opts.repo || await gh.getRepo(app.repo);
    if (!repo) return { ...prev, missing: true, checked: new Date().toISOString() };

    const id = repoId(repo.full_name);
    const prevIconValid = iconExists(prev.icon) && prev.iconKind !== 'monogram' && path.basename(prev.icon).startsWith(id + '.');
    const iconOverrideChanged = app.icon && prev.iconSource !== app.icon;
    const needIcon = opts.forceIcon || !prevIconValid || iconOverrideChanged;
    const needInspect = opts.deep || needIcon || prev.packageId === undefined;

    let inspection = prev.packageId !== undefined
        ? { packageId: prev.packageId, appName: prev.appName, isApp: prev.isApp }
        : null;
    let tree = null;
    if (needInspect) {
        tree = await gh.getTree(repo.full_name, repo.default_branch);
        inspection = await inspectApp(repo, tree);
    }

    const packageId = app.fdroid || (inspection && inspection.packageId) || null;
    const store = await storeInfo(packageId);

    let release = prev.release || null;
    if (!store.fdroid && !store.izzy) {
        const r = await gh.api(`/repos/${repo.full_name}/releases/latest`).catch(() => null);
        release = r && r.assets && r.assets.some((a) => /\.apk$/i.test(a.name)) ? { tag: r.tag_name, date: r.published_at } : null;
    }

    const meta = {
        id: repo.id,
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description || '',
        homepage: repo.homepage || '',
        topics: repo.topics || [],
        stars: repo.stargazers_count,
        license: repo.license && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null,
        pushedAt: repo.pushed_at,
        archived: Boolean(repo.archived),
        packageId,
        appName: (inspection && inspection.appName) || null,
        isApp: inspection ? inspection.isApp : prev.isApp,
        fdroid: store.fdroid,
        izzy: store.izzy,
        release,
        icon: prev.icon,
        iconSource: prev.iconSource,
        iconKind: prev.iconKind,
        checked: new Date().toISOString(),
    };

    if (needIcon) {
        const res = await resolveIcon(id, { app, repo, tree, inspection: inspection || {}, store }, app.name || meta.appName || repo.name);
        if (res.iconKind !== 'monogram' || !prevIconValid) Object.assign(meta, { icon: res.icon, iconSource: app.icon || res.iconSource, iconKind: res.iconKind });
        if (opts.verbose) for (const t of res.tried) console.log(`    ${t.ok ? '✓' : '✗'} ${t.kind} ${t.url}${t.ok ? '' : ' — ' + t.reason}`);
    }
    // Clean up an icon file left behind by a rename.
    if (prev.icon && prev.icon !== meta.icon && iconExists(prev.icon)) fs.unlinkSync(path.join(P.root, prev.icon));
    return meta;
}

async function enrichExternal(app, prev, opts) {
    const id = 'ext--' + app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const store = await storeInfo(app.fdroid);
    const meta = { ...prev, url: app.source, packageId: app.fdroid || null, fdroid: store.fdroid, izzy: store.izzy, isApp: true, checked: new Date().toISOString() };
    if (opts.forceIcon || !iconExists(prev.icon) || prev.iconKind === 'monogram' || (app.icon && prev.iconSource !== app.icon)) {
        const res = await resolveIcon(id, { app, store: { ...store }, inspection: { packageId: app.fdroid } }, app.name);
        Object.assign(meta, { icon: res.icon, iconSource: app.icon || res.iconSource, iconKind: res.iconKind });
    }
    return meta;
}

module.exports = { enrichApp, storeInfo };
