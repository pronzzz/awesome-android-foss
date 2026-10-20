'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render } = require('../scripts/build-readme');
const { loadApps, loadCategories } = require('../scripts/lib/data');
const { anchor } = require('../scripts/lib/text');

const { readme, stats } = render();

test('every app appears exactly once', () => {
    const apps = loadApps();
    assert.equal(stats.apps, apps.length);
    for (const a of apps) {
        const url = a.repo ? `https://github.com/${a.repo}` : a.homepage || a.source;
        const rows = readme.split('\n').filter((l) => l.startsWith('| ') && l.includes(`](${url})`));
        assert.equal(rows.length, 1, `${a.name || a.repo} should have exactly one table row`);
    }
});

test('table of contents links resolve to headings', () => {
    const headings = new Set([...readme.matchAll(/^## (.+)$/gm)].map((m) => anchor(m[1])));
    const links = [...readme.split('## Contents')[1].split('\n## ')[0].matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(links.length >= loadCategories().length / 2);
    for (const l of links) assert.ok(headings.has(l), `ToC link #${l} has no heading`);
});

test('every referenced icon exists', () => {
    for (const [, src] of readme.matchAll(/<img src="(assets\/[^"]+)"/g)) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', src)), `${src} is missing`);
    }
});

test('no template placeholders left', () => {
    assert.doesNotMatch(readme, /\{\{\w+\}\}/);
});

test('table rows have four cells', () => {
    for (const line of readme.split('\n').filter((l) => l.startsWith('| <img'))) {
        const cells = line.replace(/\\\|/g, '').split('|').length - 2;
        assert.equal(cells, 4, line.slice(0, 120));
    }
});
