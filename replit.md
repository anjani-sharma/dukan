# ElectraShop Manager

## Overview

Full-stack electrical shop management system with a React web dashboard and Telegram bot integration.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
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
- **Dashboard**: Today's sales, month totals, outstanding balance summary, 30-day sales chart, top debtors, recent activity feed
- **Sales**: Full transaction list, New Sale form with line items, credit balance auto-calculation, voice recording (Whisper AI transcription pre-fills form)
- **Customers**: Customer list with outstanding balances, click-through to full history (sales + payments), Record Payment flow
- **Products**: Inventory list with low-stock warnings, add/edit/delete products
- **Invoices**: Purchase/sale invoice list, upload invoice photo (GPT-4o-mini auto-extracts vendor, amount, date)

### Telegram Bot
- `/summary` — today's and month's sales summary
- `/outstanding` — list of customers with balances
- `/lowstock` — products below threshold
- Voice messages → Whisper transcription → auto-logged sale
- Invoice photos → GPT-4o-mini extraction → logged invoice

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## DB Schema (lib/db/src/schema/)

- `products` — name, sku, category, costPrice, sellingPrice, stockQuantity, lowStockThreshold, unit
- `customers` — name, phone, email, address
- `sales` — customerId, items (JSONB), totalAmount, paidAmount, creditAmount, source (web|telegram)
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
- `GET/POST /api/invoices`, `GET/DELETE /api/invoices/:id`
- `GET /api/dashboard/summary|recent-activity|sales-chart|top-customers`
- `POST /api/ai/transcribe-voice` — base64 audio → transcript + parsed sale items
- `POST /api/ai/parse-invoice-image` — base64 image → vendor, amount, date
- `POST /api/telegram/webhook` — Telegram bot handler

## Notes

- Telegram webhook registered at the public Replit domain `/api/telegram/webhook`
- Customer outstanding balance = totalCredit - totalPaid (computed live from sales + payments)
- Sales items stored as JSONB array: `[{productId, productName, quantity, unitPrice, subtotal}]`
- AI invoice parsing uses GPT-4o-mini vision; voice uses Whisper-1 model
