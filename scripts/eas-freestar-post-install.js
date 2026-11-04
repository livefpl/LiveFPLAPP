// EAS hook: iOS Ad Review from the committed Freestar script + copy native review files.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const REVIEW_DIR = path.join(ROOT, 'freestar-review');
const SCRIPT_NAME = 'AppLovinQualityServiceSetup-ios.rb';

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

function runIosAdReview() {
  if (process.env.EAS_BUILD_PLATFORM && process.env.EAS_BUILD_PLATFORM !== 'ios') {
    console.log('[freestar] skip iOS Ad Review (platform', process.env.EAS_BUILD_PLATFORM, ')');
    return;
  }
  if (process.platform !== 'darwin') {
    console.log('[freestar] skip iOS Ad Review (not macOS)');
    return;
  }

  const iosDir = path.join(ROOT, 'ios');
  const src = path.join(ROOT, SCRIPT_NAME);
  if (!fs.existsSync(src)) {
    console.warn('[freestar] skip iOS Ad Review (missing', SCRIPT_NAME, 'in project root)');
    return;
  }
  if (!fs.existsSync(iosDir)) {
    console.log('[freestar] skip iOS Ad Review (no ios/ folder yet; config plugin will run it during prebuild)');
    return;
  }

  const dest = path.join(iosDir, SCRIPT_NAME);
  fs.copyFileSync(src, dest);
  console.log('[freestar] running iOS Ad Review setup');
  const result = spawnSync('ruby', [dest], {
    cwd: iosDir,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`iOS Ad Review script exited ${result.status}`);
  }
}

function main() {
  try {
    runIosAdReview();
  } catch (e) {
    console.warn('[freestar] post-install Ad Review error:', e.message || e);
    if (process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'ios') {
      throw e;
    }
  }
  try {
    exportReviewFiles();
  } catch (e) {
    console.warn('[freestar] export review files error:', e.message || e);
  }
}

main();
