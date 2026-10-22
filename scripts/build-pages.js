const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const partial = fs.readFileSync(path.join(root, 'partials', 'donation-form.html'), 'utf8').trim();
const pages = [
  'donate.html',
  'monthly-donation-child-education.html',
];
const startMarker = '<!-- DONATION_FORM_START -->';
const endMarker = '<!-- DONATION_FORM_END -->';

for (const page of pages) {
  const filePath = path.join(root, page);
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Donation form markers are missing or out of order in ${page}`);
  }

  const before = source.slice(0, start + startMarker.length);
  const after = source.slice(end);
  fs.writeFileSync(filePath, `${before}\n${partial}\n  ${after}`);
}
