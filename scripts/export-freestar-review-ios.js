// Writes iOS review files from app.json + plugin adapter list (Windows cannot produce Podfile.lock).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REVIEW = path.join(ROOT, 'freestar-review');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
const plugin = (app.plugins || []).find((p) => Array.isArray(p) && String(p[0]).includes('with-freestar-max'));
const opts = (plugin && plugin[1]) || {};
const gad = opts.gadApplicationId || app.ios?.infoPlist?.GADApplicationIdentifier;
const skad = opts.skadItems || [];

fs.mkdirSync(REVIEW, { recursive: true });

const pods = [
  "pod 'AppLovinMediationGoogleAdManagerAdapter'",
  "pod 'AppLovinMediationGoogleAdapter'",
  "pod 'AppLovinMediationFyberAdapter'",
  "pod 'AppLovinMediationInMobiAdapter'",
  "pod 'AppLovinMediationVungleAdapter'",
  "pod 'AppLovinMediationFacebookAdapter'",
  "pod 'AppLovinMediationOguryPresageAdapter'",
  "pod 'AppLovinMediationUnityAdsAdapter'",
];

const podfile = `require File.join(File.dirname(\`node --print "require.resolve('expo/package.json')"\`), "scripts/autolinking")
require File.join(File.dirname(\`node --print "require.resolve('react-native/package.json')"\`), "scripts/react_native_pods")

platform :ios, '15.1'
prepare_react_native_project!

target 'LiveFPL' do
  ${pods.join('\n  ')}
  use_expo_modules!
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath],
    :hermes_enabled => true,
    :app_path => "#{Pod::Config.instance.installation_root}/.."
  )

  post_install do |installer|
    react_native_post_install(installer, config[:reactNativePath], :mac_catalyst_enabled => false)
  end
end
`;

fs.writeFileSync(path.join(REVIEW, 'Podfile'), podfile);

const skadXml = skad
  .map(
    (item) => `    <dict>
      <key>SKAdNetworkIdentifier</key>
      <string>${item.SKAdNetworkIdentifier}</string>
    </dict>`
  )
  .join('\n');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${app.name}</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleShortVersionString</key>
  <string>${app.version}</string>
  <key>CFBundleVersion</key>
  <string>${app.ios.buildNumber}</string>
  <key>GADApplicationIdentifier</key>
  <string>${gad}</string>
  <key>GADIsAdManagerApp</key>
  <true/>
  <key>ITSAppUsesNonExemptEncryption</key>
  <false/>
  <key>NSUserTrackingUsageDescription</key>
  <string>${app.ios.infoPlist.NSUserTrackingUsageDescription}</string>
  <key>SKAdNetworkItems</key>
  <array>
${skadXml}
  </array>
</dict>
</plist>
`;

fs.writeFileSync(path.join(REVIEW, 'Info.plist'), plist);
console.log('wrote Podfile and Info.plist', 'skad', skad.length);
