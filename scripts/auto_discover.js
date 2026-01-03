const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const README_PATH = path.join(__dirname, '../README.md');
const ICONS_DIR = path.join(__dirname, '../assets/icons');
const GITHUB_API = 'https://api.github.com';

// Configuration
const REPOS_TO_FIND = 3; // Limit to adding 3 new apps per run to avoid overwhelming the repo
const SEARCH_QUERY = 'topic:android topic:open-source stars:>100 pushed:>2024-01-01'; // Ensure somewhat popular and active

// Headers for GitHub API
const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Awesome-Android-FOSS-Discoverer'
};

if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
}

// ensure assets dir exists
if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
}

async function searchRepos() {
    console.log('Searching for new apps...');
    try {
        const { data } = await axios.get(`${GITHUB_API}/search/repositories`, {
            headers,
            params: {
                q: SEARCH_QUERY,
                sort: 'updated', // Get recently updated
                order: 'desc',
                per_page: 30 // Fetch more to filter out existing ones
            }
        });
        return data.items;
    } catch (error) {
        console.error('Error searching repos:', error.message);
        return [];
    }
}

function getExistingRepos(html) {
    const $ = cheerio.load(html);
    const urls = new Set();
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('github.com')) {
            urls.add(href.toLowerCase().replace(/\/$/, '')); // Normalize
        }
    });
    return urls;
}

function determineCategory(repo) {
    const text = (repo.description + ' ' + (repo.topics || []).join(' ')).toLowerCase();

    if (text.match(/launcher|home screen|desktop/)) return 'Launchers';
    if (text.match(/privacy|firewall|tracker|blocker|security|password|authentication/)) return 'Privacy';
    if (text.match(/video|music|player|stream|youtube|gallery|photo|image|audio/)) return 'Media';

    // Default to System for tools/utilities/other
    return 'System';
}

async function findIconUrl(repo) {
    // Try potential paths in order
    const branches = [repo.default_branch, 'master', 'main', 'dev'];
    const paths = [
        'fastlane/metadata/android/en-US/images/icon.png',
        'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
        'app/src/main/res/drawable-xxxhdpi/ic_launcher.png',
        'app/src/main/ic_launcher-web.png',
        'play_store/icon.png',
        'images/icon.png',
        'icon.png',
        'logo.png',
    ];

    for (const branch of branches) {
        for (const p of paths) {
            const url = `https://raw.githubusercontent.com/${repo.full_name}/${branch}/${p}`;
            try {
                await axios.head(url);
                return url;
            } catch (e) {
                // ignore
            }
        }
    }

    // Fallback: Owner avatar
    return repo.owner.avatar_url;
}

const downloadImage = (url, filepath) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            } else if (response.statusCode === 301 || response.statusCode === 302) {
                downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
            } else {
                fs.unlink(filepath, () => { });
                reject(new Error(`Status ${response.statusCode}`));
            }
        }).on('error', (err) => {
            fs.unlink(filepath, () => { });
            reject(err);
        });
    });
};

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function main() {
    const readmeContent = fs.readFileSync(README_PATH, 'utf8');
    const existingUrls = getExistingRepos(readmeContent);
    const items = await searchRepos();

    let addedCount = 0;

    // Parse partials from logic
    // Refactor to ensure we work on updated content
    let currentReadme = readmeContent;

    for (const repo of items) {
        if (addedCount >= REPOS_TO_FIND) break;
        if (existingUrls.has(repo.html_url.toLowerCase())) continue;
        if (existingUrls.has(repo.homepage && repo.homepage.toLowerCase())) continue; // Check homepage too if it's a github link

        console.log(`Analyzing candidate: ${repo.name}`);

        const category = determineCategory(repo);
        console.log(`Category: ${category}`);

        // Download Icon
        const iconUrl = await findIconUrl(repo);
        const iconName = repo.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.png';
        const localIconPath = path.join(ICONS_DIR, iconName);

        try {
            console.log(`Downloading icon from ${iconUrl}`);
            await downloadImage(iconUrl, localIconPath);
        } catch (e) {
            console.error(`Failed to download icon for ${repo.name}, skipping. Error: ${e.message}`);
            continue;
        }

        // Construct HTML Snippet
        // We match the style:
        /*
        <td width="33%">
          <div align="center">
            <img src="assets/icons/name.png" width="64" alt="Name" />
            <h3>Name</h3>
            <code>[Tag]</code>
            <br/>
            <p>Description</p>
            <a href="URL">
                <img src="https://img.shields.io/badge/Get%20it-F--Droid-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Get it on F-Droid">
            </a>
          </div>
        </td>
        */

        // Shorten description
        let desc = repo.description || 'No description available.';
        if (desc.length > 60) desc = desc.substring(0, 57) + '...';
        desc = escapeHtml(desc);

        const newCellHtml = `
<td width="33%">
  <div align="center">
    <img src="assets/icons/${iconName}" width="64" alt="${escapeHtml(repo.name)}" />
    <h3>${escapeHtml(repo.name)}</h3>
    <code>[${category.toUpperCase()}]</code>
    <br/>
    <p>${desc}</p>
    <a href="${repo.html_url}">
        <img src="https://img.shields.io/badge/Source-GitHub-black?style=for-the-badge&logo=github&logoColor=white" alt="Source on GitHub">
    </a>
  </div>
</td>`;

        // Find the right section
        // We look for <summary> content containing the category name/emoji
        // Privacy -> 🔒 Privacy
        // Media -> ▶️ Media
        // System -> ⚙️ System
        // Launchers -> 🚀 Launchers

        let sectionRegex;
        if (category === 'Privacy') sectionRegex = /(<summary>.*?Privacy.*?<\/summary>[\s\S]*?<table[^>]*>)([\s\S]*?)(<\/table>)/;
        else if (category === 'Media') sectionRegex = /(<summary>.*?Media.*?<\/summary>[\s\S]*?<table[^>]*>)([\s\S]*?)(<\/table>)/;
        else if (category === 'Launchers') sectionRegex = /(<summary>.*?Launchers.*?<\/summary>[\s\S]*?<table[^>]*>)([\s\S]*?)(<\/table>)/;
        else sectionRegex = /(<summary>.*?System.*?<\/summary>[\s\S]*?<table[^>]*>)([\s\S]*?)(<\/table>)/;

        const match = currentReadme.match(sectionRegex);
        if (match) {
            const tableContent = match[2];
            // Count <td>s in the last <tr>. This logic was simplified in the instruction.
            // The instruction provided a more robust way to rebuild the table body.
            const allCells = tableContent.match(/<td[\s\S]*?<\/td>/g) || [];
            const realCells = allCells.filter(c => !c.includes('<!-- Empty cell'));
            realCells.push(newCellHtml);

            let newTableBody = '';
            for (let i = 0; i < realCells.length; i += 3) {
                newTableBody += '<tr>\n';
                newTableBody += realCells[i] + '\n';

                // Cell 2
                if (i + 1 < realCells.length) {
                    newTableBody += realCells[i + 1] + '\n';
                } else {
                    newTableBody += '<td width="33%">\n  <!-- Empty cell to maintain grid -->\n</td>\n';
                }

                // Cell 3
                if (i + 2 < realCells.length) {
                    newTableBody += realCells[i + 2] + '\n';
                } else {
                    newTableBody += '<td width="33%">\n  <!-- Empty cell to maintain grid -->\n</td>\n';
                }

                newTableBody += '</tr>\n';
            }

            const replacement = match[1] + '\n' + newTableBody + match[3];
            const startIndex = match.index;
            const endIndex = startIndex + match[0].length;

            currentReadme = currentReadme.substring(0, startIndex) + replacement + currentReadme.substring(endIndex);

            fs.writeFileSync(README_PATH, currentReadme);
            console.log(`Added ${repo.name} to ${category}`);
            addedCount++;
        } else {
            console.log(`Could not find section for category: ${category}`);
        }
    }

    if (addedCount === 0) {
        console.log('No new apps added.');
    }
}

main();
