'use strict';

// Thin GitHub/HTTP client built on the global fetch (Node 20+).
// Handles auth, retries, and secondary rate limits so the scripts never
// silently treat a 403 as "not found".

const API = 'https://api.github.com';
const UA = 'awesome-android-foss-bot (+https://github.com/pronzzz/awesome-android-foss)';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, { headers = {}, method = 'GET', timeout = 20000, retries = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
        let res;
        try {
            res = await fetch(url, {
                method,
                headers: { 'User-Agent': UA, ...headers },
                redirect: 'follow',
                signal: AbortSignal.timeout(timeout),
            });
        } catch (err) {
            if (attempt >= retries) throw err;
            await sleep(1000 * 2 ** attempt);
            continue;
        }

        const limited = res.status === 429 ||
            (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') ||
            (res.status === 403 && res.headers.get('retry-after'));
        if (limited && attempt < retries) {
            const retryAfter = Number(res.headers.get('retry-after'));
            const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
            const wait = retryAfter ? retryAfter * 1000 : Math.max(reset - Date.now(), 1000);
            if (wait > 5 * 60 * 1000) throw new Error(`Rate limited for ${Math.round(wait / 60000)} min on ${url}`);
            console.warn(`  rate limited, waiting ${Math.ceil(wait / 1000)}s`);
            await sleep(wait + 500);
            continue;
        }
        if (res.status >= 500 && attempt < retries) {
            await sleep(1000 * 2 ** attempt);
            continue;
        }
        return res;
    }
}

function apiHeaders() {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
    return h;
}

/** GET a GitHub API path. Returns parsed JSON, or null on 404/409/451. */
async function api(path, params) {
    const url = new URL(path.startsWith('http') ? path : API + path);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await request(url, { headers: apiHeaders() });
    if ([404, 409, 410, 451].includes(res.status)) return null;
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url.pathname}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

const getRepo = (fullName) => api(`/repos/${fullName}`);
const getRepoById = (id) => api(`/repositories/${id}`);

async function getTree(fullName, ref) {
    const data = await api(`/repos/${fullName}/git/trees/${encodeURIComponent(ref)}`, { recursive: '1' });
    if (!data || !Array.isArray(data.tree)) return { paths: [], truncated: false };
    return {
        paths: data.tree.filter((e) => e.type === 'blob').map((e) => e.path),
        // Symlinks are blobs too; raw.githubusercontent serves their target path as text.
        symlinks: new Set(data.tree.filter((e) => e.mode === '120000').map((e) => e.path)),
        truncated: Boolean(data.truncated),
    };
}

const rawUrl = (fullName, ref, path) =>
    `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Fetch a text file from the repo (raw host, does not use API quota). */
async function getRawText(fullName, ref, path, maxBytes = 512 * 1024) {
    const res = await request(rawUrl(fullName, ref, path));
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}

/** Fetch a binary resource, returns Buffer or null. */
async function getBuffer(url, maxBytes = 8 * 1024 * 1024) {
    try {
        const res = await request(url, { retries: 1 });
        if (!res.ok) return null;
        const len = Number(res.headers.get('content-length'));
        if (len && len > maxBytes) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length > maxBytes ? null : buf;
    } catch {
        return null;
    }
}

async function getJson(url) {
    try {
        const res = await request(url, { headers: { Accept: 'application/json' }, retries: 1 });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function searchRepos(q, { sort = 'stars', perPage = 50, page = 1 } = {}) {
    const data = await api('/search/repositories', { q, sort, order: 'desc', per_page: String(perPage), page: String(page) });
    return data ? data.items : [];
}

module.exports = { api, getRepo, getRepoById, getTree, getRawText, getBuffer, getJson, rawUrl, searchRepos, request, sleep, hasToken: Boolean(TOKEN) };
