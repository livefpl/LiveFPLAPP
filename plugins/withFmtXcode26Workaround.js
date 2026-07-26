// plugins/withFmtXcode26Workaround.js
// Xcode 26+ Apple Clang rejects fmt 11.0.2 consteval (bundled via RN/RCT-Folly).
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'Xcode 26 workaround';

const INJECTION = `
  # ${MARKER}: fmt 11.0.2 consteval breaks under Apple Clang 21+
  installer.pods_project.targets.each do |target|
    if target.name == 'fmt'
      target.build_configurations.each do |bc|
        bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
  end
  fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
  if File.exist?(fmt_base)
    content = File.read(fmt_base)
    unless content.include?('${MARKER}')
      patched = content.gsub(
        /^(#elif defined\\(__cpp_consteval\\)\\n#  define FMT_USE_CONSTEVAL) 1/,
        "// ${MARKER}: disable consteval\\n\\\\1 0"
      )
      if patched != content
        File.chmod(0644, fmt_base)
        File.write(fmt_base, patched)
      end
    end
  end
`;

module.exports = function withFmtXcode26Workaround(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return cfg;

      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(MARKER)) return cfg;

      const postInstall = 'post_install do |installer|';
      if (!contents.includes(postInstall)) return cfg;

      contents = contents.replace(postInstall, postInstall + INJECTION);
      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
};
