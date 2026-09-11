/**
 * Dynamic config layered over app.json.
 *
 * Exists for one thing: Firebase's `google-services.json`, which Android push
 * needs. It is committed — Firebase does not treat it as secret, and its API key
 * ships inside every APK regardless; restrict that key to the app's package and
 * signing SHA-1 in Google Cloud instead. A different file can still be supplied
 * through an EAS FILE environment variable, which takes precedence:
 *
 *   eas env:create --type file --name GOOGLE_SERVICES_JSON --value ./google-services.json
 *
 * The file is only wired in when its package matches the app's. A mismatch makes
 * the Android build fail with "No matching client found for package name",
 * which reads as a broken build rather than as the wrong Firebase app — so it
 * is caught here, named, and the build carries on without push instead.
 */

/* global __dirname */
const fs = require('fs');
const path = require('path');

function googleServicesFile(expectedPackage) {
  const file = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const absolute = path.resolve(__dirname, file);
  if (!fs.existsSync(absolute)) return undefined;

  try {
    const json = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    const packages = (json.client || []).map(
      (client) => client?.client_info?.android_client_info?.package_name
    );
    if (!packages.includes(expectedPackage)) {
      console.warn(
        `[app.config] ${file} is for ${packages.join(', ') || 'no package'}, ` +
          `but the app is ${expectedPackage}. Skipping it, so Android push is off. ` +
          `Add ${expectedPackage} to the Firebase project and download the file again.`
      );
      return undefined;
    }
  } catch {
    console.warn(`[app.config] ${file} could not be read. Skipping it, so Android push is off.`);
    return undefined;
  }

  return file;
}

module.exports = ({ config }) => {
  const servicesFile = googleServicesFile(config.android?.package);

  return {
    ...config,
    android: {
      ...config.android,
      ...(servicesFile ? { googleServicesFile: servicesFile } : {}),
    },
  };
};
