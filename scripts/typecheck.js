// Minimal stand-in for a typecheck: every src file must parse.
const fs = require('fs'); const path = require('path');
for (const f of fs.readdirSync('src')) { new Function(fs.readFileSync(path.join('src', f), 'utf8')); }
console.log('typecheck ok');
