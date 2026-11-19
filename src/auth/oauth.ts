export type ParsedAuthCallback = {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
};

/** Parses Supabase OAuth redirect URL (supports both PKCE ?code= and implicit #access_token=). */
export function parseAuthCallbackUrl(url: string): ParsedAuthCallback {
  const empty: ParsedAuthCallback = {
    code: null,
    accessToken: null,
    refreshToken: null,
    error: null,
    errorDescription: null,
  };
  if (!url) return empty;

  const [beforeHash, hashPart = ''] = url.split('#');
  const queryIndex = beforeHash.indexOf('?');
  const queryPart = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';

  const query = new URLSearchParams(queryPart);
  const hash = new URLSearchParams(hashPart);

  const pick = (key: string): string | null => hash.get(key) ?? query.get(key);

  return {
    code: pick('code'),
    accessToken: pick('access_token'),
    refreshToken: pick('refresh_token'),
    error: pick('error'),
    errorDescription: pick('error_description'),
  };
}
