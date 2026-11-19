# FOUNDATION (M0) — API reference

Routes live in **`src/app/`** (not root `app/`); architecture.md's `app/x` == `src/app/x`. Alias `@/*` → `src/*`.
Scripts: `npm run check` (typecheck + eslint 0 warnings + jest), `db:generate`, `start|android|ios|web`.
Env: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`, `EXPO_PUBLIC_DEV_LOGIN=1` (auto local owner + "Dev Shop"). See `.env.example`.
Only M0 installs deps. Tests: `*.test.ts` next to code; DB tests start with `/** @jest-environment node */`.

## src/lib
- `money.ts` (paisa ints): `toPaisa(str|num)` (throws AppError VALIDATION), `fromPaisa`, `formatTaka(p, decimal=false)` → `৳ 1,250.50`, `add(...)`, `mulQty(unitPaisa, qty)`, `percentOf(paisa, pct)`, `roundQty(q)` (3dp).
- `date.ts`: `now, startOfDay, endOfDay, startOfMonth, endOfMonth, addDays, formatDate` (15 Nov 2026), `formatDateTime` (15 Nov, 07:59 PM), `toDateInput, parseDateInput` (YYYY-MM-DD, local).
- `id.ts`: `newId()` uuid. `errors.ts`: `AppError(code, message)`, codes `VALIDATION|NOT_FOUND|FORBIDDEN|CONFLICT|OVERPAY|INSUFFICIENT_STOCK|NETWORK|UNKNOWN`, `errorMessage(e)`.
- `invoiceNo.ts`: `formatInvoiceNo(kind, date, seq)`, `nextInvoiceNo(db, shopId, 'sale'|'purchase', date)` → `INV-YYYYMMDD-0001` / `BILL-…` (call inside your transaction).
- `supabase.ts`: `supabase`, `isSupabaseConfigured` (publishable key only; session in AsyncStorage).

## src/db
- `schema.ts`: drizzle tables, snake_case keys = column names = Supabase names: `shops, shop_members, categories, products, stock_movements, parties, party_ledger, sales, sale_items, purchases, purchase_items, expenses, cash_entries, online_orders` (all with `id, shop_id, created_at, updated_at, deleted_at, created_by, dirty`; shops has `shop_id = id`), local-only `kv(key,value)`, `sync_state(key,cursor,last_synced_at)`. Also `SYNCED_TABLES`, enums `ROLES, METHODS, CASH_TYPES, LEDGER_TYPES, STOCK_TYPES`, types `Role, Method, Shop, Product, Party, Sale, …`. No SQL FK constraints (sync-order safe); `PRAGMA foreign_keys=ON` still set.
- Migrations: edit schema → `npm run db:generate` → commit `drizzle/`. Bundled via babel `inline-import` (.sql). Never hand-edit.
- `types.ts`: `AppDb` (sync drizzle; expo-sqlite, better-sqlite3 and `tx` all satisfy it). Services take `db: AppDb`.
- `client.ts`: `db: AppDb` (use in services/UI handlers), `expoDb` (use for `useLiveQuery(expoDb.select()…)`). WAL + FKs.
- `helpers.ts`: `newRow(shopId, userId)` (spread into insert `values`), `touch()` (spread into `.set`), `active(table, shopId)` (shop + not deleted), `softDelete(db, table, shopId, id)`.
- Write pattern: `db.transaction((tx) => { tx.insert(sales).values({...newRow(shopId,userId), ...}).run(); postStock(tx,…); … })` — transaction callbacks are **synchronous**.

## src/services
- `posting.ts` (pass `tx`; zero amounts/qty return `null`; ints only): `postStock({shopId,userId,refId,date,note?,productId,qty±,type})`, `postCash({…,amount±,type,method})`, `postLedger({…,partyId,amount±,type})` (+ = they owe us). `softDeleteWithRefs(db,{shopId,table,id,items?:{table,fk}})` deletes parent+items+all postings with `ref_id=id` (shared timestamp); `restoreWithRefs` restores only rows deleted with the parent. Throws `NOT_FOUND`/`CONFLICT`. Derived: stock = Σ stock_movements.qty, cash = Σ cash_entries.amount, balance = Σ party_ledger.amount (always filter `deleted_at IS NULL`).
- `permissions.ts`: `can(role, action)`; actions `sell buy viewProducts manageProducts viewCost viewProfit viewReports viewStock adjustStock manageParties collectDue addExpense viewCashbox manageCash manageCapital manageOnline delete restore manageSettings manageEmployees`. Cashier: sell, viewProducts, viewStock, manageParties, collectDue, addExpense. Manager: all except manageSettings/manageEmployees. Owner: all.
- `src/test/testDb.ts`: `createTestDb(): AppDb` (in-memory better-sqlite3 + real migrations). `src/test/setup.ts` mocks `expo-crypto`.

## src/store
- `session.ts`: `useSession` (persisted) `{user:{id,email,name}|null, shopId, role, hydrated, setUser, setShop(shopId, role), signOut}`.
- `useCurrentShop()`: `{shopId, userId, role, shop (live row), requireShop()}`; `requireShop` throws FORBIDDEN.
- `devLogin.ts`: `DEV_LOGIN`, `ensureDevSession()`.

## src/theme
`useTheme() → {colors, scheme, pref, setPref('system'|'light'|'dark')}` (persisted). Colors: `primary primarySoft onPrimary accent success danger logout bg surface surfaceMuted border text textMuted overlay`. Tokens: `spacing, radius, fontSize, MAX_WIDTH(900)`.

## src/ui (import from `@/ui`)
`AppText{variant,muted,bold}` · `AppHeader{title,back=true,right:{icon,label,onPress}[],variant:'home',subtitle,pill}` · `Screen{header,scroll=true,padded=true,overlay}` (900px centered, keyboard avoiding; `scroll={false}` for FlatList bodies) · `Card, SectionCard{title}, IconTile{icon,label,color,onPress,badge}, IconGrid{items}` · `Button{label,onPress,variant:'primary'(blue)|'yellow'|'outline'|'danger'|'ghost',loading,disabled,icon,fullWidth}, BigActionButton, Fab{onPress,label,icon}` · `TextField{label,error,helper,…TextInputProps}, MoneyInput{value:paisa|null,onChange}, QtyStepper{value,onChange,min,step}, Segmented, SearchBar, Chip, ChipRow, DateField{value:ms,onChange}` · `ListRow, SettingsRow{icon,label,kind:'arrow'|'chevron'|'value'|'switch'|'expandable',destructive}, AmountText{paisa,tone:'auto'|'neutral'|'positive'|'negative'}` · `ConfirmDialog, BottomSheet, ToastProvider/useToast().show(msg,'success'|'error'|'info'), EmptyState, Loading, ComingSoon` · `Badge, Divider`. `IconName` = MaterialCommunityIcons names.

## Routing (src/app)
`_layout.tsx` (providers → migrations gate → auth gate: no user → `/(auth)/login`; no shop → `/(auth)/create-shop`; `s/*` public). `(auth)/{login,create-shop}`, `(tabs)/{online,index,reports}` (custom yellow-highlight tab bar; `index` = Home), `sell, sales, invoice/[id], buy, purchases, products, stock, due, party/[id], expenses, contacts, cashbox, capital, access, warranty, recycle-bin, settings, shops, business-card, notifications, online/{index,store-settings,products,orders,featured,delivery,policy,themes}, s/[slug]` — all currently `ComingSoon` placeholders; owners replace the default export in their files. New route files need no registration.
