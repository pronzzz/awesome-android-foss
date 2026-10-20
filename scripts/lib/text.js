'use strict';

/** Stable id for a repo: "owner/Repo-Name" -> "owner--repo-name". Used for icon filenames. */
const repoId = (fullName) => fullName.toLowerCase().replace(/[^a-z0-9/]+/g, '-').replace('/', '--').replace(/^-+|-+$/g, '');

/** "talk-android" -> "Talk", "oss_weather" -> "Oss Weather", "NewPipe" stays. */
function humanizeRepoName(name) {
    let n = name
        .replace(/[-_.]?(android|app|apk|mobile|client|flutter)$/i, '')
        .replace(/^(android|app)[-_.]/i, '');
    if (!n) n = name;
    const spaced = n.replace(/[-_.]+/g, ' ').trim();
    // Only re-case names that are all lower-case; keep intentional casing like "NewPipe".
    return spaced === spaced.toLowerCase() ? spaced.replace(/\b\w/g, (c) => c.toUpperCase()) : spaced;
}

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Clean a GitHub description into one tidy sentence-ish line. */
function cleanDescription(raw, maxLen = 150) {
    if (!raw) return '';
    let d = String(raw)
        .replace(EMOJI, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/:[a-z0-9_+-]+:/g, '') // GitHub :shortcodes:
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/^[\s\-–—|:·•,.]+/, '')
        .replace(/[\s\-–—|:·•,]+$/, '')
        .trim();
    if (!d) return '';
    d = d[0].toUpperCase() + d.slice(1);
    if (d.length > maxLen) {
        const cut = d.slice(0, maxLen);
        const sentence = cut.lastIndexOf('. ');
        d = sentence > maxLen * 0.5 ? cut.slice(0, sentence + 1) : cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\-–— ]+$/, '') + '…';
    }
    if (!/[.!?…)]$/.test(d)) d += '.';
    return d;
}

function formatCount(n) {
    if (n == null) return '';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(n);
}

/** GitHub heading anchor (github-slugger rules): "🔒 Privacy & Security" -> "-privacy--security". */
const anchor = (title) => title.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');

const escapeCell = (s) => String(s).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ');

const today = () => new Date().toISOString().slice(0, 10);

module.exports = { repoId, humanizeRepoName, cleanDescription, formatCount, anchor, escapeCell, today };
