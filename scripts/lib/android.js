'use strict';

// Inspects a repository's file tree to decide whether it ships an Android
// *application* (not a library, plugin or sample), and extracts what we need
// for the list: the app module, package id, display name and icon resources.
//
// Handles Gradle apps (Groovy/KTS, version catalogs, gradle.properties ids),
// Kotlin Multiplatform (src/androidMain), legacy root-level manifests,
// Flutter / React Native (android/app) and Expo/Capacitor (app.json/config).

const { getRawText } = require('./github');

// Path segments that indicate non-shipping code.
const IGNORED_SEGMENTS = /(^|\/)(tests?|androidTest|testFixtures|[^/]*(sample|example|demo|dummy)[^/]*|test[-_]?apps?|benchmarks?|baseline[^/]*|build|node_modules|third[-_]?party|vendor|external|playground|showcase|templates?)(\/|$)/i;
const DENSITIES = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi'];
const PKG_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;
const APP_PLUGIN_RE = /com\.android\.application|android[.-]application|androidApplication|\bapplicationId\b/;
const LIB_PLUGIN_RE = /com\.android\.library|android[.-]library|androidLibrary/;
const LIBRARY_NAME_RE = /^(lib|libs|library|core|common|commons|sdk|api|plugin|ui|data|domain|feature|shared|base|utils?)([-_].*)?$/i;

const isIgnored = (p) => IGNORED_SEGMENTS.test(p);

/** "a/b/src/main/AndroidManifest.xml" -> "a/b"; "a/AndroidManifest.xml" -> "a"; "a/src/AndroidManifest.xml" -> "a". */
const moduleOf = (manifestPath) => manifestPath
    .replace(/\/?src\/[^/]+\/AndroidManifest\.xml$/, '')
    .replace(/\/?src\/AndroidManifest\.xml$/, '')
    .replace(/\/?AndroidManifest\.xml$/, '');

const resPattern = (prefix) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(src/[^/]+/)?res/(mipmap|drawable)-[^/]+/[^/]+$`);

function analyzeTree(paths) {
    const manifests = paths.filter((p) => /(^|\/)AndroidManifest\.xml$/.test(p) && !isIgnored(p) &&
        !/\/src\/(debug|test|androidTest|benchmark)[^/]*\//.test(p) && !/\/flavors\//.test(p));
    const fastlane = paths.filter((p) => /(^|\/)(fastlane\/)?metadata\/android\/[^/]+\//.test(p) && !isIgnored(p));
    const expoConfig = paths.find((p) => /^(app\.json|app\.config\.(js|ts)|capacitor\.config\.(json|ts))$/.test(p)) || null;

    const seen = new Map();
    for (const m of manifests) {
        const root = moduleOf(m);
        const prev = seen.get(root);
        // Prefer the main/androidMain manifest over flavor manifests in the same module.
        if (!prev || /\/(main|androidMain)\/AndroidManifest\.xml$/.test(m)) seen.set(root, m);
    }
    const modules = [...seen.entries()].map(([root, manifest]) => {
        const prefix = root ? root + '/' : '';
        const re = resPattern(prefix);
        const res = paths.filter((p) => re.test(p));
        const hasLauncher = res.some((p) => /\/mipmap-[^/]+\//.test(p));
        const gradle = ['build.gradle.kts', 'build.gradle'].map((g) => prefix + g).find((g) => paths.includes(g)) || null;
        const leaf = root.split('/').pop() || '';
        let score = 0;
        if (hasLauncher) score += 3;
        if (/^(app|android|mobile|application)$/i.test(leaf) || root === '') score += 2;
        if (/(^|\/)android\/app$/.test(root)) score += 2;
        if (LIBRARY_NAME_RE.test(leaf)) score -= 3;
        return { manifest, root, prefix, hasLauncher, gradle, score, depth: root ? root.split('/').length : 0 };
    }).sort((a, b) => b.score - a.score || a.depth - b.depth);

    const main = modules.find((m) => m.hasLauncher) || modules[0] || null;
    // Tree-only verdict. inspectApp() refines it using the module's Gradle plugins.
    const isApp = modules.some((m) => m.hasLauncher) || (fastlane.length > 0 && modules.length > 0);
    return { isApp, module: main, modules, fastlane, expoConfig };
}

function parseManifest(xml) {
    if (!xml) return {};
    const app = (xml.match(/<application\b[\s\S]*?>/) || [''])[0];
    const attr = (src, name) => (src.match(new RegExp(`android:${name}\\s*=\\s*"([^"]+)"`)) || [])[1];
    return {
        package: (xml.match(/<manifest\b[^>]*\bpackage\s*=\s*"([^"]+)"/) || [])[1],
        icon: attr(app, 'icon'),
        roundIcon: attr(app, 'roundIcon'),
        label: attr(app, 'label'),
    };
}

/**
 * Package id from a Gradle build file. Literal ids are returned directly;
 * indirections like `applicationId = APP_ID`, `project.property("APP_ID")` or
 * `libs.versions.app.version.appId.get()` are resolved against `lookups`
 * (other Gradle files, gradle.properties, libs.versions.toml).
 */
function parseApplicationId(gradle, lookups = []) {
    if (!gradle) return null;
    const literal = (re) => { const m = gradle.match(re); return m && PKG_RE.test(m[1]) ? m[1] : null; };
    const direct = literal(/\bapplicationId\s*(?:=|\()?\s*["']([\w.]+)["']/);
    if (direct) return direct;

    const expr = (gradle.match(/\bapplicationId\s*(?:=|\()?\s*([^\n)]+)/) || [])[1] || '';
    const ref = (expr.match(/propert(?:y|ies)\s*\(?\s*\[?["'](\w+)["']/) || [])[1] ||
        (expr.match(/libs\.versions\.[\w.]*?(\w+)\.get\(\)/) || [])[1] ||
        (expr.match(/^\s*([A-Za-z_]\w*)\s*$/) || [])[1];
    if (ref) {
        for (const text of [gradle, ...lookups]) {
            if (!text) continue;
            const m = text.match(new RegExp(`(?:^|[\\s.])${ref}\\s*[:=]\\s*["']?([\\w.]+)["']?(?![\\w.(])`, 'm'));
            if (m && PKG_RE.test(m[1])) return m[1];
        }
    }
    return literal(/\bnamespace\s*(?:=|\()?\s*["']([\w.]+)["']/);
}

function parseStringResource(xml, name) {
    if (!xml) return null;
    const m = xml.match(new RegExp(`<string\\s+name="${name}"[^>]*>([^<]+)</string>`));
    if (!m) return null;
    const v = m[1].trim().replace(/^"|"$/g, '').replace(/\\'/g, "'");
    return v && !/^@|[$&;%{}]/.test(v) ? v : null;
}

/** "PaperKnife: Privacy-First PDF" -> "PaperKnife", "Fossify Notes Beta" -> "Fossify Notes". */
function tidyAppName(name) {
    if (!name) return null;
    let n = name.trim().replace(/\s+(beta|debug|dev|nightly|preview|alpha|canary)$/i, '');
    const head = n.split(/\s*[:|‧·–—]\s+|\s+-\s+/)[0].trim();
    if (head.length >= 3) n = head;
    return n.length <= 40 && !/[$&;{}]/.test(n) ? n : null;
}

/**
 * Ordered list of raster launcher icon paths inside the main module,
 * best first: store icon, highest density, main source set, declared icon before round.
 */
function launcherIconPaths(paths, module, manifest = {}) {
    if (!module) return [];
    const resName = (ref) => (ref && /^@(mipmap|drawable)\//.test(ref) ? ref.split('/')[1] : null);
    const names = [...new Set([resName(manifest.icon), 'ic_launcher', resName(manifest.roundIcon), 'ic_launcher_round'].filter(Boolean))];
    const re = resPattern(module.prefix);

    const candidates = [];
    for (const p of paths) {
        if (!p.startsWith(module.prefix)) continue;
        if (/(ic_launcher-playstore|ic_launcher-web|playstore-icon)\.png$/.test(p) && !isIgnored(p.slice(module.prefix.length))) {
            candidates.push({ p, rank: -1 });
            continue;
        }
        if (!re.test(p)) continue;
        const m = p.match(/(?:src\/([^/]+)\/)?res\/(?:mipmap|drawable)-([a-z]+)(?:-v\d+)?\/([^/.]+)\.(png|webp)$/);
        if (!m) continue;
        const [, sourceSet = 'main', density, name] = m;
        const nameRank = names.indexOf(name);
        const densityRank = DENSITIES.indexOf(density);
        if (nameRank === -1 || densityRank === -1) continue;
        const setRank = /^(main|androidMain)$/.test(sourceSet) ? 0 : /debug|beta|nightly|dev|staging|preview|alpha/i.test(sourceSet) ? 2 : 1;
        candidates.push({ p, rank: setRank * 100 + nameRank * 10 + densityRank });
    }
    return candidates.sort((a, b) => a.rank - b.rank).map((c) => c.p);
}

/** Fastlane / Triple-T store icons, en-US first. */
function storeIconPaths(paths) {
    return paths
        .filter((p) => /(^|\/)(fastlane\/)?metadata\/android\/[^/]+\/images\/icon\.(png|jpe?g|webp)$/.test(p) ||
            /(^|\/)src\/main\/play\/listings\/[^/]+\/graphics\/icon\/[^/]+\.(png|jpe?g)$/.test(p))
        .filter((p) => !isIgnored(p))
        .sort((a, b) => (b.includes('/en-US/') - a.includes('/en-US/')) || a.length - b.length);
}

/** Loose "logo/icon" images anywhere in the repo, best guess first. */
function genericLogoPaths(paths, repoName = '') {
    const repo = repoName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return paths
        .filter((p) => !isIgnored(p) && !/\/res\/(mipmap|drawable)/.test(p) && !/(^|\/)(ios|macos|windows|linux|web)\//i.test(p))
        .filter((p) => {
            const base = p.split('/').pop().toLowerCase();
            if (!/\.(png|webp|jpe?g)$/.test(base)) return false;
            const stem = base.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/g, '');
            return /^(ic)?(app)?(launcher)?(icon|logo)(round|square|rounded|512|1024|256)?\d*$/.test(stem) ||
                (repo.length >= 3 && [`${repo}logo`, `${repo}icon`, repo].includes(stem));
        })
        .map((p) => {
            const base = p.split('/').pop().toLowerCase();
            let rank = p.split('/').length * 2;
            if (base.includes('icon')) rank -= 3;
            if (/banner|wide|full|text|dark|white|black|mono|foreground|background|splash/.test(p.toLowerCase())) rank += 8;
            if (/(^|\/)(docs?|assets|images?|img|art|graphics|branding|metadata|\.github)\//.test(p)) rank -= 1;
            return { p, rank };
        })
        .sort((a, b) => a.rank - b.rank)
        .map((c) => c.p);
}

/** Full Android-app inspection for a repo. Uses raw fetches only (no API quota). */
async function inspectApp(repo, tree) {
    const fullName = repo.full_name;
    const ref = repo.default_branch;
    const has = (p) => tree.paths.includes(p);
    const raw = (p) => getRawText(fullName, ref, p);
    const info = analyzeTree(tree.paths);
    const out = { isApp: info.isApp, module: null, packageId: null, appName: null, manifest: {} };

    // Expo / Capacitor projects often have no committed android/ folder.
    if (info.expoConfig && !info.modules.length) {
        const text = await raw(info.expoConfig);
        const pkg = text && ((text.match(/"android"\s*:\s*\{[\s\S]*?"package"\s*:\s*"([\w.]+)"/) || [])[1] || (text.match(/appId\s*[:=]\s*["']([\w.]+)["']/) || [])[1]);
        const name = text && (text.match(/"name"\s*:\s*"([^"]+)"/) || text.match(/appName\s*[:=]\s*["']([^"']+)["']/) || [])[1];
        if (pkg && PKG_RE.test(pkg)) Object.assign(out, { isApp: true, packageId: pkg, appName: tidyAppName(name) });
        return { ...out, info };
    }
    if (!info.modules.length) return { ...out, info };

    // Confirm with Gradle: the module applying the application plugin is the app.
    const lookupFiles = ['gradle.properties', 'gradle/libs.versions.toml', 'buildSrc/src/main/kotlin/Versions.kt', 'build.gradle.kts', 'build.gradle'];
    let lookups = null;
    let chosen = null;
    for (const mod of info.modules.filter((m) => m.gradle).slice(0, 4)) {
        const text = await raw(mod.gradle);
        if (!text) continue;
        if (APP_PLUGIN_RE.test(text) && !(LIB_PLUGIN_RE.test(text) && !/applicationId/.test(text))) {
            lookups = lookups || await Promise.all([...lookupFiles, mod.prefix + 'gradle.properties'].filter(has).map(raw));
            chosen = { mod, pkg: parseApplicationId(text, lookups) };
            break;
        }
    }
    const module = chosen ? chosen.mod : info.module;
    if (chosen) out.isApp = true;
    else if (info.modules.every((m) => m.gradle) && !info.fastlane.length) out.isApp = false; // all Gradle modules are libraries
    out.module = module.root;

    out.manifest = parseManifest(await raw(module.manifest));
    out.packageId = (chosen && chosen.pkg) || (out.manifest.package && PKG_RE.test(out.manifest.package) ? out.manifest.package : null);

    // Display name: fastlane title > manifest label (literal or @string).
    const title = tree.paths.find((p) => /(^|\/)(fastlane\/)?metadata\/android\/en-US\/title\.txt$/.test(p));
    if (title) out.appName = tidyAppName(((await raw(title)) || '').trim().split('\n')[0]);
    if (!out.appName && out.manifest.label) {
        if (out.manifest.label.startsWith('@string/')) {
            const key = out.manifest.label.slice(8);
            const strings = tree.paths.find((p) => p.startsWith(module.prefix) && /(src\/(main|androidMain)\/)?res\/values\/strings\.xml$/.test(p.slice(module.prefix.length)));
            if (strings) out.appName = tidyAppName(parseStringResource(await raw(strings), key));
        } else {
            out.appName = tidyAppName(out.manifest.label);
        }
    }
    return { ...out, info: { ...info, module } };
}

module.exports = { analyzeTree, parseManifest, parseApplicationId, parseStringResource, tidyAppName, launcherIconPaths, storeIconPaths, genericLogoPaths, inspectApp, isIgnored };
