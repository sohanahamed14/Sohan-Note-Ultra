const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Configures Android release signing from environment variables (ANDROID_KEYSTORE_PATH,
 * ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD) so secrets stay out of git.
 */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes('signingConfigs.release')) return cfg;

    const releaseBlock = `        release {
            def ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ksPath) {
                storeFile file(ksPath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }`;

    cfg.modResults.contents = src
      .replace(
        /(\s+keyPassword 'android'\n\s+\}\n)\s+\}/,
        `$1${releaseBlock}`,
      )
      .replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        `$1signingConfig System.getenv("ANDROID_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug`,
      );
    return cfg;
  });
};
