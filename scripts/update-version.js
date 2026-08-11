const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const versionPath = path.join(__dirname, '..', 'src', 'environments', 'version.ts');

function getGitVersion() {
  try {
    return execSync('git describe --tags --always --dirty', { encoding: 'utf8' }).trim();
  } catch (err) {
    console.warn('⚠ Could not read git info, falling back to "dev"');
    return 'dev';
  }
}

const buildNumber = process.env.GITHUB_RUN_NUMBER || 'local';
const version = getGitVersion();
const buildDate = new Date().toISOString();

const versionContent = `// AUTO-GENERATED at build time — do not edit, do not commit changes to this file
export const VERSION = {
  version: '${version}',
  build: '${buildNumber}',
  date: '${buildDate}'
};
`;

fs.writeFileSync(versionPath, versionContent);
console.log(`✔ version.ts generated: ${version} (build ${buildNumber})`);