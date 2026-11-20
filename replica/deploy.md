# Deploy Checklist — Sohan Note Ultra

Date: 2026-11-20 · Package: `com.sohantech.noteultra` · Scheme: `sohannote://`

## Preflight (All Passed)
- [x] TypeScript strict (`npx tsc --noEmit`): 0 errors
- [x] ESLint (`npx eslint . --max-warnings 0`): 0 errors, 0 warnings
- [x] Unit & service tests (`npx jest`): 28/28 suites, 144/144 tests passing
- [x] Supabase live DB migration & RLS security verification (`scripts/db/verify.mjs`): 58/58 checks PASS
- [x] End-to-end Web QA click-through: 10/10 areas PASS (accounting math reconciled to exact taka; 4 UI/DOM bugs caught & fixed)
- [x] Feature parity (`parity.py`): 100.0 / 100 (27/27 must-haves done; 33/33 in-scope features complete)
- [x] Rebrand sweep (`sweep.py`): Clean (0 hits)
- [x] Store listing lint (`listing.py`): 0 errors, 0 warnings (`replica/launch/listing.json`)
- [x] Custom app icon, adaptive icon, monochrome icon, splash, favicon (`assets/images/*`)
- [x] Production web export (`dist/` with COOP/COEP `_headers` + `vercel.json`)
- [x] Signed release Android APK & Play-ready AAB (`releases/SohanNoteUltra-1.0.0-release.apk`, `releases/SohanNoteUltra-1.0.0-release.aab`)

## Production Artifacts
| Target | Path | Notes |
|---|---|---|
| Android APK (install directly) | `releases/SohanNoteUltra-1.0.0-release.apk` | Signed with release upload keystore, `EXPO_PUBLIC_DEV_LOGIN=0` |
| Google Play AAB (store upload) | `releases/SohanNoteUltra-1.0.0-release.aab` | Play Console release bundle, signed |
| Web Dashboard + Storefront | `dist/` | Deploy to Vercel (`vercel.json` included) or Cloudflare Pages/Netlify (`_headers` included for SharedArrayBuffer/expo-sqlite) |
| Upload Keystore (KEEP SAFE!) | `~/.android/sohan-note-ultra-release.jks` | Credentials in `~/.android/sohan-note-ultra-signing.env` (never committed to git) |

## After Deploying Web Domain
1. Add production web domain (`https://<domain>` and `https://<domain>/**`) to Supabase → Authentication → URL Configuration → Redirect URLs (and update Site URL).
2. Rotate Supabase secret key and Google OAuth client secret if desired before public launch.
3. For Google Play Console: upload `SohanNoteUltra-1.0.0-release.aab`, paste store copy from `replica/launch/listing.json`, add a public privacy policy URL & Play Data Safety form.
