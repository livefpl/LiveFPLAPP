// EAS hook: iOS Ad Review (Quality Service) + copy native files for Freestar.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const REVIEW_DIR = path.join(ROOT, 'freestar-review');
const RUBY_URL =
  'https://artifacts.applovin.com/ios/com/applovin/quality/AppLovinQualityServiceSetup-ios.rb';

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log('[freestar] copied', path.relative(ROOT, from), '->', path.relative(ROOT, to));
  return true;
}

function exportReviewFiles() {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });

  copyIfExists(path.join(ROOT, 'ios', 'Podfile'), path.join(REVIEW_DIR, 'Podfile'));
  copyIfExists(path.join(ROOT, 'ios', 'Podfile.lock'), path.join(REVIEW_DIR, 'Podfile.lock'));
  copyIfExists(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    path.join(REVIEW_DIR, 'AndroidManifest.xml')
  );
  copyIfExists(path.join(ROOT, 'android', 'build.gradle'), path.join(REVIEW_DIR, 'build.gradle'));
  copyIfExists(
    path.join(ROOT, 'android', 'app', 'build.gradle'),
    path.join(REVIEW_DIR, 'app-build.gradle')
  );

  const iosDir = path.join(ROOT, 'ios');
  if (fs.existsSync(iosDir)) {
    const names = fs.readdirSync(iosDir);
    for (const name of names) {
      const plist = path.join(iosDir, name, 'Info.plist');
      if (fs.existsSync(plist)) {
        copyIfExists(plist, path.join(REVIEW_DIR, 'Info.plist'));
        break;
      }
    }
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`download failed ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => {
        try {
          file.close();
          fs.unlinkSync(dest);
        } catch {}
        reject(err);
      });
  });
}

async function runIosAdReview() {
  if (process.platform !== 'darwin') {
    console.log('[freestar] skip iOS Ad Review (not macOS)');
    return;
  }
  const iosDir = path.join(ROOT, 'ios');
  if (!fs.existsSync(iosDir)) {
    console.log('[freestar] skip iOS Ad Review (no ios/ folder)');
    return;
  }

  const rubyPath = path.join(iosDir, 'AppLovinQualityServiceSetup-ios.rb');
  try {
    await download(RUBY_URL, rubyPath);
    console.log('[freestar] downloaded iOS Ad Review script');
    const result = spawnSync('ruby', [rubyPath], {
      cwd: iosDir,
      stdio: 'inherit',
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.warn('[freestar] iOS Ad Review script exited', result.status);
    }
  } catch (e) {
    console.warn('[freestar] iOS Ad Review skipped:', e.message || e);
  } finally {
    try {
      if (fs.existsSync(rubyPath)) fs.unlinkSync(rubyPath);
    } catch {}
  }
}

async function main() {
  try {
    await runIosAdReview();
  } catch (e) {
    console.warn('[freestar] post-install Ad Review error:', e.message || e);
  }
  try {
    exportReviewFiles();
  } catch (e) {
    console.warn('[freestar] export review files error:', e.message || e);
  }
}

main();
