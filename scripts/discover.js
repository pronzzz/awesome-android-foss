const fs = require('fs');
const https = require('https');

const GITHUB_API_URL = 'https://api.github.com/search/repositories';
// Search for android apps, open source, sorted by stars, created in the last 30 days (approx)
const QUERY = 'android topic:android topic:open-source -topic:library -topic:sdk stars:>50';

const performRequest = (path) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: path,
            method: 'GET',
            headers: {
                'User-Agent': 'Awesome-Android-App-Discoverer',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
};

const main = async () => {
    try {
        const searchParams = new URLSearchParams({
            q: QUERY,
            sort: 'updated',
            order: 'desc',
            per_page: 10
        });

        const response = await performRequest(`/search/repositories?${searchParams.toString()}`);

        if (!response.items) {
            console.error('No items found or API error:', response);
            return;
        }

        let markdownOutput = `# 🕵️ Monthly App Discoveries\n\nGenerated on: ${new Date().toISOString().split('T')[0]}\n\n`;

        response.items.forEach(repo => {
            markdownOutput += `<div style="display: flex; align-items: center;">\n`;
            markdownOutput += `  <img src="${repo.owner.avatar_url}" width="64" height="64" style="margin-right: 15px; border-radius: 10px;" alt="${repo.name} icon" />\n`;
            markdownOutput += `  <div>\n`;
            markdownOutput += `    <h2><a href="${repo.html_url}">${repo.name}</a></h2>\n`;
            markdownOutput += `    <p><strong>Stars:</strong> ${repo.stargazers_count} | <strong>Language:</strong> ${repo.language || 'N/A'} | <strong>License:</strong> ${repo.license ? repo.license.spdx_id : 'Unknown'}</p>\n`;
            markdownOutput += `  </div>\n`;
            markdownOutput += `</div>\n\n`;
            markdownOutput += `${repo.description}\n\n`;
            markdownOutput += `---\n\n`;
        });

        fs.writeFileSync('DISCOVERIES.md', markdownOutput);
        console.log('DISCOVERIES.md generated successfully.');

    } catch (error) {
        console.error('Error discovering apps:', error);
        process.exit(1);
    }
};

main();
