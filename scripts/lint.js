// Minimal stand-in for a linter: fails on tabs or trailing whitespace in src/.
const fs = require('fs'); const path = require('path');
let bad = 0;
for (const f of fs.readdirSync('src')) {
  const lines = fs.readFileSync(path.join('src', f), 'utf8').split('\n');
  lines.forEach((l, i) => { if (/\t|[ ]+$/.test(l)) { console.error(`${f}:${i + 1}: tab or trailing whitespace`); bad++; } });
}
process.exit(bad ? 1 : 0);
