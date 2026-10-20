'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { classify } = require('../scripts/lib/classify');
const { cleanDescription, humanizeRepoName, anchor, repoId, formatCount } = require('../scripts/lib/text');
const { analyzeTree, parseApplicationId, parseManifest, launcherIconPaths, storeIconPaths, genericLogoPaths, tidyAppName } = require('../scripts/lib/android');
const { validate, monogramSvg, ownerLooksLikeApp } = require('../scripts/lib/icons');
const { prefilter, pickDescription } = require('../scripts/discover');
const { loadCategories } = require('../scripts/lib/data');

const categories = loadCategories();
const cat = (repo) => classify(categories, repo).category;

test('classifier: topic and description signals', () => {
    assert.equal(cat({ topics: ['launcher', 'android'], name: 'Neo-Launcher', description: 'A modern launcher' }), 'launchers');
    assert.equal(cat({ topics: ['music-player', 'subsonic'], name: 'tempus', description: 'Music client for Subsonic' }), 'music');
    assert.equal(cat({ topics: ['firewall', 'vpn'], name: 'rethink', description: 'DNS and firewall' }), 'privacy');
    assert.equal(cat({ topics: ['youtube', 'newpipe'], name: 'flow', description: 'YouTube client' }), 'video');
    assert.equal(cat({ topics: ['calorie-tracker'], name: 'fitbook', description: 'Calorie and nutrition tracker' }), 'health');
});

test('classifier: old false positives no longer happen', () => {
    // The previous regex sent anything mentioning "privacy" to Privacy and "desktop" to Launchers.
    assert.equal(cat({ topics: ['todo', 'productivity'], name: 'super-productivity', description: 'Privacy-first todo list with time tracking' }), 'productivity');
    assert.equal(cat({ topics: ['terminal', 'ssh'], name: 'term', description: 'Terminal for desktop and Android' }), 'development');
    assert.equal(cat({ topics: [], name: 'thing', description: 'Does something' }), 'utilities');
});

test('classifier: all-in-one apps tying across categories fall back to utilities', () => {
    assert.equal(cat({ topics: ['music', 'notes', 'ebook'], name: 'plain', description: 'Manage your phone' }), 'utilities');
});

test('text helpers', () => {
    assert.equal(cleanDescription('📱 Video & audio calls through Nextcloud on Android'), 'Video & audio calls through Nextcloud on Android.');
    assert.equal(cleanDescription('see https://example.com for more'), 'See for more.');
    assert.ok(cleanDescription('word '.repeat(80)).endsWith('…'));
    assert.ok(cleanDescription('word '.repeat(80)).length <= 151);
    assert.equal(humanizeRepoName('talk-android'), 'Talk');
    assert.equal(humanizeRepoName('NewPipe'), 'NewPipe');
    assert.equal(humanizeRepoName('oss_weather'), 'Oss Weather');
    assert.equal(anchor('🔒 Privacy & Security'), '-privacy--security');
    assert.equal(anchor('Recently Added'), 'recently-added');
    assert.equal(repoId('FossifyOrg/File-Manager'), 'fossifyorg--file-manager');
    assert.equal(formatCount(40222), '40k');
    assert.equal(formatCount(3940), '3.9k');
    assert.equal(formatCount(512), '512');
});

test('android: detects app modules across project layouts', () => {
    const gradle = analyzeTree(['app/build.gradle.kts', 'app/src/main/AndroidManifest.xml', 'app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp']);
    assert.equal(gradle.isApp, true);
    assert.equal(gradle.module.root, 'app');

    const flutter = analyzeTree(['android/app/src/main/AndroidManifest.xml', 'android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 'lib/main.dart']);
    assert.equal(flutter.module.root, 'android/app');

    const kmp = analyzeTree(['composeApp/src/androidMain/AndroidManifest.xml', 'composeApp/src/androidMain/res/mipmap-xxhdpi/ic_launcher.png']);
    assert.equal(kmp.isApp, true);

    const legacy = analyzeTree(['AndroidManifest.xml', 'res/mipmap-xxxhdpi/ic_launcher.png']);
    assert.equal(legacy.isApp, true);
});

test('android: libraries with sample apps are not apps', () => {
    const lib = analyzeTree([
        'library/build.gradle', 'library/src/main/AndroidManifest.xml',
        'sample/src/main/AndroidManifest.xml', 'sample/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
        'ExampleApp/src/main/AndroidManifest.xml', 'ExampleApp/src/main/res/mipmap-hdpi/ic_launcher.png',
    ]);
    assert.equal(lib.isApp, false);
    assert.equal(analyzeTree(['README.md', 'index.html']).isApp, false);
});

test('android: package id resolution', () => {
    assert.equal(parseApplicationId('defaultConfig { applicationId "org.schabi.newpipe" }'), 'org.schabi.newpipe');
    assert.equal(parseApplicationId('applicationId = "com.termux"'), 'com.termux');
    // Fossify: applicationId = project.property("APP_ID") + gradle.properties
    assert.equal(parseApplicationId('applicationId = project.property("APP_ID").toString()', ['APP_ID=org.fossify.gallery']), 'org.fossify.gallery');
    // Constant defined elsewhere in the build file
    assert.equal(parseApplicationId('val APP_ID = "org.example.app"\napplicationId = APP_ID'), 'org.example.app');
    // Don't mistake method calls for package ids
    assert.equal(parseApplicationId('applicationId = signingPolicy.getProperty("x")', ['x = signingPolicy.getProperty("y")']), null);
    assert.equal(parseApplicationId('namespace = "dev.example.app"'), 'dev.example.app');
});

test('android: manifest, names and icon paths', () => {
    const m = parseManifest('<manifest package="a.b"><application android:icon="@mipmap/ic_app" android:roundIcon="@mipmap/ic_app_round" android:label="@string/app_name"></application></manifest>');
    assert.deepEqual(m, { package: 'a.b', icon: '@mipmap/ic_app', roundIcon: '@mipmap/ic_app_round', label: '@string/app_name' });

    assert.equal(tidyAppName('PaperKnife: Privacy-First PDF'), 'PaperKnife');
    assert.equal(tidyAppName('Fossify Notes Beta'), 'Fossify Notes');
    assert.equal(tidyAppName('&TERMUX_APP_NAME;'), null);

    const paths = [
        'app/src/main/res/mipmap-mdpi/ic_app.png',
        'app/src/main/res/mipmap-xxxhdpi/ic_app.png',
        'app/src/main/res/mipmap-xxxhdpi/ic_app_round.png',
        'app/src/debug/res/mipmap-xxxhdpi/ic_app.png',
        'app/src/main/ic_launcher-playstore.png',
    ];
    const module = { root: 'app', prefix: 'app/' };
    assert.deepEqual(launcherIconPaths(paths, module, m).slice(0, 3), [
        'app/src/main/ic_launcher-playstore.png',
        'app/src/main/res/mipmap-xxxhdpi/ic_app.png',
        'app/src/main/res/mipmap-mdpi/ic_app.png',
    ]);
    assert.deepEqual(storeIconPaths(['fastlane/metadata/android/de-DE/images/icon.png', 'fastlane/metadata/android/en-US/images/icon.png'])[0], 'fastlane/metadata/android/en-US/images/icon.png');
    assert.equal(genericLogoPaths(['docs/banner-logo.png', 'assets/icon.png', 'src/test/logo.png'])[0], 'assets/icon.png');
});

test('icons: validation rejects junk', async () => {
    const png = (w, h, color = '#3ddc84', alpha = 1) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 61, g: 220, b: 132, alpha } } })
        .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${w / 3}" fill="${color === '#3ddc84' ? '#123' : color}"/></svg>`) }])
        .png().toBuffer();
    assert.equal((await validate(await png(128, 128))).ok, true);
    assert.match((await validate(await png(16, 16))).reason, /too small/);
    assert.match((await validate(await png(600, 200))).reason, /not square/);
    assert.match((await validate(Buffer.from('../../res/mipmap-xxxhdpi/ic_launcher.png'))).reason, /empty|undecodable/);
    assert.match((await validate(Buffer.from('<!DOCTYPE html><html><body>Not Found</body></html>'.repeat(5)))).reason, /undecodable|format/);
    const transparent = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    assert.equal((await validate(transparent)).ok, false);
    assert.equal((await validate(Buffer.from(monogramSvg('Neo Launcher')))).ok, true);
});

test('icons: org avatars only when the org is the app', () => {
    assert.equal(ownerLooksLikeApp({ name: 'NewPipe', owner: { login: 'TeamNewPipe', type: 'Organization' } }), true);
    assert.equal(ownerLooksLikeApp({ name: 'tracker-control-android', owner: { login: 'TrackerControl', type: 'Organization' } }), true);
    assert.equal(ownerLooksLikeApp({ name: 'Gallery', owner: { login: 'FossifyOrg', type: 'Organization' } }), false);
    assert.equal(ownerLooksLikeApp({ name: 'Monica', owner: { login: 'JoyinJoester', type: 'User' } }), false);
});

test('discovery prefilter', () => {
    const known = { ids: new Set([1]), names: new Set(['a/listed']) };
    const repo = (o) => ({ id: 99, full_name: 'x/app', name: 'app', description: 'A nice music player for Android', topics: ['android'], stargazers_count: 500, license: { spdx_id: 'GPL-3.0' }, ...o });
    assert.equal(prefilter(repo({}), known), null);
    assert.match(prefilter(repo({ id: 1 }), known), /already/);
    assert.match(prefilter(repo({ license: null }), known), /license/);
    assert.match(prefilter(repo({ license: { spdx_id: 'NOASSERTION' } }), known), /license/);
    assert.match(prefilter(repo({ fork: true }), known), /fork/);
    assert.match(prefilter(repo({ topics: ['android-library'] }), known), /topic/);
    assert.match(prefilter(repo({ name: 'awesome-android' }), known), /name/);
    assert.match(prefilter(repo({ description: 'A Kotlin library for charts' }), known), /library/);
    assert.match(prefilter(repo({ description: 'A curated list of open source apps' }), known), /list/);
    assert.match(prefilter(repo({ description: 'Doujinshi reader' }), known), /nsfw/);
    // "library" as a feature word is fine
    assert.equal(prefilter(repo({ description: 'Manage your book library offline' }), known), null);
});

test('discovery picks the English half of bilingual descriptions', () => {
    assert.equal(pickDescription('手机本地运行 DeepSeek Agent | Run DeepSeek locally on Android'), 'Run DeepSeek locally on Android');
    assert.equal(pickDescription('An unofficial https://bgm.tv client'), 'An unofficial https://bgm.tv client');
});
