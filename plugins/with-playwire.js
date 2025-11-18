
// plugins/with-playwire.js
const {
  withInfoPlist,
  withAndroidManifest,
  createRunOncePlugin,
} = require('@expo/config-plugins');

const pkg = { name: 'with-playwire', version: '1.0.0' };

/**
 * Options (prefer storing in app.json -> expo.extra.playwire):
 * {
 *   gadApplicationId: "<iOS Google Ad Manager app id>",
 *   androidApplicationId: "<Android Google Ad Manager app id>",
 *   adManagerApp: true, // default true
 *   skadItems: [ { SKAdNetworkIdentifier: "xxxxxx.skadnetwork" }, ... ]
 * }
 */
const withPlaywire = (config, options = {}) => {
  const playwire = (config.extra && config.extra.playwire) || {};
  const opts = { ...options, ...playwire };

  // ---- iOS Info.plist: GADApplicationIdentifier + SKAdNetworkItems ----
  config = withInfoPlist(config, (c) => {
    const info = c.modResults;

    if (opts.gadApplicationId) {
      info.GADApplicationIdentifier = opts.gadApplicationId;
    }

    if (Array.isArray(opts.skadItems) && opts.skadItems.length) {
      const existing = Array.isArray(info.SKAdNetworkItems) ? info.SKAdNetworkItems : [];
      const existingIds = new Set(existing.map(e => e.SKAdNetworkIdentifier));
      const toAdd = opts.skadItems.filter(e => e && e.SKAdNetworkIdentifier && !existingIds.has(e.SKAdNetworkIdentifier));
      info.SKAdNetworkItems = [...existing, ...toAdd];
    }

    return c;
  });

  // ---- AndroidManifest meta-data ----
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (!app) return c;
    app['meta-data'] = app['meta-data'] || [];

    const ensureMeta = (name, value) => {
      const node = app['meta-data'].find((m) => m.$['android:name'] === name);
      if (node) {
        node.$['android:value'] = String(value);
      } else {
        app['meta-data'].push({ $: { 'android:name': name, 'android:value': String(value) } });
      }
    };

    const adManagerApp = opts.adManagerApp !== false;
    ensureMeta('com.google.android.gms.ads.AD_MANAGER_APP', adManagerApp ? 'true' : 'false');

    if (opts.androidApplicationId) {
      ensureMeta('com.google.android.gms.ads.APPLICATION_ID', opts.androidApplicationId);
    }
    return c;
  });

  return config;
};

module.exports = createRunOncePlugin(withPlaywire, pkg.name, pkg.version);
