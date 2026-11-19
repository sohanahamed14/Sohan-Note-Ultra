/** @jest-environment node */
import { parseAuthCallbackUrl } from './oauth';

describe('parseAuthCallbackUrl', () => {
  it('parses PKCE code from query params', () => {
    const res = parseAuthCallbackUrl('sohannote://auth-callback?code=abc-123');
    expect(res).toEqual({
      code: 'abc-123',
      accessToken: null,
      refreshToken: null,
      error: null,
      errorDescription: null,
    });
  });

  it('parses implicit tokens from hash fragment', () => {
    const res = parseAuthCallbackUrl(
      'sohannote://auth-callback#access_token=at_1&refresh_token=rt_2&token_type=bearer',
    );
    expect(res).toEqual({
      code: null,
      accessToken: 'at_1',
      refreshToken: 'rt_2',
      error: null,
      errorDescription: null,
    });
  });

  it('parses error parameters from query or hash', () => {
    const res = parseAuthCallbackUrl(
      'sohannote://auth-callback#error=access_denied&error_description=User+cancelled',
    );
    expect(res.error).toBe('access_denied');
    expect(res.errorDescription).toBe('User cancelled');
  });

  it('handles empty string safely', () => {
    expect(parseAuthCallbackUrl('').code).toBeNull();
  });
});
