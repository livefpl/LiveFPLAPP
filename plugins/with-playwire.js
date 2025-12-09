// plugins/with-playwire.js
const {
  withInfoPlist,
  withAndroidManifest,
  withDangerousMod,
  withProjectBuildGradle,
  withAppBuildGradle,
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
 *   githubUser: "<your GitHub username for Playwire Maven>"
 * }
 */
const withPlaywire = (config, options = {}) => {
  const playwire = (config.extra && config.extra.playwire) || {};
  const opts = { ...options, ...playwire };

  /* ---------- iOS Info.plist: GADApplicationIdentifier + SKAdNetworkItems ---------- */
  config = withInfoPlist(config, (c) => {
    const info = c.modResults;

    // GADApplicationIdentifier
    if (opts.gadApplicationId) {
      info.GADApplicationIdentifier = opts.gadApplicationId;
    }

    // SKAdNetworkItems – merge without duplicating IDs
    if (Array.isArray(opts.skadItems) && opts.skadItems.length) {
      const existing = Array.isArray(info.SKAdNetworkItems)
        ? info.SKAdNetworkItems
        : [];
      const existingIds = new Set(
        existing.map((e) => e.SKAdNetworkIdentifier)
      );
      const toAdd = opts.skadItems.filter(
        (e) =>
          e &&
          e.SKAdNetworkIdentifier &&
          !existingIds.has(e.SKAdNetworkIdentifier)
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
      const node = app['meta-data'].find(
        (m) => m.$['android:name'] === name
      );
      if (node) {
        node.$['android:value'] = String(value);
      } else {
        app['meta-data'].push({
          $: { 'android:name': name, 'android:value': String(value) },
        });
      }
    };

    const adManagerApp = opts.adManagerApp !== false;
    ensureMeta(
      'com.google.android.gms.ads.AD_MANAGER_APP',
      adManagerApp ? 'true' : 'false'
    );

    if (opts.androidApplicationId) {
      ensureMeta(
        'com.google.android.gms.ads.APPLICATION_ID',
        opts.androidApplicationId
      );
    }
    return c;
  });

  /* ---------- iOS Podfile: sources + AppLovin mediation adapter ---------- */
  config = withDangerousMod(config, [
    'ios',
    async (c) => {
      const podfilePath = path.join(
        c.modRequest.projectRoot,
        'ios',
        'Podfile'
      );

      let contents = await fs.promises.readFile(podfilePath, 'utf8');

      // 1) Ensure sources at the top:
      const cocoaSource =
        "source 'https://github.com/CocoaPods/Specs.git'";
      const playwireSource =
        "source 'https://github.com/intergi/playwire-ios-podspec'";

      const hasCocoaSource = contents.includes(cocoaSource);
      const hasPlaywireSource = contents.includes(playwireSource);

      let sourceBlock = '';
      if (!hasCocoaSource) {
        sourceBlock += cocoaSource + '\n';
      }
      if (!hasPlaywireSource) {
        sourceBlock += playwireSource + '\n';
      }

      if (sourceBlock) {
        // Prepend sources ahead of existing contents
        contents = sourceBlock + contents;
      }

      // 2) Ensure AppLovin mediation adapter pod is in the main target block
      const targetRegex = /target ['"][^'"]+['"] do/;
      const hasAppLovinAdapter = contents.includes(
        "pod 'GoogleMobileAdsMediationAppLovin'"
      );

      if (targetRegex.test(contents) && !hasAppLovinAdapter) {
        contents = contents.replace(targetRegex, (match) => {
          // Insert the mediation adapter right after the target line
          return `${match}\n  pod 'GoogleMobileAdsMediationAppLovin'`;
        });
      }

      await fs.promises.writeFile(podfilePath, contents);
      return c;
    },
  ]);

  /* ---------- ANDROID: project-level Gradle (maven repos) ---------- */
  config = withProjectBuildGradle(config, (c) => {
    const mod = c.modResults;
    if (mod.language !== 'groovy') return c;

    let contents = mod.contents;

    const marker = 'maven.pkg.github.com/intergi/playwire-android-binaries';
    if (contents.includes(marker)) {
      // Already injected
      return c;
    }

    const githubUser = opts.githubUser || 'CHANGE_ME_GITHUB_USERNAME';

    const repoBlock = `
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/intergi/playwire-android-binaries")
            credentials {
                username = "${githubUser}"
                password = System.getenv("GITHUB_TOKEN") ?: ""
            }
        }

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

    contents = contents.replace(
      /allprojects\s*{\s*repositories\s*{/,
      (match) => `${match}${repoBlock}`
    );

    mod.contents = contents;
    return c;
  });

  /* ---------- ANDROID: app-level Gradle (Playwire dependency) ---------- */
  config = withAppBuildGradle(config, (c) => {
    const mod = c.modResults;
    if (mod.language !== 'groovy') return c;

    let contents = mod.contents;

    if (!contents.includes('com.intergi.playwire:playwiresdk_total:11.6.0')) {
      contents = contents.replace(
        /dependencies\s*{/,
        (match) =>
          `${match}
    implementation("com.intergi.playwire:playwiresdk_total:11.6.0")`
      );
    }

    mod.contents = contents;
    return c;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withPlaywire,
  pkg.name,
  pkg.version
);
