// Merge official Unity / AppLovin / Liftoff(Vungle) SKAdNetwork IDs into app.json.
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const APP_JSON = path.join(ROOT, 'app.json');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location).then(resolve, reject);
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`${url} ${res.statusCode}`));
          resolve(data);
        });
      })
      .on('error', reject);
  });
}

function normalize(id) {
  return String(id || '')
    .trim()
    .toLowerCase();
}

function collectFromUnknown(json) {
  const ids = [];
  const walk = (node) => {
    if (!node) return;
    if (typeof node === 'string' && /\.(skadnetwork|adattributionkit)$/i.test(node)) {
      ids.push(normalize(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      if (node.SKAdNetworkIdentifier) ids.push(normalize(node.SKAdNetworkIdentifier));
      if (node.skadnetwork_id) ids.push(normalize(node.skadnetwork_id));
      if (node.skadnetworkid) ids.push(normalize(node.skadnetworkid));
      Object.values(node).forEach(walk);
    }
  };
  walk(json);
  return ids;
}

async function main() {
  const app = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
  const plugin = (app.expo.plugins || []).find(
    (p) => Array.isArray(p) && String(p[0]).includes('with-freestar-max')
  );
  if (!plugin || !plugin[1]) throw new Error('with-freestar-max plugin options missing');

  const existing = (plugin[1].skadItems || []).map((e) => normalize(e.SKAdNetworkIdentifier)).filter(Boolean);

  const sources = await Promise.allSettled([
    get('https://skan.mz.unity3d.com/v3/partner/skadnetworks.plist.json').then(JSON.parse),
    get('https://skadnetwork-ids.applovin.com/v1/skadnetworkids.json').then(JSON.parse),
    get('https://vungle.com/skadnetworkids.json').then(JSON.parse),
  ]);

  const extra = [
    '5f5u5tfb26.skadnetwork',
    '77y3x8wds4.skadnetwork',
    'gta8lk7p23.skadnetwork',
    'gta9lk7p23.skadnetwork',
    '7ug5zh24hu.skadnetwork',
    '4dzt52r2t5.skadnetwork',
  ];

  const merged = new Set(existing);
  extra.forEach((id) => merged.add(normalize(id)));
  sources.forEach((result, i) => {
    if (result.status !== 'fulfilled') {
      console.warn('source failed', i, result.reason?.message || result.reason);
      return;
    }
    collectFromUnknown(result.value).forEach((id) => merged.add(id));
  });

  const sorted = [...merged].filter(Boolean).sort();
  const items = sorted.map((id) => ({ SKAdNetworkIdentifier: id }));
  plugin[1].skadItems = items;

  app.expo.ios = app.expo.ios || {};
  app.expo.ios.infoPlist = app.expo.ios.infoPlist || {};
  app.expo.ios.infoPlist.SKAdNetworkItems = items;

  fs.writeFileSync(APP_JSON, JSON.stringify(app, null, 2) + '\n');
  console.log('SKAdNetwork IDs:', existing.length, '->', sorted.length);
  console.log(
    'added',
    sorted.filter((id) => !existing.includes(id)).join('\n')
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
