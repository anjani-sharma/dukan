# ElectraShop Manager — CLAUDE.md

## What This Is

A full-stack **electrical shop management system** for Indian retailers (RK Enterprises). React web dashboard + Telegram bot. Built originally in Replit, now being developed locally with Claude Code.

**Domain:** Indian electrical retail — ₹ currency, GST compliance, credit tracking, WhatsApp reminders.

---

## Monorepo Structure

```
dukan/
├── artifacts/
│   ├── api-server/          Express 5 + TypeScript backend
│   ├── shop-manager/        React 19 + Vite frontend
│   └── mockup-sandbox/      Prototype sandbox (ignore)
├── lib/
│   ├── db/                  Drizzle ORM schema (9 tables)
│   ├── api-spec/            OpenAPI spec → Orval codegen
│   ├── api-zod/             Generated Zod schemas
│   └── api-client-react/    Generated TanStack Query hooks
└── scripts/
```

## Key Commands

```bash
pnpm run typecheck                                   # Full typecheck all packages
pnpm run build                                       # Typecheck + build all
pnpm --filter @workspace/api-spec run codegen        # Regenerate API hooks + Zod from OpenAPI spec
pnpm --filter @workspace/db run push                 # Push DB schema (dev only)
pnpm --filter @workspace/api-server run dev          # API server (port 3000)
pnpm --filter @workspace/shop-manager run dev        # Frontend (port 5173)
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui, Radix UI, TanStack Query, Wouter, Recharts, Framer Motion |
| Backend | Node.js 24, Express 5, TypeScript 5.9, Pino logging, node-cron |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Validation | Zod v4, drizzle-zod |
| AI | OpenAI Whisper-1 (voice), GPT-4o-mini (JSON extraction), Claude Opus 4.5 (invoice OCR), Claude Haiku 4.5 (receipt parsing) |
| Bot | Telegram Bot API (webhook) |
| Storage | Cloudflare R2 (optional) or base64 fallback |
| Codegen | Orval (OpenAPI → TanStack Query hooks + Zod) |
| Deploy | Render (API) + Vercel (frontend) + Neon (DB) |

---

## Database Schema (lib/db/src/schema/)

9 tables:
- `products` — name, sku, category, costPrice, sellingPrice, stockQuantity, lowStockThreshold, unit, hsnCode, gstRate
- `customers` — name, phone, email, address, outstandingBalance
- `sales` — customerId, items (JSONB), totalAmount, paidAmount, creditAmount, source (web|telegram), paymentMode (cash|upi|card|credit)
- `credit_payments` — customerId, amount, notes
- `purchases` — vendorName, purchaseDate, items (JSONB), totalAmount, notes
- `returns` — saleId, customerId, items (JSONB), reason, refundMode, totalAmount
- `invoices` — type (purchase|sale), vendorOrCustomer, amount, invoiceDate, imageUrl, imageHash, paid, lineItems (JSONB), stockUpdated, aiExtractedData, paymentProofUrl
- `vendor_payments` — vendorName, amount, paymentDate, paymentMethod, proofImageUrl, linkedInvoiceId, notes
- `telegram_subscribers` — chatId, chatTitle, reportTypes

Money columns use `numeric(12,2)` — avoid JS `parseFloat` in business logic, use integer paise where needed.

---

## API Routes (api-server)

```
GET/POST   /api/products
GET/POST   /api/customers
GET        /api/customers/:id/payments
POST       /api/customers/:id/payments
GET/POST   /api/sales
GET/POST   /api/purchases
GET/POST   /api/returns
GET/POST   /api/invoices
PATCH      /api/invoices/:id
POST       /api/invoices/:id/apply-stock
GET        /api/dashboard/summary
GET        /api/dashboard/recent-activity
GET        /api/dashboard/sales-chart
GET        /api/dashboard/top-customers
GET        /api/dashboard/cash-drawer
POST       /api/ai/transcribe-voice
POST       /api/ai/parse-invoice-image
POST       /api/ai/parse-payment-receipt
POST       /api/telegram/webhook
```

---

## Features

### Web Dashboard
- **Dashboard** — today's sales, month totals, outstanding balance, low-stock alerts, 30-day chart, cash drawer (Cash/UPI/Card/Credit pie), top debtors, recent activity
- **Sales** — transaction list, new sale with line items + payment mode, voice recording (Whisper), GST invoice print (new tab), return recording, duplicate detection (30s window)
- **Purchases** — stock-in with auto-stock increment, fuzzy product matching
- **Customers** — credit aging badges (0-30d/31-60d/61-90d/>90d), WhatsApp reminder links, payment recording
- **Products** — inventory table, HSN + GST rate fields, CSV import, low-stock warnings
- **Invoices** — photo upload → Claude OCR → auto-extract, apply to stock, payment proof tracking
- **Analytics** — sales charts, aging reports, stock analysis
- **Vendor Payments** — vendor payment tracking with proof upload

### Telegram Bot
- `/summary`, `/weekly`, `/outstanding`, `/lowstock`, `/subscribe`, `/unsubscribe`, `/myid`
- Voice messages → Whisper → auto-log sale
- Invoice photos → Claude OCR → auto-save
- Daily report at 7 PM IST, weekly Sunday 8 AM IST

---

## Environment Variables

### API Server
```
DATABASE_URL                        # Neon PostgreSQL connection string
OPENAI_API_KEY                      # Whisper-1 + GPT-4o-mini
ANTHROPIC_API_KEY                   # Claude Opus/Haiku for invoice/receipt OCR
TELEGRAM_BOT_TOKEN                  # Telegram bot
TELEGRAM_ALLOWED_CHAT_IDS           # Optional whitelist (comma-separated)
SESSION_SECRET                      # Express session
CLOUDFLARE_R2_ACCOUNT_ID            # Optional image storage
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
CLOUDFLARE_R2_BUCKET_NAME
CLOUDFLARE_R2_PUBLIC_URL
```

### Frontend
```
VITE_API_URL                        # e.g. http://localhost:3000 or https://dokan-api.onrender.com
```

---

## Known Issues & Improvement Areas

### Critical
- **No authentication** — entire app is open to anyone with the URL. Needs PIN/password or session auth.
- **No rate limiting** — API endpoints vulnerable to spam.
- **Base64 image fallback** — bloats DB when R2 not configured.

### Medium
- **PDF download** — invoices only do browser print, no PDF save/download.
- **Barcode scanning** — product entry is manual; camera barcode scan would speed up sales.
- **Expense tracking** — no general shop expenses, only stock purchases.
- **Audit trail** — no log of changes.
- **Telegram error reporting** — errors are silent to the user.

### Nice to Have
- PWA / offline mode
- Staff/salesman tracking + commission
- Bulk import/export (transactions)
- Batch operations

---

## Codegen Notes

- After changing the OpenAPI spec in `lib/api-spec`, run codegen to regenerate hooks + Zod.
- Orval config: `schemas` key removed from zod output to avoid duplicate TypeScript exports.
- Post-codegen: `api-zod/src/index.ts` is rewritten by the codegen script to avoid collision.

## Fuzzy Matching

Product name matching uses: exact → substring → word-overlap Jaccard (threshold ≥ 0.35). Used in purchases, invoice apply-stock, and Telegram voice sales.

## GST Invoice Print

Sales → Print GST Invoice opens a new browser tab with styled HTML: line items with HSN codes, CGST + SGST per item based on gstRate, grand total with tax breakdown.
