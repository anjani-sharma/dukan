# ElectraShop Manager

## Overview

Full-stack electrical shop management system with a React web dashboard and Telegram bot integration. Built for Indian electrical shops with ₹ currency, GST compliance, and WhatsApp integration.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec) — run `pnpm --filter @workspace/api-spec run codegen`
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + TanStack Query + wouter routing
- **UI**: shadcn/ui components, Tailwind CSS, Recharts
- **AI**: OpenAI (Whisper for voice transcription, GPT-4o-mini for invoice image parsing)
- **Bot**: Telegram Bot API (webhook-based)

## Artifacts

- `artifacts/api-server` — Express API server (port from `$PORT`, paths under `/api`)
- `artifacts/shop-manager` — React + Vite frontend (served at `/`)

## Features

### Web Dashboard
- **Dashboard**: Today's sales, month totals, outstanding balances, 30-day sales chart, top debtors, low-stock alerts, recent activity, **Today's Cash Drawer widget** (breakdown by Cash/UPI/Card/Credit with pie chart)
- **Sales**: Full transaction list with payment mode badges, New Sale form with line items + payment mode select, voice recording (Whisper AI), **Print GST Invoice** (opens styled tax invoice in new tab), **Record Return** dialog per sale
- **Purchases**: Stock-in recording page — vendor, date, items (auto-increments product stock on save)
- **Customers**: Grouped by outstanding/settled, **credit aging badges** (0-30d/31-60d/61-90d/>90d), "since" date, **WhatsApp reminder** link per customer
- **Products**: Inventory with cost/price/margin columns, **HSN code + GST rate** fields, **Import CSV** button, low-stock warnings
- **Invoices**: Upload invoice photo (GPT-4o-mini auto-extracts vendor, amount, date)
- **Analytics**: Sales charts and breakdowns
- **Vendors**: Vendor payment tracking

### Telegram Bot
- `/summary` — today's and month's sales summary
- `/outstanding` — list of customers with balances
- `/lowstock` — products below threshold
- Voice messages → Whisper transcription → auto-logged sale
- Invoice photos → GPT-4o-mini extraction → logged invoice

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec (also rewrites api-zod/src/index.ts to avoid duplicate exports)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## DB Schema (lib/db/src/schema/)

- `products` — name, sku, category, costPrice, sellingPrice, stockQuantity, lowStockThreshold, unit, **hsnCode**, **gstRate** (int, default 0)
- `customers` — name, phone, email, address, outstandingBalance
- `sales` — customerId, items (JSONB), totalAmount, paidAmount, creditAmount, source (web|telegram), **paymentMode** (cash|upi|card|credit)
- `purchases` — vendorName, purchaseDate, notes, items (JSONB), totalAmount
- `returns` — saleId (nullable), customerId (nullable), reason, refundMode, items (JSONB), totalAmount
- `invoices` — type (purchase|sale), vendorOrCustomer, amount, invoiceDate, imageUrl, aiExtractedData (JSONB)
- `credit_payments` — customerId, amount, notes

## Environment Secrets

- `DATABASE_URL` — PostgreSQL connection string
- `OPENAI_API_KEY` — for Whisper + GPT-4o-mini
- `TELEGRAM_BOT_TOKEN` — for Telegram webhook bot
- `SESSION_SECRET` — express session secret

## API Routes (api-server)

- `GET/POST /api/products`, `GET/PUT/DELETE /api/products/:id`
- `GET/POST /api/customers`, `GET/PUT/DELETE /api/customers/:id`
- `GET /api/customers/:id/payments`, `POST /api/customers/:customerId/payments`
- `GET/POST /api/sales`, `GET/DELETE /api/sales/:id`
- `GET/POST /api/purchases`, `DELETE /api/purchases/:id`
- `GET/POST /api/returns`, `DELETE /api/returns/:id`
- `GET/POST /api/invoices`, `GET/DELETE /api/invoices/:id`
- `GET /api/dashboard/summary|recent-activity|sales-chart|top-customers|cash-drawer`
- `POST /api/ai/transcribe-voice` — base64 audio → transcript + parsed sale items
- `POST /api/ai/parse-invoice-image` — base64 image → vendor, amount, date
- `POST /api/telegram/webhook` — Telegram bot handler

## Notes

- Telegram webhook registered at the public Replit domain `/api/telegram/webhook`
- Customer outstanding balance = totalCredit - totalPaid (computed live from sales + payments)
- Customer `agingBucket` is computed from the oldest unpaid sale date (0-30d / 31-60d / 61-90d / >90d)
- Sales items stored as JSONB array: `[{productId, productName, quantity, unitPrice, subtotal}]`
- AI invoice parsing uses GPT-4o-mini vision; voice uses Whisper-1 model
- GST invoice print: opens a new browser tab with a styled HTML tax invoice (CGST + SGST split, HSN codes)
- CSV import: accepts columns name, category, sku, costPrice, sellingPrice, stockQuantity, unit, hsnCode, gstRate
- Orval codegen: `schemas` key removed from zod output config to avoid TypeScript duplicate export collision; api-spec codegen script rewrites api-zod/src/index.ts after each run
