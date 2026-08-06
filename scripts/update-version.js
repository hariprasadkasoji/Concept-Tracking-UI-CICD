const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const versionPath = path.join(__dirname, '..', 'src', 'environments', 'version.ts');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

let [major, minor, patch] = packageJson.version.split('.').map(Number);

patch++;

const newVersion = `${major}.${minor}.${patch}`;

packageJson.version = newVersion;

fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

const versionContent = `export const VERSION = {
  version: '${newVersion}'
};
`;

fs.writeFileSync(versionPath, versionContent);

console.log(`✔ Version updated to ${newVersion}`);