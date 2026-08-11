const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const versionPath = path.join(__dirname, '..', 'src', 'environments', 'version.ts');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const buildDate = new Date();
const formattedDate = `${String(buildDate.getMonth() + 1).padStart(2, '0')}/${String(buildDate.getDate()).padStart(2, '0')}/${buildDate.getFullYear()}`;

const versionContent = `// AUTO-GENERATED at build time — do not edit, do not commit changes to this file
export const VERSION = {
  version: 'V${packageJson.version}-local',
  build: 'local',
  date: '${formattedDate}'
};
`;

fs.writeFileSync(versionPath, versionContent);
console.log(`✔ version.ts generated: V${packageJson.version}-local`);