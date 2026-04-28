// plugins/withAppLovinPin.js
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Keep in sync with Playwire iOS (e.g. Playwire 12.1.x pins AppLovinSDK 13.4.x).
const DEFAULT_VERSION = "13.4.0";

function patchPodfile(podfile, version) {
  const v = version || DEFAULT_VERSION;
  let out = podfile;
  let changed = false;

  // 1) If there is already a direct pod line, update it
  const rePodLine = /^\s*pod\s+['"]AppLovinSDK['"]\s*,\s*['"][^'"]+['"]\s*$/m;
  if (rePodLine.test(out)) {
    out = out.replace(rePodLine, `  pod 'AppLovinSDK', '${v}'`);
    return { out, changed: true };
  }

  // 2) Otherwise inject an explicit pin into the first target block
  const reTarget = /^target\s+['"][^'"]+['"]\s+do\s*$/m;
  const m = out.match(reTarget);
  if (m) {
    const insertAt = out.indexOf(m[0]) + m[0].length;
    out =
      out.slice(0, insertAt) +
      `\n  pod 'AppLovinSDK', '${v}'\n` +
      out.slice(insertAt);
    changed = true;
  } else {
    // Fallback: append (rare, but avoids no-op)
    out += `\n\npod 'AppLovinSDK', '${v}'\n`;
    changed = true;
  }

  return { out, changed };
}

module.exports = function withAppLovinPin(config, props = {}) {
  const version = props.version || DEFAULT_VERSION;

  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      const podfile = fs.readFileSync(podfilePath, "utf8");

      const { out, changed } = patchPodfile(podfile, version);

      if (changed && out !== podfile) {
        fs.writeFileSync(podfilePath, out, "utf8");
      }

      return cfg;
    },
  ]);
};
