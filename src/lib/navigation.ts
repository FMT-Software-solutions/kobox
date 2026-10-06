import { router, type Href } from 'expo-router';

/**
 * Back, when there is somewhere to go back to.
 *
 * In the phone app every screen is reached from another one, so `router.back()`
 * always has a destination. A browser breaks that: a refresh, a bookmark or a
 * shared link opens a screen with nothing underneath it, and `back()` then does
 * nothing at all — the arrow in the header simply stops working. In that case
 * go to the fallback instead, which is home unless the screen says otherwise.
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
