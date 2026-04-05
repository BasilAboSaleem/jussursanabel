const fs = require('fs');

function cleanJson(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        fs.writeFileSync(filePath, JSON.stringify(data, null, '\t') + '\n');
        console.log(`Successfully cleaned ${filePath}`);
    } catch (e) {
        console.error(`Error cleaning ${filePath}:`, e.message);
    }
}

cleanJson('locales/ar.json');
cleanJson('locales/en.json');
