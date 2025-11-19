// plugins/withPrebidPodWorkaround.js
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withPrebidPodWorkaround(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      const marker = 'post_install do |installer|';
      if (contents.includes(marker) && !contents.includes('PrebidMobile')) {
        const injection = `
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      if target.name.include?("PrebidMobile")
        config.build_settings['OTHER_SWIFT_FLAGS'] =
          '$(inherited) -no-verify-emitted-module-interface'
      end
    end
  end
`;
        contents = contents.replace(marker, marker + injection);
        fs.writeFileSync(podfilePath, contents);
      }

      return config;
    },
  ]);
};
