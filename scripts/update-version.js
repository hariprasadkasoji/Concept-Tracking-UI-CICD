const fs = require('fs');
const path = require('path');

const versionFile = path.join(
  __dirname,
  '../src/environments/version.ts'
);

let content = fs.readFileSync(versionFile, 'utf8');

const match = content.match(/version:\s*['"](\d+)\.(\d+)\.(\d+)['"]/);

if (!match) {
  throw new Error('Version not found in version.ts');
}

let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);

patch++;

const newVersion = `${major}.${minor}.${patch}`;

content = content.replace(
  /version:\s*['"]\d+\.\d+\.\d+['"]/,
  `version: '${newVersion}'`
);

fs.writeFileSync(versionFile, content);

console.log(`Version updated to ${newVersion}`);
