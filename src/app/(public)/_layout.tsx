import { Stack } from 'expo-router';

/**
 * Pages anybody may open, signed in or not: the privacy policy and account
 * deletion. They sit outside both guards on purpose — Google Play checks these
 * URLs from a browser with no account, and a signed-in member reaches the same
 * screens from Settings.
 */
export default function PublicLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
