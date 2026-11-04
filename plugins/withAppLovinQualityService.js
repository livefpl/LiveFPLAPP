// Freestar / AppLovin Ad Review for Expo CNG.
// Runs the account-specific AppLovinQualityServiceSetup-ios.rb after ios/ is generated.
const { withDangerousMod } = require('@expo/config-plugins');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_NAME = 'AppLovinQualityServiceSetup-ios.rb';

function runQualityServiceScript(projectRoot, iosRoot) {
  const src = path.join(projectRoot, SCRIPT_NAME);
  if (!fs.existsSync(src)) {
    const msg =
      `[withAppLovinQualityService] ${SCRIPT_NAME} is missing from the project root. ` +
      'Commit Freestar’s account-specific MAX Ad Review script there.';
    if (process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'ios') {
      throw new Error(msg);
    }
    console.warn(msg);
    return;
  }

  const dest = path.join(iosRoot, SCRIPT_NAME);
  fs.copyFileSync(src, dest);
  console.log('[withAppLovinQualityService] Running AppLovin Quality Service script...');
  execSync(`ruby ${JSON.stringify(dest)}`, {
    cwd: iosRoot,
    stdio: 'inherit',
  });
}

const withAppLovinQualityService = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      try {
        runQualityServiceScript(config.modRequest.projectRoot, config.modRequest.platformProjectRoot);
      } catch (error) {
        console.error('Failed to run AppLovin script:', error);
        if (process.env.EAS_BUILD === 'true') throw error;
      }
      return config;
    },
  ]);
};

module.exports = withAppLovinQualityService;
