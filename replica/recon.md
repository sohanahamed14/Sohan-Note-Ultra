# Recon map — Hishabee (reference) → Sohan Note Ultra (our build)

Source: owner's screen recording `replica/WhatsApp Video ….mp4` (frames in `replica/screens/frames/`, contact sheets in `replica/screens/sheets/`), Play listing, public site.
Clean-room: rebuild features/flows/layout. Own name, own icons (vector icons in colored tiles), own copy (English). Never use Hishabee logo/illustrations/banners.

## Global UI pattern (measured from frames)
- Primary yellow header bar `#F6BE25`, black/dark text on yellow. Status bar yellow.
- Page bg `#FCFCFC`, cards white with 1px border `#ECECEC`, radius ~8, section cards grouped.
- Section title small grey (`#6B6B6B`, 12sp) inside card top-left ("Ledgers", "For your business", "Others").
- Icon grid: 4 columns, icon (≈40dp) above 12sp label.
- Big two-button row: grey tiles `#F2F2F2` with icon + label (Buy / Sell).
- Segmented toggle (Day | Month): active blue `#1A5DD6` white text, inactive grey.
- Amounts: positive/receivable green `#2E9E5B`, payable/red `#E53935`, neutral blue-grey.
- Bottom nav 3 tabs: Online Shop | Home (center) | (3rd tab — ours: Reports). Active tab: light yellow top highlight + bold.
- Settings rows: grey filled rows `#F2F2F2` radius 6, left blue outline icon, right arrow or chevron (expandable). Logout: full-width pill `#FF4F2B`.
- Primary CTA buttons: blue `#1A5DD6` (dialogs), yellow full-width (`Change shop`).
- Dialogs: white card centered, blue bold title, grey body, outline "Back" + filled blue "Confirm".

## Screens
| ID | Screen | Notes |
|---|---|---|
| S01 | Splash | yellow bg, own logo + tagline |
| S02 | Login | Google sign-in only |
| S03 | Create shop (onboarding) | shop name, business type, phone, address |
| S04 | Home | header: shop name, "Last backup: 15 Nov, 07:59 PM" (red label), "Data backup" white pill; icons WhatsApp(support), bell(notifications: low stock, new online orders), settings. Setup-progress card (x% complete, steps carousel). Stats card: Balance, Today's sales, Day/Month toggle; Today's expense, Due (Given red / Taken green), Stock count. Buy + Sell big buttons. Ledgers: Purchase ledger, Sales ledger, Due ledger, Expense ledger. For your business: Contacts, Product list, Stock, Business report. Others: Cashbox, App access (employees), Warranty, Printer(system print setup/info), Capital, Recycle bin. Support card (WhatsApp chat) |
| S05 | Sell (POS) | product grid/list + search + category chips, cart, qty stepper, Quick sell (amount only) |
| S06 | Checkout | customer pick (optional), discount ৳/%, VAT, paid/due, payment method, date, note → Save → Invoice |
| S07 | Invoice view | PDF preview, Share (WhatsApp/any), Print |
| S08 | Buy (purchase) | supplier, products+qty+buy price, paid/due → stock up |
| S09 | Purchase ledger | list by date, filters, totals, detail, delete (→ recycle bin, reverses stock/cash/due) |
| S10 | Sales ledger | same for sales |
| S11 | Due ledger | tabs Customers / Suppliers, total receivable/payable, party list with balance |
| S12 | Party detail | running ledger, Give / Take buttons, call, WhatsApp statement, PDF statement |
| S13 | Expense ledger | list, category filter, add expense |
| S14 | Contacts | customers / suppliers / employees, add/edit |
| S15 | Product list | search, category, add/edit product (name, category, unit, buy/sell/wholesale price, opening stock, low-stock alert, warranty, photo, online visible) |
| S16 | Stock | stock value, low-stock list, adjust stock, movement history |
| S17 | Business report | date range: P&L, sales, purchase, expense, stock, due, cash; PDF + Excel export |
| S18 | Cashbox | balance, cash in / cash out manual, daily entries list, method breakdown |
| S19 | App access | employees: invite by email, role Owner/Manager/Cashier, remove |
| S20 | Warranty | sold items with warranty end date, search by customer/phone |
| S21 | Capital | owner investment in / withdrawal, total capital |
| S22 | Recycle bin | soft-deleted records, restore / delete forever |
| S23 | Online Shop tab | stats: Active orders, Online products, Earned, Website visits; Website / Copy link / QR code; grid: Store settings, Online products, Order list, Featured products, Delivery charges, Shop policy, Themes |
| S24 | Public storefront (web) | `/s/{slug}`: shop header, product grid, cart, order form (name, phone, address) → order saved + "Send on WhatsApp" |
| S25 | Settings | profile card (name, role, email, Edit), profile completion %, Change shop (yellow), App settings (expand): Payment QR (bKash/Nagad image on invoice), Custom categories, Decimal point, Data backup, Recycle bin, App lock (toggle), Data download, App reset (red). Web app (link + share), Currency BDT, Theme (light/dark), Business card, Others: Feature request, Help & support; version; Logout |
| S26 | Notifications | low stock, new online orders |
| S27 | Business card | generated shareable image/PDF |
| S28 | Shop switcher | list shops, create new |

Skipped (gov/payment/ads): Subscription, Top-up, Marketing SMS, Extra income tab, AI credits, Growth partner, App training, demo shop, promo banners, own domain, build app, fraud check, Expired products, barcode, BT printer.

## Core flows
1. F1 Sign in → create shop → Home.
2. F2 Sell: Home → Sell → add items → checkout (partial due to customer) → invoice share. Effects: stock −, cash +paid, party ledger +due.
3. F3 Buy: Home → Buy → supplier + items → paid/due. Effects: stock +, cash −paid, party ledger −due.
4. F4 Due collect: Due ledger → party → Take ৳ → cash +, ledger −.
5. F5 Expense add → cash −.
6. F6 Report: pick range → P&L = sales − COGS(buy_price at sale) − expenses; export PDF/Excel.
7. F7 Employee: owner invites email → employee logs in with that Google account → sees shop with role limits.
8. F8 Online: enable shop → products visible → share link → customer orders on web → order appears in Order list + notification → owner confirms → can convert to sale.
9. F9 Delete any transaction → recycle bin; reverse effects; restore re-applies.
10. F10 Backup: auto sync when online; "Data backup" forces sync, shows last backup time; export/import JSON file.

## Data model (canonical — all money INTEGER paisa, qty REAL rounded 3dp, time INTEGER epoch ms)
Common cols on every synced table: `id TEXT uuid PK, shop_id, created_at, updated_at, deleted_at NULL, created_by, dirty INTEGER(local only)`.
- shops: name, slug, phone, address, business_type, logo_uri, vat_percent, invoice_footer, payment_qr_uri, decimal_enabled, online_enabled, online_theme, delivery_inside, delivery_outside, shop_policy, owner_id
- shop_members: user_id?, email, name, role(owner|manager|cashier), status(invited|active)
- categories: name, kind(product|expense)
- products: name, category_id?, unit, code, buy_price, sell_price, wholesale_price, low_stock_alert, warranty_days, image_uri, description, online_visible, featured
- stock_movements: product_id, qty(±), type(opening|purchase|sale|adjust|restore), ref_id, note, date
- parties: type(customer|supplier|employee), name, phone, address, note
- party_ledger: party_id, amount(± paisa; + = they owe us), type(sale_due|purchase_due|received|paid|give|take|opening), ref_id, date, note
- sales: invoice_no, party_id?, date, subtotal, discount, vat, total, paid, due, method(cash|bkash|nagad|card|bank|other), kind(pos|quick|online), note
- sale_items: sale_id, product_id?, name, qty, unit_price, buy_price, total, warranty_until?
- purchases / purchase_items: mirror of sales (bill_no, supplier party_id)
- expenses: category_id, amount, date, method, note
- cash_entries: amount(±), type(sale|purchase|expense|received|paid|capital_in|capital_out|cash_in|cash_out), method, ref_id, date, note
- online_orders: order_no, customer_name, phone, address, items_json, subtotal, delivery_charge, total, status(pending|confirmed|delivered|cancelled), sale_id?
Derived (never stored): stock qty = Σ movements; party balance = Σ ledger; cash balance = Σ cash_entries; capital = Σ capital entries.
