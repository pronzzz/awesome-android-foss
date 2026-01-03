const fs = require('fs');
const path = require('path');

const README_PATH = path.join(__dirname, '../README.md');
const STATS_PATH = path.join(__dirname, '../data/stats.json');

const main = () => {
    try {
        const readmeContent = fs.readFileSync(README_PATH, 'utf8');

        // Count occurrences of app categories as a proxy for app count
        // Pattern: <code>[...]</code>
        const appMatches = readmeContent.match(/<code>\[.*?\]<\/code>/g);
        const appCount = appMatches ? appMatches.length : 0;

        console.log(`Found ${appCount} apps in README.md`);

        const stats = {
            apps: appCount
        };

        fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
        console.log('Updated stats.json');

    } catch (error) {
        console.error('Error updating stats:', error);
        process.exit(1);
    }
};

main();
