const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const README_PATH = path.join(__dirname, '../README.md');
const ICONS_DIR = path.join(__dirname, '../assets/icons');

// Ensure icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
}

const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode >= 200 && response.statusCode < 300) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(() => resolve(true));
                });
            } else if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
            } else {
                fs.unlink(dest, () => { });
                reject(new Error(`Status Code: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
};

const getGithubIconUrl = async (repoUrl) => {
    // repoUrl: https://github.com/owner/repo
    const parts = repoUrl.split('/');
    const owner = parts[3];
    const repo = parts[4];

    const possiblePaths = [
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`,
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/app/src/main/res/drawable-xxxhdpi/ic_launcher.png`,
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/app/src/main/res/mipmap-xxhdpi/ic_launcher.png`,
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/fastlane/metadata/android/en-US/images/icon.png`,
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/icon.png`,
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/logo.png`,
        `https://github.com/${owner}/${repo}/raw/HEAD/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` // sometimes raw url works better
    ];

    for (const url of possiblePaths) {
        try {
            // Check if valid image (HEAD request or small GET)
            // We'll just try to fetch it in the main loop, doing a HEAD check is better but node https is verbose.
            // We can do a quick probe.
            const isValid = await new Promise(resolve => {
                const req = https.request(url, { method: 'HEAD' }, res => {
                    if (res.statusCode === 200 && res.headers['content-type']?.startsWith('image')) resolve(true);
                    else resolve(false);
                });
                req.on('error', () => resolve(false));
                req.end();
            });

            if (isValid) return url;
        } catch (e) {
            continue;
        }
    }
    return null;
};

const main = async () => {
    let readmeContent = fs.readFileSync(README_PATH, 'utf8');

    // Regex to capture app blocks
    // This is tricky with simple regex, but let's try to match the repetitive structure
    // <div align="center"> ... <img src="(...)" ... <h3>(...)</h3> ... <a href="(...)">

    // We will look for img src="https://ui-avatars.com..." and then look for the corresponding link
    // We iterate line by line or block by block for safety

    const lines = readmeContent.split('\n');
    let updatedReadme = readmeContent;
    let modified = false;

    // A simple parsing state machine
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('src="https://ui-avatars.com')) {
            // Found a placeholder
            // Look ahead for name and link
            let name = null;
            let link = null;

            // Check next few lines
            for (let j = 1; j < 10; j++) {
                if (lines[i + j].includes('<h3>')) {
                    name = lines[i + j].match(/<h3>(.*?)<\/h3>/)[1];
                }
                if (lines[i + j].includes('<a href="')) {
                    link = lines[i + j].match(/href="(.*?)"/)[1];
                    break; // Found link, stop
                }
            }

            if (name && link) {
                console.log(`Processing ${name} (${link})...`);
                const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const iconFilename = `${slug}.png`;
                const localIconPath = path.join(ICONS_DIR, iconFilename);
                const relativeIconPath = `assets/icons/${iconFilename}`;

                let iconUrl = null;

                if (link.includes('github.com')) {
                    iconUrl = await getGithubIconUrl(link);
                }

                if (!iconUrl) {
                    // Fallback to Google Favicon
                    const domain = new URL(link).hostname;
                    iconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
                }

                if (iconUrl) {
                    console.log(`Downloading icon from ${iconUrl}...`);
                    try {
                        await downloadFile(iconUrl, localIconPath);
                        // Update README line
                        lines[i] = lines[i].replace(/src="https:\/\/ui-avatars\.com[^"]*"/, `src="${relativeIconPath}"`);
                        modified = true;
                        console.log(`Icon updated for ${name}`);
                    } catch (err) {
                        console.error(`Failed to download icon for ${name}: ${err.message}`);
                    }
                } else {
                    console.log(`Could not find icon source for ${name}`);
                }
            }
        }
    }

    if (modified) {
        fs.writeFileSync(README_PATH, lines.join('\n'));
        console.log('README.md updated with new icons.');
    } else {
        console.log('No icons updated.');
    }
};

main();
