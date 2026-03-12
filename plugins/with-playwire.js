// plugins/with-playwire.js
const {
  withInfoPlist,
  withAndroidManifest,
  withDangerousMod,
  withProjectBuildGradle,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const pkg = { name: 'with-playwire', version: '1.0.0' };

/**
 * Options (prefer storing in app.json -> expo.extra.playwire):
 * {
 *   gadApplicationId: "<iOS Google Ad Manager app id>",
 *   androidApplicationId: "<Android Google Ad Manager app id>",
 *   adManagerApp: true, // default true
 *   skadItems: [ { SKAdNetworkIdentifier: "xxxxxx.skadnetwork" }, ... ],
 *   githubUser: "<ignored in v12; Android uses Maven Central>",
 *
 *   // Optional:
 *   iosPlaywireVersion: "12.0.0" // defaults to 12.0.0 (v12: pod brought in by RN SDK)
 * }
 */
const withPlaywire = (config, options = {}) => {
  const playwire = (config.extra && config.extra.playwire) || {};
  const opts = { ...options, ...playwire };

  const iosPlaywireVersion = opts.iosPlaywireVersion || '12.0.0';

  /* ---------- iOS Info.plist: GADApplicationIdentifier + SKAdNetworkItems ---------- */
  config = withInfoPlist(config, (c) => {
    const info = c.modResults;

    // GADApplicationIdentifier
    if (opts.gadApplicationId) {
      info.GADApplicationIdentifier = opts.gadApplicationId;
    }

    // SKAdNetworkItems – merge without duplicating IDs
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

  /* ---------- AndroidManifest meta-data ---------- */
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

    const adManagerApp = opts.adManagerApp !== false;
    ensureMeta('com.google.android.gms.ads.AD_MANAGER_APP', adManagerApp ? 'true' : 'false');

    if (opts.androidApplicationId) {
      ensureMeta('com.google.android.gms.ads.APPLICATION_ID', opts.androidApplicationId);
    }
    return c;
  });

  /* ---------- iOS Podfile: sources + Playwire + AppLovin mediation adapter ---------- */
  config = withDangerousMod(config, [
    'ios',
    async (c) => {
      const podfilePath = path.join(c.modRequest.projectRoot, 'ios', 'Podfile');

      let contents = await fs.promises.readFile(podfilePath, 'utf8');

      // 1) Ensure sources at the top:
      const cocoaSource = "source 'https://github.com/CocoaPods/Specs.git'";
      const playwireSource = "source 'https://github.com/intergi/playwire-ios-podspec'";

      const hasCocoaSource = contents.includes(cocoaSource);
      const hasPlaywireSource = contents.includes(playwireSource);

      let sourceBlock = '';
      if (!hasCocoaSource) sourceBlock += cocoaSource + '\n';
      if (!hasPlaywireSource) sourceBlock += playwireSource + '\n';

      if (sourceBlock) {
        // Prepend sources ahead of existing contents
        contents = sourceBlock + contents;
      }

      // 2) Ensure required pods are present in the first target block
      const targetRegex = /target ['"][^'"]+['"] do/;

      const ensurePodInFirstTarget = (podLine) => {
        if (contents.includes(podLine)) return;
        if (!targetRegex.test(contents)) return;

        contents = contents.replace(targetRegex, (match) => {
          // Insert right after the first target line
          return `${match}\n  ${podLine}`;
        });
      };

      // v12: Playwire is brought in by @intergi/react-native-playwire-sdk podspec (no explicit pod)
      // ensurePodInFirstTarget(`pod 'Playwire', '${iosPlaywireVersion}'`);

      // Keep your mediation adapter
      ensurePodInFirstTarget(`pod 'GoogleMobileAdsMediationAppLovin'`);

      await fs.promises.writeFile(podfilePath, contents, 'utf8');
      return c;
    },
  ]);

  /* ---------- ANDROID: project-level Gradle (maven repos) ---------- */
  /* v12: Playwire is on Maven Central; no GitHub Packages auth. Ensure mavenCentral + mediation repos. */
  config = withProjectBuildGradle(config, (c) => {
    const mod = c.modResults;
    if (mod.language !== 'groovy') return c;

    let contents = mod.contents;

    const mediationReposMarker = 'https://android-sdk.is.com/';
    if (contents.includes(mediationReposMarker)) {
      return c;
    }

    const repoBlock = `
        mavenCentral()
        maven {
            url 'https://android-sdk.is.com/'
        }
        maven {
            url 'https://artifact.bytedance.com/repository/pangle/'
        }
        maven {
            url 'https://cboost.jfrog.io/artifactory/chartboost-ads/'
        }
        maven {
            url 'https://dl-maven-android.mintegral.com/repository/mbridge_android_sdk_oversea'
        }
        maven {
            url 'https://repo.pubmatic.com/artifactory/public-repos/'
        }
        maven {
            url 'https://maven.ogury.co'
        }
        maven {
            url 'https://s3.amazonaws.com/smaato-sdk-releases/'
        }
        maven {
            url 'https://verve.jfrog.io/artifactory/verve-gradle-release'
        }
`;

    contents = contents.replace(/allprojects\s*{\s*repositories\s*{/, (match) => `${match}${repoBlock}`);

    mod.contents = contents;
    return c;
  });

  /* ---------- ANDROID: app-level Gradle ---------- */
  /* v12: Playwire SDK bundles total/non_coppa implicitly; do not add playwiresdk_total here. */
  /* (No app-level Playwire dependency injection for v12.) */

  return config;
};

module.exports = createRunOncePlugin(withPlaywire, pkg.name, pkg.version);
