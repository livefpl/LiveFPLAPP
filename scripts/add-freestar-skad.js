// Adds Freestar-supplied SKAdNetwork IDs into both Info.plist sources in app.json.
const fs = require('fs');
const path = require('path');

const APP_JSON = path.join(__dirname, '..', 'app.json');
const MISSING = [
  'apzhy3va96.skadnetwork',
  'f2zub97jtl.skadnetwork',
  'ns5j362hk7.skadnetwork',
  'sczv5946wb.skadnetwork',
  '5f5u5tfb26.skadnetwork',
  '77y3x8wds4.skadnetwork',
];

function normalize(id) {
  return String(id || '').trim().toLowerCase();
}

function toItems(ids) {
  return [...ids].sort().map((id) => ({ SKAdNetworkIdentifier: id }));
}

const app = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
const info = app.expo.ios.infoPlist;
const plugin = (app.expo.plugins || []).find(
  (p) => Array.isArray(p) && String(p[0]).includes('with-freestar-max')
);
if (!plugin || !plugin[1]) throw new Error('with-freestar-max plugin options missing');

const fromInfo = new Set((info.SKAdNetworkItems || []).map((e) => normalize(e.SKAdNetworkIdentifier)));
const fromPlugin = new Set((plugin[1].skadItems || []).map((e) => normalize(e.SKAdNetworkIdentifier)));
const added = [];
for (const id of MISSING) {
  const n = normalize(id);
  if (!fromInfo.has(n) || !fromPlugin.has(n)) added.push(n);
  fromInfo.add(n);
  fromPlugin.add(n);
}

info.SKAdNetworkItems = toItems(fromInfo);
plugin[1].skadItems = toItems(fromPlugin);
fs.writeFileSync(APP_JSON, JSON.stringify(app, null, 2) + '\n');
console.log('SKAd count infoPlist', info.SKAdNetworkItems.length, 'plugin', plugin[1].skadItems.length);
console.log('added', added.join(', ') || '(all already present)');
