const fs = require('fs');
const https = require('https');

const GITHUB_API_URL = 'https://api.github.com/search/repositories';
// Search for android apps, open source, sorted by stars, created in the last 30 days (approx)
const QUERY = 'topic:android topic:open-source NOT topic:library NOT topic:sdk stars:>50';

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
      markdownOutput += `## [${repo.name}](${repo.html_url})\n`;
      markdownOutput += `**Stars:** ${repo.stargazers_count} | **Language:** ${repo.language || 'N/A'} | **License:** ${repo.license ? repo.license.spdx_id : 'Unknown'}\n\n`;
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
