// plugins/with-freestar-max.js
// Expo config plugin for the Freestar / AppLovin MAX test build.
const {
  withInfoPlist,
  withAndroidManifest,
  withDangerousMod,
  withProjectBuildGradle,
  withAppBuildGradle,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const IOS_ADAPTER_PODS = [
  "pod 'AppLovinMediationGoogleAdManagerAdapter'",
  "pod 'AppLovinMediationGoogleAdapter'",
  "pod 'AppLovinMediationFyberAdapter'",
  "pod 'AppLovinMediationInMobiAdapter'",
  "pod 'AppLovinMediationVungleAdapter'",
  "pod 'AppLovinMediationFacebookAdapter'",
  "pod 'AppLovinMediationOguryPresageAdapter'",
  "pod 'AppLovinMediationUnityAdsAdapter'",
];

const ANDROID_ADAPTER_DEPS = [
  "implementation 'com.applovin.mediation:google-ad-manager-adapter:24.7.0.0'",
  "implementation 'com.applovin.mediation:google-adapter:24.7.0.0'",
  "implementation 'com.applovin.mediation:fyber-adapter:+'",
  "implementation 'com.applovin.mediation:inmobi-adapter:+'",
  "implementation 'com.squareup.picasso:picasso:2.8'",
  "implementation 'androidx.recyclerview:recyclerview:1.1.0'",
  "implementation 'com.applovin.mediation:vungle-adapter:+'",
  "implementation 'com.applovin.mediation:facebook-adapter:+'",
  "implementation 'com.applovin.mediation:ogury-presage-adapter:5.8.0.0'",
  "implementation 'com.applovin.mediation:unityads-adapter:+'",
];

const withFreestarMax = (config, options = {}) => {
  const extra = (config.extra && config.extra.freestar) || {};
  const opts = { ...extra, ...options };

  const gadIos = opts.gadApplicationId || 'ca-app-pub-8061946413537984~4171878940';
  const gadAndroid = opts.androidApplicationId || 'ca-app-pub-8061946413537984~5484960613';
  const adReviewKey =
    opts.androidAdReviewKey ||
    'CATKx497wlO3DsbMGWxBITQg_OqT7XXdI_Zw_NLFriX9yVSAWdEK9wbnpqK0c3rI5ezOZzGVw7J7RTJtdAzwUZ';

  config = withInfoPlist(config, (c) => {
    const info = c.modResults;
    info.GADApplicationIdentifier = gadIos;
    info.GADIsAdManagerApp = true;

    if (Array.isArray(opts.skadItems) && opts.skadItems.length) {
      const existing = Array.isArray(info.SKAdNetworkItems) ? info.SKAdNetworkItems : [];
      const existingIds = new Set(existing.map((e) => e.SKAdNetworkIdentifier));
      const toAdd = opts.skadItems.filter(
        (e) => e && e.SKAdNetworkIdentifier && !existingIds.has(e.SKAdNetworkIdentifier)
      );
      info.SKAdNetworkItems = [...existing, ...toAdd];
    }
    return c;
  });

  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (!app) return c;
    app['meta-data'] = app['meta-data'] || [];

    const ensureMeta = (name, value) => {
      const node = app['meta-data'].find((m) => m.$['android:name'] === name);
      if (node) {
        node.$['android:value'] = String(value);
      } else {
        app['meta-data'].push({
          $: { 'android:name': name, 'android:value': String(value) },
        });
      }
    };

    ensureMeta('com.google.android.gms.ads.AD_MANAGER_APP', 'true');
    ensureMeta('com.google.android.gms.ads.APPLICATION_ID', gadAndroid);
    return c;
  });

  config = withDangerousMod(config, [
    'ios',
    async (c) => {
      const podfilePath = path.join(c.modRequest.platformProjectRoot, 'Podfile');
      let contents = await fs.promises.readFile(podfilePath, 'utf8');
      const targetRegex = /target ['"][^'"]+['"] do/;

      const ensurePodInFirstTarget = (podLine) => {
        if (contents.includes(podLine)) return;
        if (!targetRegex.test(contents)) return;
        contents = contents.replace(targetRegex, (match) => `${match}\n  ${podLine}`);
      };

      IOS_ADAPTER_PODS.forEach(ensurePodInFirstTarget);
      await fs.promises.writeFile(podfilePath, contents, 'utf8');

      if (process.platform === 'darwin') {
        await runIosAdReview(c.modRequest.platformProjectRoot);
      }
      return c;
    },
  ]);

  config = withProjectBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') return c;
    let contents = c.modResults.contents;

    if (!contents.includes('artifacts.applovin.com')) {
      const buildscriptRepos = /buildscript\s*\{[\s\S]*?repositories\s*\{/;
      if (buildscriptRepos.test(contents)) {
        contents = contents.replace(buildscriptRepos, (match) => {
          return `${match}\n        maven { url 'https://artifacts.applovin.com/android' }`;
        });
      }
    }

    if (!contents.includes('AppLovinQualityServiceGradlePlugin')) {
      const buildscriptDeps = /buildscript\s*\{[\s\S]*?dependencies\s*\{/;
      if (buildscriptDeps.test(contents)) {
        contents = contents.replace(buildscriptDeps, (match) => {
          return `${match}\n        classpath "com.applovin.quality:AppLovinQualityServiceGradlePlugin:+"`;
        });
      }
    }

    c.modResults.contents = contents;
    return c;
  });

  config = withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') return c;
    let contents = c.modResults.contents;

    if (!contents.includes('com.applovin.mediation:google-adapter')) {
      const depsMatch = contents.match(/dependencies\s*\{/);
      if (depsMatch) {
        const insert = ANDROID_ADAPTER_DEPS.map((line) => `    ${line}`).join('\n');
        contents = contents.replace(/dependencies\s*\{/, `dependencies {\n${insert}`);
      }
    }

    if (!contents.includes('applovin-quality-service')) {
      contents += `

apply plugin: 'applovin-quality-service'
applovin {
    apiKey "${adReviewKey}"
}
`;
    }

    if (!contents.includes("androidx.browser:browser:1.8.0")) {
      contents += `

configurations.all {
    resolutionStrategy {
        force 'androidx.browser:browser:1.8.0'
        force 'com.google.android.gms:play-services-ads:24.7.0'
        force 'com.google.android.gms:play-services-ads-lite:24.7.0'
    }
}
`;
    }

    c.modResults.contents = contents;
    return c;
  });

  return config;
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
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

async function runIosAdReview(iosRoot) {
  const rubyPath = path.join(iosRoot, 'AppLovinQualityServiceSetup-ios.rb');
  const url =
    'https://artifacts.applovin.com/ios/com/applovin/quality/AppLovinQualityServiceSetup-ios.rb';
  try {
    await download(url, rubyPath);
    console.log('[with-freestar-max] running iOS Ad Review setup');
    const result = spawnSync('ruby', [rubyPath], {
      cwd: iosRoot,
      stdio: 'inherit',
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.warn('[with-freestar-max] iOS Ad Review exited', result.status);
    }
  } catch (e) {
    console.warn('[with-freestar-max] iOS Ad Review skipped:', e.message || e);
  } finally {
    try {
      if (fs.existsSync(rubyPath)) fs.unlinkSync(rubyPath);
    } catch {}
  }
}

module.exports = withFreestarMax;
