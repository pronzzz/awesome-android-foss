'use strict';

// Weighted keyword classifier. Every category keyword is matched on word
// boundaries against topics (x3), the repo/app name (x2) and the description
// (x1); "!"-prefixed keywords count double. The highest score wins, with the
// category order in categories.yml as the tie-breaker.

const FALLBACK = 'utilities';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(categories) {
    return categories.map((c) => ({
        id: c.id,
        rules: (c.keywords || []).map((k) => {
            const strong = k.startsWith('!');
            const phrase = (strong ? k.slice(1) : k).toLowerCase().trim();
            // "-" and " " are interchangeable so "music player" matches the topic "music-player".
            const body = phrase.split(/[\s-]+/).map(escapeRe).join('[\\s_-]+');
            return { phrase, weight: strong ? 2 : 1, re: new RegExp(`(^|[^a-z0-9])${body}s?(?=$|[^a-z0-9])`, 'i') };
        }),
    }));
}

const normalize = (s) => (s || '').toLowerCase().replace(/[_]+/g, ' ');

function score(compiled, { topics = [], name = '', description = '' }) {
    const fields = [
        [topics.map(normalize).join(' | '), 3],
        [normalize(name).replace(/[-.]+/g, ' '), 2],
        [normalize(description), 1],
    ];
    return compiled.map((c, order) => {
        let total = 0;
        const hits = [];
        for (const rule of c.rules) {
            let best = 0;
            for (const [text, mult] of fields) if (text && rule.re.test(text)) best = Math.max(best, mult);
            if (best) {
                total += rule.weight * best;
                hits.push(rule.phrase);
            }
        }
        return { id: c.id, score: total, hits, order };
    }).sort((a, b) => b.score - a.score || a.order - b.order);
}

function classify(categories, repo) {
    const ranked = score(compile(categories), repo);
    const top = ranked[0];
    // Weak signal, or an all-in-one app that ties across 3+ categories -> utilities.
    const ties = ranked.filter((r) => r.score === top.score).length;
    const category = top && top.score >= 2 && ties < 3 ? top.id : FALLBACK;
    return { category, ranked };
}

module.exports = { classify, score, compile, FALLBACK };
