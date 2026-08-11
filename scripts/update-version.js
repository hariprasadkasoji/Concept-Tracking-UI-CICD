const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const versionPath = path.join(__dirname, '..', 'src', 'environments', 'version.ts');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

let [major, minor, patch] = packageJson.version.split('.').map(Number);
patch++;
const newVersion = `${major}.${minor}.${patch}`;
packageJson.version = newVersion;

fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

const buildNumber = process.env.GITHUB_RUN_NUMBER || 'local';
const date = new Date();
const buildDate = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;

const versionContent = `// AUTO-GENERATED at build time — do not edit, do not commit changes to this file
export const VERSION = {
  version: 'V${newVersion}',
  build: '${buildNumber}',
  date: '${buildDate}'
};
`;

fs.writeFileSync(versionPath, versionContent);
console.log(`✔ Version bumped to V${newVersion} (build ${buildNumber})`);