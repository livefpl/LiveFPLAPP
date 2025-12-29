// plugins/withFirebaseConfigure.js
const { withAppDelegate } = require("@expo/config-plugins");

function upsertOnce(src, needle) {
  return src.includes(needle);
}

/**
 * Swift AppDelegate patching:
 * - Ensure: import FirebaseCore
 * - Ensure: FirebaseApp.configure() inside didFinishLaunchingWithOptions
 */
function patchSwiftAppDelegate(contents) {
  let out = contents;

  // 1) Ensure import FirebaseCore (NOT "#import", Swift import)
  if (!out.includes("import FirebaseCore")) {
    // Insert after the last existing `import ...` near the top
    const lines = out.split("\n");
    let insertAt = -1;
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      if (lines[i].startsWith("import ")) insertAt = i;
    }
    if (insertAt >= 0) {
      lines.splice(insertAt + 1, 0, "import FirebaseCore");
      out = lines.join("\n");
    } else {
      out = "import FirebaseCore\n" + out;
    }
  }

  // 2) Ensure FirebaseApp.configure inside didFinishLaunchingWithOptions
  if (!out.includes("FirebaseApp.configure()")) {
    // Typical Swift signature:
    // func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: ...) -> Bool {
    const re = /func\s+application\([\s\S]*?didFinishLaunchingWithOptions[\s\S]*?\)\s*->\s*Bool\s*\{/m;
    const m = out.match(re);
    if (m) {
      const idx = m.index + m[0].length;
      const insert = `\n    if FirebaseApp.app() == nil {\n      FirebaseApp.configure()\n    }\n`;
      out = out.slice(0, idx) + insert + out.slice(idx);
    }
  }

  return out;
}

/**
 * ObjC / ObjC++ AppDelegate patching:
 * - Ensure: #import <Firebase/Firebase.h>
 * - Ensure: [FIRApp configure]; inside didFinishLaunchingWithOptions
 */
function patchObjCAppDelegate(contents) {
  let out = contents;

  // Import
  if (!out.includes("#import <Firebase/Firebase.h>") && !out.includes("@import Firebase;")) {
    const lines = out.split("\n");
    const firstImport = lines.findIndex((l) => l.startsWith("#import"));
    if (firstImport >= 0) {
      lines.splice(firstImport + 1, 0, "#import <Firebase/Firebase.h>");
      out = lines.join("\n");
    } else {
      out = `#import <Firebase/Firebase.h>\n${out}`;
    }
  }

  // Configure call
  if (!out.includes("[FIRApp configure]")) {
    const marker = "didFinishLaunchingWithOptions";
    const i = out.indexOf(marker);
    if (i !== -1) {
      const brace = out.indexOf("{", i);
      if (brace !== -1) {
        const insert = "\n  if ([FIRApp defaultApp] == nil) { [FIRApp configure]; }\n";
        out = out.slice(0, brace + 1) + insert + out.slice(brace + 1);
      }
    }
  }

  return out;
}

module.exports = function withFirebaseConfigure(config) {
  return withAppDelegate(config, (cfg) => {
    const filePath = cfg.modRequest.platformProjectRoot
      ? cfg.modRequest.platformProjectRoot
      : "";

    // Expo provides the actual filename in cfg.modRequest, but easiest is to detect by contents.
    const contents = cfg.modResults.contents;

    const looksSwift =
      contents.includes("import UIKit") ||
      contents.includes("class AppDelegate") ||
      contents.includes("UIApplication") ||
      contents.includes("func application(");

    const patched = looksSwift ? patchSwiftAppDelegate(contents) : patchObjCAppDelegate(contents);

    cfg.modResults.contents = patched;
    return cfg;
  });
};
