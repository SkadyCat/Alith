const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Create the directory
const dir = 'E:/docs-service/application/alith';
fs.mkdirSync(dir, {recursive:true});
console.log(`Directory created: ${dir}`);

// Run the create-alith.js script
console.log('\nRunning create-alith.js...');
execSync('node create-alith.js', { cwd: 'E:/docs-service', stdio: 'inherit' });
