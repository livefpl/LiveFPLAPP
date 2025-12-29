const { withAppDelegate } = require("@expo/config-plugins");

function ensureFirebaseImport(src) {
  if (src.includes("#import <Firebase/Firebase.h>") || src.includes("@import Firebase;")) return src;

  // Insert after the first #import line
  const lines = src.split("\n");
  const firstImport = lines.findIndex(l => l.startsWith("#import"));
  if (firstImport >= 0) {
    lines.splice(firstImport + 1, 0, "#import <Firebase/Firebase.h>");
    return lines.join("\n");
  }
  return `#import <Firebase/Firebase.h>\n${src}`;
}

function ensureConfigureCall(src) {
  if (src.includes("[FIRApp configure]")) return src;

  const marker = "didFinishLaunchingWithOptions";
  const i = src.indexOf(marker);
  if (i === -1) return src;

  const brace = src.indexOf("{", i);
  if (brace === -1) return src;

  const insert = "\n  if ([FIRApp defaultApp] == nil) { [FIRApp configure]; }\n";
  return src.slice(0, brace + 1) + insert + src.slice(brace + 1);
}

module.exports = function withFirebaseConfigure(config) {
  return withAppDelegate(config, (cfg) => {
    let contents = cfg.modResults.contents;
    contents = ensureFirebaseImport(contents);
    contents = ensureConfigureCall(contents);
    cfg.modResults.contents = contents;
    return cfg;
  });
};
