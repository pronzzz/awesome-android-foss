const fs = require('fs');
const https = require('https');
const path = require('path');

const README_PATH = path.join(__dirname, '../README.md');
const ICONS_DIR = path.join(__dirname, '../assets/icons');

// Ensure icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
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
                // Handle redirects (GitHub often redirects avatars)
                downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
            } else {
                fs.unlink(filepath, () => { }); // Delete partial file
                reject(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
            }
        }).on('error', (err) => {
            fs.unlink(filepath, () => { });
            reject(err);
        });
    });
};

const updateIcons = async () => {
    let content = fs.readFileSync(README_PATH, 'utf8');

    // Regex to capture the app block
    // We look for the structure described: 
    // <img src="..." ... alt="..." />
    // <h3>Name</h3>
    // ...
    // <a href="LINK">

    // This regex is a bit complex. Let's iterate by finding <h3>Name</h3> and looking around it.
    // Or we can match the specific image tag we want to replace.

    // Strategy: Find all occurrences of the App Icon image tag.
    // Pattern: <img src="[^"]*"[^>]*alt="([^"]*)"[^>]*\/>\s*<h3>([^<]*)<\/h3>
    // We need to capture the name to find the link.
    // But the link comes AFTER.

    // NOTE: JS Regex doesn't support lookbehind well enough for variable length in all versions, 
    // but we can match the larger block.

    // Block: <div align="center">\s*<img src="([^"]+)"\s+width="64"\s+alt="([^"]+)"\s*/>\s*<h3>([^<]+)</h3>[\s\S]*?<a href="([^"]+)">

    // "g" flag to find all.
    const regex = /<div align="center">\s*<img src="([^"]+)"\s+width="64"\s+alt="([^"]+)"\s*\/>\s*<h3>([^<]+)<\/h3>[\s\S]*?<a href="([^"]+)">/g;

    let match;
    let newContent = content;
    const matches = [];

    while ((match = regex.exec(content)) !== null) {
        matches.push({
            fullMatch: match[0],
            currentIcon: match[1],
            altName: match[2],
            appName: match[3],
            link: match[4],
            index: match.index
        });
    }

    console.log(`Found ${matches.length} apps to process.`);

    for (const app of matches) {
        const { currentIcon, appName, link } = app;
        const safeName = appName.trim().replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const iconFilename = `${safeName}.png`;
        const localIconPath = `assets/icons/${iconFilename}`;
        const relativeIconPath = `assets/icons/${iconFilename}`; // For README

        // Skip if already a local asset (unless we force update, but let's assume we want to replace ui-avatars)
        // Check if currentIcon is from ui-avatars
        const isPlaceholder = currentIcon.includes('ui-avatars.com');

        let iconUrl = null;

        if (link.includes('github.com')) {
            // https://github.com/User/Repo
            const parts = link.split('github.com/')[1].split('/');
            if (parts.length >= 1) {
                const owner = parts[0];
                iconUrl = `https://github.com/${owner}.png`;
            }
        } else if (link.includes('f-droid.org')) {
            // https://f-droid.org/packages/package.id/ or similar
            // We can't easily guess the icon URL without scraping the page or knowing the package ID well.
            // If URL is https://f-droid.org/packages/org.example.app/
            // Icon is NOT guaranteed to be consistent, but often /repo/package/en-US/icon_512.png
            // Let's skip non-GitHub for now unless we can be clever.
            console.log(`Skipping F-Droid exclusive link for ${appName} (not implemented yet): ${link}`);
            continue; // fallback
        }

        if (iconUrl && isPlaceholder) {
            console.log(`Downloading icon for ${appName} from ${iconUrl}...`);
            try {
                await downloadImage(iconUrl, path.join(ICONS_DIR, iconFilename));

                // Replace in content
                // We restart regex match or just replace the string if unique?
                // The currentIcon string might be common if it's generic, but ui-avatars usually has name param.

                // Better approach: Perform replacement on the unique URL string.
                // "https://ui-avatars.com/api/?name=NetGuard"

                newContent = newContent.replace(currentIcon, relativeIconPath);
                console.log(`Updated ${appName} icon.`);
            } catch (err) {
                console.error(`Failed to update ${appName}:`, err.message);
            }
        } else if (!isPlaceholder) {
            // console.log(`App ${appName} already uses custom icon: ${currentIcon}`);
        }
    }

    fs.writeFileSync(README_PATH, newContent);
    console.log('README update complete.');
};

updateIcons();
