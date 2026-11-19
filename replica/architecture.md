# Architecture & Team Contract — Sohan Note Ultra

Read `replica/recon.md` first (screens S01–S28, flows F1–F10, canonical data model). This file is the law for every agent.

## Stack
- Expo (latest SDK from `create-expo-app`), React Native, **TypeScript strict**, expo-router (typed routes).
- Local DB: `expo-sqlite` + `drizzle-orm` (sqlite-core) with bundled migrations (`drizzle-kit`, `useMigrations`). Web uses expo-sqlite web (wasm) — COOP/COEP headers in web hosting.
- Cloud: Supabase (`@supabase/supabase-js`), keys from `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` (publishable key only). **Never** use the secret key in app code; it lives only in root `.env` for scripts in `supabase/` & `scripts/`.
- Auth: Google via Supabase OAuth (`signInWithOAuth` + `expo-web-browser` / `expo-auth-session` redirect on native, normal redirect on web). Dev-only email/password login when `EXPO_PUBLIC_DEV_LOGIN=1` (for testing).
- State: `zustand` (session, current shop, role, theme). Reactive lists via drizzle `useLiveQuery`.
- Forms: `react-hook-form` + `zod`. Icons: `@expo/vector-icons` (MaterialCommunityIcons) inside colored rounded tiles (our own look; never Hishabee art).
- PDF/print/share: `expo-print`, `expo-sharing`, `expo-file-system`. Excel: SheetJS (`xlsx` from cdn.sheetjs.com tarball). Images: `expo-image-picker`. App lock: `expo-local-authentication` + `expo-secure-store` PIN hash. QR: `react-native-qrcode-svg`.
- Tests: Jest. Services are tested in Node against the same drizzle schema using `better-sqlite3` (or `sql.js` fallback). Services accept `db: AppDb` param (drizzle sync sqlite type) so the same code runs on device and in tests.

## Folder ownership (do NOT edit another owner's files; ask the coordinator)
| Owner | Paths |
|---|---|
| M0 Foundation | `package.json`, configs, `app/_layout.tsx`, `src/theme/**`, `src/ui/**`, `src/db/**`, `src/lib/**`, `src/store/**`, `src/services/posting.ts`, `src/services/permissions.ts`, `src/i18n/**` |
| A Auth/Shop/Settings | `app/(auth)/**`, `app/settings/**`, `app/access/**`, `app/recycle-bin/**`, `app/shops/**`, `app/business-card/**`, `src/auth/**`, `src/services/{shop,members,recycle,applock}.ts`, `src/features/{auth,settings,access}/**` |
| B Products/Stock/Buy | `app/products/**`, `app/stock/**`, `app/buy/**`, `app/purchases/**`, `src/services/{products,stock,purchases}.ts`, `src/features/{products,stock,buy}/**` |
| C Sell/Invoice | `app/sell/**`, `app/sales/**`, `app/invoice/**`, `app/warranty/**`, `src/services/{sales,invoice,warranty}.ts`, `src/features/{sell,invoice}/**` |
| D Khata/Cash | `app/contacts/**`, `app/due/**`, `app/party/**`, `app/expenses/**`, `app/cashbox/**`, `app/capital/**`, `src/services/{parties,ledger,expenses,cash,capital}.ts`, `src/features/{contacts,due,expenses,cash}/**` |
| E Cloud/Online | `supabase/**`, `scripts/**`, `src/sync/**`, `app/(tabs)/online.tsx`, `app/online/**`, `app/s/**`, `src/services/{online,backup}.ts`, `src/features/online/**` |
| F Home/Reports | `app/(tabs)/index.tsx`, `app/(tabs)/reports.tsx`, `app/reports/**`, `app/notifications/**`, `src/services/{dashboard,reports,export}.ts`, `src/features/{home,reports}/**` |
Shared routes layout `app/(tabs)/_layout.tsx` is M0's. New dependencies: only M0 installs; others message coordinator.

## Iron rules (bug-free)
1. Money = integer paisa (`number`, `Number.isSafeInteger`). Convert only at UI edges via `src/lib/money.ts` (`toPaisa`, `formatTaka`). Never float math on money.
2. Derived values are computed from ledgers (stock, party balance, cash, capital) — never stored totals.
3. Every write that touches >1 table runs in ONE `db.transaction`, using `src/services/posting.ts` helpers: `postStock`, `postCash`, `postLedger`, `softDeleteWithRefs`, `restoreWithRefs` (refs linked by `ref_id`). Deleting a sale soft-deletes the sale, its items and every posting with `ref_id = sale.id`; restore reverses that.
4. Every synced row sets `updated_at = now`, `dirty = 1` on write (helpers in `src/db/helpers.ts`). Soft delete only (`deleted_at`); every query filters `deleted_at IS NULL` and `shop_id = currentShop`.
5. Validate all input with zod schemas living next to the service. Services throw typed `AppError(code, message)`; UI shows toast, never crashes.
6. Permissions via `can(role, action)` in `src/services/permissions.ts`; cashier cannot see profit, reports, cost prices, settings, employees, delete.
7. No `any`, no `@ts-ignore`, no unused code. Every service function has Jest tests (happy path + edge cases: zero, partial pay, overpay rejected, delete/restore reversal).
8. Every screen handles: loading, empty state, error, long lists (`FlatList`), keyboard avoiding, dark mode, small screens (360dp) and web width (max 900px centered).
9. English UI copy, ৳ BDT format `৳ 1,250.50` (decimal shown only if shop.decimal_enabled or non-zero paisa).
10. Done = `npx tsc --noEmit` 0 errors, `npx eslint . --max-warnings 0`, `npx jest` green, screen opened and exercised.

## Sync model (owner E)
Local rows `dirty=1` → push via upsert to same-named Supabase table (bigint epoch-ms timestamps, same column names, snake_case). Server trigger sets `server_seq` (bigserial / sequence) on every insert/update; client pulls `server_seq > cursor` per shop, last-write-wins by `updated_at`. RLS: user can access rows where `shop_id` ∈ their active `shop_members`. Public storefront uses SECURITY DEFINER RPCs `get_public_shop(slug)` and `place_online_order(...)`.

## Design tokens (from recon frames)
primary `#F6BE25` · onPrimary `#1B1B1B` · accentBlue `#1A5DD6` · success `#2E9E5B` · danger `#E53935` · logout `#FF4F2B` · bg `#FCFCFC` · surface `#FFFFFF` · surfaceMuted `#F2F2F2` · border `#ECECEC` · text `#1B1B1B` · textMuted `#6B6B6B`. Dark: bg `#121212`, surface `#1E1E1E`, surfaceMuted `#2A2A2A`, border `#333`, text `#F2F2F2`, primary unchanged.
Radius 8 (cards), 6 (rows), 24 (pills). Spacing 4/8/12/16/24. Type: 20 header title, 16 body, 14 secondary, 12 labels.
