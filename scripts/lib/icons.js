'use strict';

// Icon resolution. Candidates are tried best-first; every download is decoded
// with sharp so broken files (HTML error pages, symlink stubs, 16px favicons,
// wide banners, transparent adaptive-icon layers) are rejected rather than
// committed. Accepted icons are normalised to a 128x128 PNG.
//
// Order:
//   1. `icon:` override in apps.yml
//   2. Fastlane / Triple-T store icon in the repo (512px, what F-Droid shows)
//   3. F-Droid / IzzyOnDroid repository icon for the detected package id
//   4. Launcher icon declared in AndroidManifest.xml, highest density raster
//   5. Repo logo/icon images (logo.png, assets/icon.png, ...)
//   6. Organisation avatar, only when the org is clearly the app's own
//   7. Generated monogram SVG (never a random personal avatar)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getBuffer, rawUrl } = require('./github');
const { storeIconPaths, launcherIconPaths, genericLogoPaths } = require('./android');
const { P } = require('./data');

const SIZE = 128;

// Perceptual (difference) hashes of stock project-template icons. A repo that
// never replaced the default icon gets a monogram instead of a fake logo.
const TEMPLATE_HASHES = [
    'd4e0968e96b0d0c8', // React Native / Android Studio default (green grid robot)
    '71e8868e8ea2e870', // React Native default, round
    '5cb872c4d8b1b85c', // Flutter default
    'ccb27169cccc9451', // Expo blank template
    '304d4d96332b4c00', // Expo default template
    '80c6b178e1728ee0', // Capacitor default
].map((h) => BigInt('0x' + h));

async function dhash(buf) {
    const data = await sharp(buf, { density: 72 }).flatten({ background: '#fff' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let h = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
    return h;
}

const hamming = (a, b) => { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

async function isTemplateIcon(buf) {
    const h = await dhash(buf);
    return TEMPLATE_HASHES.some((t) => hamming(h, t) <= 5);
}

async function validate(buf, { minSize = 48 } = {}) {
    if (!buf || buf.length < 100) return { ok: false, reason: 'empty' };
    let img;
    try {
        img = sharp(buf, { failOn: 'error', limitInputPixels: 64e6 });
        const meta = await img.metadata();
        if (!['png', 'webp', 'jpeg', 'gif', 'svg', 'avif'].includes(meta.format)) return { ok: false, reason: `format ${meta.format}` };
        const { width, height } = meta;
        if (meta.format !== 'svg' && Math.min(width, height) < minSize) return { ok: false, reason: `too small ${width}x${height}` };
        const ratio = width / height;
        if (ratio < 0.8 || ratio > 1.25) return { ok: false, reason: `not square ${width}x${height}` };
        const stats = await sharp(buf).stats();
        if (meta.hasAlpha && stats.channels[3] && stats.channels[3].max === 0) return { ok: false, reason: 'fully transparent' };
        if (stats.entropy < 0.15) return { ok: false, reason: 'blank' };
        if (await isTemplateIcon(buf)) return { ok: false, reason: 'stock template icon' };
        return { ok: true, meta };
    } catch (err) {
        return { ok: false, reason: `undecodable (${err.message.split('\n')[0]})` };
    }
}

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function normalise(buf) {
    // Legacy launcher and store icons often carry wide transparent margins, which
    // makes them look tiny next to full-bleed icons. Trim those, but only when the
    // corner is transparent; trimming a solid background would eat the icon itself.
    let src = await sharp(buf, { density: 300 }).ensureAlpha().png().toBuffer();
    const corner = await sharp(src).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    if (corner[3] === 0) {
        try {
            src = await sharp(src).trim({ background: CLEAR, threshold: 1 }).toBuffer();
        } catch { /* fully uniform image: keep as is */ }
    }
    const pad = 4;
    return sharp(src)
        .resize(SIZE - pad * 2, SIZE - pad * 2, { fit: 'contain', background: CLEAR, kernel: 'lanczos3' })
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: CLEAR })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
}

const PALETTE = ['#1e88e5', '#43a047', '#e53935', '#8e24aa', '#fb8c00', '#00897b', '#3949ab', '#6d4c41', '#d81b60', '#546e7a'];

function monogramSvg(name) {
    const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    const letters = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const bg = PALETTE[h % PALETTE.length];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 128 128">` +
        `<rect width="128" height="128" rx="28" fill="${bg}"/>` +
        `<text x="64" y="64" dy=".35em" text-anchor="middle" font-family="Roboto,Segoe UI,Helvetica,Arial,sans-serif" font-size="${letters.length > 1 ? 50 : 64}" font-weight="700" fill="#fff">${letters.replace(/[<&>]/g, '')}</text></svg>\n`;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** An org avatar is only trusted when the org is obviously the app itself. */
function ownerLooksLikeApp(repo, appName) {
    if (!repo.owner || repo.owner.type !== 'Organization') return false;
    const o = norm(repo.owner.login);
    const names = [norm(repo.name), norm(appName)].filter((n) => n.length >= 3);
    return names.some((n) => o.includes(n) || n.includes(o.replace(/(app|apps|org|dev|team|project|hq|labs?)$/, '')));
}

/**
 * Build the ordered candidate list.
 * ctx: { app, repo, tree, inspection, store: { fdroid, izzy, versionCode } }
 */
function candidates(ctx) {
    const { app, repo, tree, inspection, store = {} } = ctx;
    const list = [];
    const add = (url, kind) => url && !list.some((c) => c.url === url) && list.push({ url, kind });

    if (app.icon) add(/^https?:/.test(app.icon) ? app.icon : null, 'override');

    const live = (paths) => paths.filter((p) => !(tree.symlinks && tree.symlinks.has(p)));
    const raw = (p) => rawUrl(repo.full_name, repo.default_branch, p);
    if (repo && tree) live(storeIconPaths(tree.paths)).slice(0, 3).forEach((p) => add(raw(p), 'store-metadata'));

    const pkg = app.fdroid || (inspection && inspection.packageId);
    if (pkg && store.fdroid) {
        add(`https://f-droid.org/repo/${pkg}/en-US/icon.png`, 'f-droid');
        if (store.versionCode) add(`https://f-droid.org/repo/icons-640/${pkg}.${store.versionCode}.png`, 'f-droid');
    }
    if (pkg && store.izzy) add(`https://apt.izzysoft.de/fdroid/repo/${pkg}/en-US/icon.png`, 'izzyondroid');

    if (repo && tree) {
        const module = inspection && inspection.info && inspection.info.module;
        live(launcherIconPaths(tree.paths, module, inspection && inspection.manifest)).slice(0, 4).forEach((p) => add(raw(p), 'launcher'));
        live(genericLogoPaths(tree.paths, repo.name)).slice(0, 4).forEach((p) => add(raw(p), 'repo-logo'));
    }
    if (repo && ownerLooksLikeApp(repo, app.name || (inspection && inspection.appName))) {
        add(`${repo.owner.avatar_url}${repo.owner.avatar_url.includes('?') ? '&' : '?'}s=256`, 'org-avatar');
    }
    return list;
}

function writeIcon(id, buf, ext) {
    fs.mkdirSync(P.icons, { recursive: true });
    for (const e of ['png', 'svg']) {
        const f = path.join(P.icons, `${id}.${e}`);
        if (e !== ext && fs.existsSync(f)) fs.unlinkSync(f);
    }
    const file = path.join(P.icons, `${id}.${ext}`);
    fs.writeFileSync(file, buf);
    return path.relative(P.root, file).split(path.sep).join('/');
}

/** Resolve, download, validate and save an icon. Returns { icon, iconSource, iconKind, tried }. */
async function resolveIcon(id, ctx, displayName) {
    // Local override path (e.g. a hand-made icon committed under assets/).
    if (ctx.app.icon && !/^https?:/.test(ctx.app.icon)) {
        const abs = path.join(P.root, ctx.app.icon);
        if (fs.existsSync(abs)) return { icon: ctx.app.icon, iconSource: ctx.app.icon, iconKind: 'override', tried: [] };
    }
    const tried = [];
    let skipLaunchers = false;
    for (const c of candidates(ctx)) {
        if (skipLaunchers && c.kind === 'launcher') continue;
        const buf = await getBuffer(c.url);
        const v = await validate(buf, { minSize: c.kind === 'override' ? 16 : 48 });
        tried.push({ ...c, ok: v.ok, reason: v.reason });
        // Lower densities of a stock template icon are the same template.
        if (v.reason === 'stock template icon' && c.kind === 'launcher') skipLaunchers = true;
        if (!v.ok) continue;
        const icon = writeIcon(id, await normalise(buf), 'png');
        return { icon, iconSource: c.url, iconKind: c.kind, tried };
    }
    const icon = writeIcon(id, Buffer.from(monogramSvg(displayName)), 'svg');
    return { icon, iconSource: null, iconKind: 'monogram', tried };
}

module.exports = { resolveIcon, candidates, validate, normalise, monogramSvg, ownerLooksLikeApp, dhash, isTemplateIcon };
