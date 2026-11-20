import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';

export const AUTH_SCHEME = 'sohannote';
export const AUTH_CALLBACK_PATH = 'auth-callback';
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/** Returns OAuth redirect URI: origin/auth-callback on web, sohannote://auth-callback on native. */
export function getOAuthRedirectUrl(): string {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/${AUTH_CALLBACK_PATH}`;
    }
    return `http://localhost:8081/${AUTH_CALLBACK_PATH}`;
  }
  try {
    return makeRedirectUri({
      scheme: AUTH_SCHEME,
      path: AUTH_CALLBACK_PATH,
    });
  } catch {
    return `${AUTH_SCHEME}://${AUTH_CALLBACK_PATH}`;
  }
}
