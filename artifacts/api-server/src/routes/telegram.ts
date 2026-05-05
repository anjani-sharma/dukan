import { Router } from "express";
import { db } from "@workspace/db";
import {
  salesTable, customersTable, productsTable, creditPaymentsTable,
  invoicesTable, telegramSubscribersTable, vendorPaymentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendDailyReport, sendWeeklyReport } from "../scheduler";
import { uploadToR2 } from "../lib/r2";
import { withRetry } from "../lib/retry";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";

const router = Router();

// ── In-memory conversation state (per chat) ──────────────────────────────────
interface PendingOcr {
  kind: "ocr";
  ocrType: "invoice" | "payment";
  data: Record<string, unknown>;
  imageUrl: string;
}
interface PendingVoice {
  kind: "voice";
  items: Array<{ productName: string; quantity: number; unitPrice: number }>;
  missingItems: string[];
  transcript: string;
}
const pendingState = new Map<string, PendingOcr | PendingVoice>();

// ── Telegram API helpers ──────────────────────────────────────────────────────
function token() {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

async function tgPost(method: string, body: unknown) {
  await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendTelegramMessage(chatId: number | string, text: string) {
  if (!token()) return;
  await tgPost("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

async function sendWithKeyboard(
  chatId: number | string,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>,
) {
  if (!token()) return;
  await tgPost("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

async function answerCallbackQuery(id: string, text?: string) {
  await tgPost("answerCallbackQuery", { callback_query_id: id, text });
}

// ── AI helpers ────────────────────────────────────────────────────────────────
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : text.trim();
}

// ── Fuzzy product matching ────────────────────────────────────────────────────
function wordSim(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9.]/g, " ").split(/\s+/).filter(Boolean));
  const ta = tok(a); const tb = tok(b);
  let common = 0; for (const w of ta) if (tb.has(w)) common++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : common / union;
}

function fuzzyMatchProduct(
  name: string,
  allProducts: Array<{ id: number; name: string }>,
): { id: number; name: string } | null {
  const lower = name.toLowerCase().trim();
  return allProducts.find((p) => p.name.toLowerCase() === lower)
    ?? allProducts.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()))
    ?? (() => {
      let best: { id: number; name: string } | null = null;
      let bestScore = 0.35;
      for (const p of allProducts) {
        const s = wordSim(p.name, name);
        if (s > bestScore) { best = p; bestScore = s; }
      }
      return best;
    })();
}

// ── Dashboard summary text ────────────────────────────────────────────────────
async function getDashboardSummaryText(): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [allSales, allProducts, allCustomers, allPayments] = await Promise.all([
    db.select().from(salesTable),
    db.select().from(productsTable),
    db.select().from(customersTable),
    db.select().from(creditPaymentsTable),
  ]);

  const todaySales = allSales.filter((s) => s.createdAt >= todayStart)
    .reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);
  const monthSales = allSales.filter((s) => s.createdAt >= monthStart)
    .reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);
  const todayTx = allSales.filter((s) => s.createdAt >= todayStart).length;
  const totalCredit = allSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
  const totalPaid = allPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
  const outstanding = Math.max(0, totalCredit - totalPaid);
  const lowStock = allProducts.filter((p) => p.stockQuantity <= p.lowStockThreshold);

  let msg = `📊 <b>Daily Summary</b>\n\n`;
  msg += `📅 Today: <b>${todayTx} sales</b> — ₹${todaySales.toFixed(2)}\n`;
  msg += `📆 This Month: ₹${monthSales.toFixed(2)}\n`;
  msg += `💳 Outstanding: ₹${outstanding.toFixed(2)}\n`;
  msg += `👥 Customers: ${allCustomers.length} | 📦 Products: ${allProducts.length}\n`;

  if (lowStock.length > 0) {
    msg += `\n⚠️ <b>Low Stock (${lowStock.length}):</b>\n`;
    lowStock.slice(0, 5).forEach((p) => { msg += `  • ${p.name}: ${p.stockQuantity} ${p.unit}\n`; });
  }

  const topDebtors = allCustomers
    .map((c) => {
      const credit = allSales.filter((s) => s.customerId === c.id).reduce((s, r) => s + parseFloat(r.creditAmount as string), 0);
      const paid = allPayments.filter((p) => p.customerId === c.id).reduce((s, r) => s + parseFloat(r.amount as string), 0);
      return { name: c.name, balance: Math.max(0, credit - paid) };
    })
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);

  if (topDebtors.length > 0) {
    msg += `\n💰 <b>Top Unpaid:</b>\n`;
    topDebtors.forEach((c) => { msg += `  • ${c.name}: ₹${c.balance.toFixed(2)}\n`; });
  }
  return msg;
}

// ── OCR: auto-detect and extract ─────────────────────────────────────────────
async function runOcr(imgBase64: string): Promise<{ ocrType: "invoice" | "payment"; data: Record<string, unknown> }> {
  const anthropic = getAnthropic();
  const response = await withRetry(() => anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1200,
    system: `You are an expert at reading Indian shop documents. Given an image, first classify it then extract data.

CLASSIFICATION:
- "invoice": purchase invoice, delivery challan, estimate — has product line items with quantities and prices
- "payment": payment receipt — GPay/PhonePe screenshot, bank deposit slip, cash receipt, UPI confirmation

Return JSON only (no markdown):
{
  "ocrType": "invoice" | "payment",
  "invoice": {
    "vendorOrCustomer": string|null,
    "amount": number|null,
    "invoiceDate": "YYYY-MM-DD"|null,
    "invoiceNumber": string|null,
    "items": [{"name": string, "quantity": number, "unit": string, "unitPrice": number, "subtotal": number}]|null
  },
  "payment": {
    "amount": number|null,
    "paymentDate": "YYYY-MM-DD"|null,
    "paymentMethod": "cash"|"bank"|"gpay"|"upi"|"cheque",
    "referenceNumber": string|null,
    "merchantOrVendor": string|null,
    "notes": string|null
  }
}
Fill only the matching object; leave the other as null values.`,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imgBase64 } },
        { type: "text", text: "Classify and extract data from this document." },
      ],
    }],
  }));

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = JSON.parse(extractJson(raw));
  const ocrType: "invoice" | "payment" = parsed.ocrType === "payment" ? "payment" : "invoice";
  const data = ocrType === "payment" ? (parsed.payment ?? {}) : (parsed.invoice ?? {});
  return { ocrType, data };
}

function formatOcrPreview(ocrType: "invoice" | "payment", data: Record<string, unknown>): string {
  if (ocrType === "payment") {
    let msg = `💳 <b>Payment Receipt Detected</b>\n\n`;
    if (data.amount) msg += `💰 Amount: ₹${data.amount}\n`;
    if (data.paymentDate) msg += `📅 Date: ${data.paymentDate}\n`;
    if (data.paymentMethod) msg += `🏦 Method: ${data.paymentMethod}\n`;
    if (data.merchantOrVendor) msg += `🏪 To/From: ${data.merchantOrVendor}\n`;
    if (data.referenceNumber) msg += `🔖 Ref: ${data.referenceNumber}\n`;
    return msg;
  }
  let msg = `🧾 <b>Invoice Detected</b>\n\n`;
  if (data.vendorOrCustomer) msg += `🏪 Vendor: ${data.vendorOrCustomer}\n`;
  if (data.invoiceDate) msg += `📅 Date: ${data.invoiceDate}\n`;
  if (data.amount) msg += `💰 Amount: ₹${data.amount}\n`;
  const items = data.items as Array<{ name: string; quantity: number; unitPrice: number }> | null;
  if (items?.length) {
    msg += `\n<b>Items (${items.length}):</b>\n`;
    items.slice(0, 5).forEach((i) => { msg += `  • ${i.name} × ${i.quantity} @ ₹${i.unitPrice}\n`; });
    if (items.length > 5) msg += `  … +${items.length - 5} more\n`;
  }
  return msg;
}

async function saveOcrResult(ocrType: "invoice" | "payment", data: Record<string, unknown>, imageUrl: string) {
  if (ocrType === "payment") {
    await db.insert(vendorPaymentsTable).values({
      vendorName: (data.merchantOrVendor as string | null) ?? "Unknown",
      amount: data.amount != null ? String(data.amount) : "0",
      paymentDate: (data.paymentDate as string | null) ?? null,
      paymentMethod: (data.paymentMethod as string | null) ?? "cash",
      direction: "outflow",
      proofImageUrl: imageUrl,
      notes: (data.referenceNumber as string | null) ? `Ref: ${data.referenceNumber}` : "Scanned via Telegram",
    });
  } else {
    await db.insert(invoicesTable).values({
      type: "purchase",
      vendorOrCustomer: (data.vendorOrCustomer as string | null) ?? null,
      amount: data.amount != null ? String(data.amount) : null,
      invoiceDate: (data.invoiceDate as string | null) ?? null,
      imageUrl,
      notes: "Scanned via Telegram",
      aiExtractedData: data,
    });
  }
}

// ── Voice: parse intent + items ────────────────────────────────────────────────
interface ParsedVoice {
  intent: "record_sale" | "edit_sale" | "delete_sale" | "query" | "unknown";
  items: Array<{ productName: string; quantity: number; unitPrice: number }>;
  notes: string | null;
}

async function parseVoiceIntent(transcript: string): Promise<ParsedVoice> {
  const openai = getOpenAI();
  const res = await withRetry(() => openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 512,
    messages: [
      {
        role: "system",
        content: `You are an assistant for an Indian electrical shop. Parse voice transcripts (Hindi/English/mixed).

Common electrical items: switch, socket, plate, MCB, wire, cable, holder, fan, LED, bulb, tube, conduit, PVC, RCCB, DB box, coil, battery holder, converter.
Hindi hints: becha=sold, pcs/piece=quantity, kal=yesterday, aaj=today, baad mein=on credit.

Detect intent:
- "record_sale": user is recording a new sale
- "edit_sale": user wants to modify an existing sale (e.g. "change", "update", "galat tha")
- "delete_sale": user wants to remove a sale
- "query": user is asking about stock, balance, or report
- "unknown": unclear

Return JSON only:
{
  "intent": "record_sale"|"edit_sale"|"delete_sale"|"query"|"unknown",
  "items": [{"productName": string, "quantity": number, "unitPrice": number}],
  "notes": string|null
}
If price not mentioned, set unitPrice=0. Return valid JSON only.`,
      },
      { role: "user", content: transcript },
    ],
  }));
  try {
    return JSON.parse(extractJson(res.choices[0]?.message?.content ?? "{}")) as ParsedVoice;
  } catch {
    return { intent: "unknown", items: [], notes: null };
  }
}

// ── Callback query handler ────────────────────────────────────────────────────
async function handleCallbackQuery(cq: {
  id: string;
  from: { id: number };
  message?: { chat: { id: number } };
  data?: string;
}) {
  const chatId = cq.message?.chat?.id ?? cq.from.id;
  const data = cq.data ?? "";

  if (data.startsWith("ocr_save_")) {
    const key = data.slice("ocr_save_".length);
    const state = pendingState.get(key) as PendingOcr | undefined;
    if (!state || state.kind !== "ocr") {
      await answerCallbackQuery(cq.id, "Expired — please resend the photo.");
      return;
    }
    pendingState.delete(key);
    await saveOcrResult(state.ocrType, state.data, state.imageUrl);
    await answerCallbackQuery(cq.id, "Saved!");
    await sendTelegramMessage(chatId, `✅ <b>Saved!</b>`);
    return;
  }

  if (data.startsWith("ocr_edit_")) {
    const key = data.slice("ocr_edit_".length);
    const state = pendingState.get(key) as PendingOcr | undefined;
    if (!state || state.kind !== "ocr") {
      await answerCallbackQuery(cq.id, "Expired — please resend the photo.");
      return;
    }
    pendingState.set(`edit_${chatId}`, state);
    pendingState.delete(key);
    await answerCallbackQuery(cq.id);
    await sendTelegramMessage(
      chatId,
      `✏️ Send corrections as <code>field: value</code> pairs, one per line.\n` +
      `Example:\n<code>amount: 1200\nvendorOrCustomer: Sharma Traders\ninvoiceDate: 2026-05-05</code>`,
    );
    return;
  }

  if (data.startsWith("ocr_cancel_")) {
    const key = data.slice("ocr_cancel_".length);
    pendingState.delete(key);
    await answerCallbackQuery(cq.id, "Cancelled.");
    await sendTelegramMessage(chatId, `❌ Cancelled.`);
    return;
  }

  if (data.startsWith("voice_save_")) {
    const key = data.slice("voice_save_".length);
    const state = pendingState.get(key) as PendingVoice | undefined;
    if (!state || state.kind !== "voice") {
      await answerCallbackQuery(cq.id, "Expired — please resend the voice message.");
      return;
    }
    pendingState.delete(key);
    await saveSaleFromItems(state.items, state.transcript);
    await answerCallbackQuery(cq.id, "Sale saved!");
    const total = state.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    await sendTelegramMessage(chatId, `✅ <b>Sale Saved!</b> Total: ₹${total.toFixed(2)}`);
    return;
  }

  if (data.startsWith("voice_cancel_")) {
    const key = data.slice("voice_cancel_".length);
    pendingState.delete(key);
    await answerCallbackQuery(cq.id, "Cancelled.");
    await sendTelegramMessage(chatId, `❌ Cancelled.`);
    return;
  }

  await answerCallbackQuery(cq.id);
}

// ── OCR edit reply handler ────────────────────────────────────────────────────
async function handleOcrEditReply(chatId: number, text: string, state: PendingOcr) {
  const corrections: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const [k, ...rest] = line.split(":");
    if (k && rest.length) {
      const key = k.trim().replace(/\s+/g, "");
      const val = rest.join(":").trim();
      const num = parseFloat(val);
      corrections[key] = isNaN(num) ? val : num;
    }
  }
  const updated = { ...state.data, ...corrections };
  const key = `ocr_${chatId}_${Date.now()}`;
  const updatedState: PendingOcr = { kind: "ocr", ocrType: state.ocrType, data: updated, imageUrl: state.imageUrl };
  pendingState.set(key, updatedState);
  pendingState.delete(`edit_${chatId}`);

  const preview = formatOcrPreview(state.ocrType, updated);
  await sendWithKeyboard(chatId, preview + `\n\nSave this?`, [
    [
      { text: "✅ Save", callback_data: `ocr_save_${key}` },
      { text: "✏️ Edit again", callback_data: `ocr_edit_${key}` },
      { text: "❌ Cancel", callback_data: `ocr_cancel_${key}` },
    ],
  ]);
}

// ── Save sale helper ──────────────────────────────────────────────────────────
async function saveSaleFromItems(
  items: Array<{ productName: string; quantity: number; unitPrice: number }>,
  transcript: string,
) {
  const allProducts = await db.select().from(productsTable);
  const enriched = items.map((i) => {
    const match = fuzzyMatchProduct(i.productName, allProducts);
    return {
      productId: match?.id ?? null,
      productName: match?.name ?? i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      subtotal: i.quantity * i.unitPrice,
    };
  });
  const total = enriched.reduce((s, i) => s + i.subtotal, 0);
  await db.insert(salesTable).values({
    items: enriched,
    totalAmount: String(total),
    paidAmount: String(total),
    creditAmount: "0",
    notes: `Voice: ${transcript}`,
    source: "telegram",
  });
}

// ── Main webhook ──────────────────────────────────────────────────────────────
router.post("/telegram/webhook", async (req, res) => {
  const update = req.body;
  res.json({ ok: true });

  try {
    // Callback query (inline button press)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message) return;

    const chatId: number = message.chat.id;
    const text: string | undefined = message.text;
    const voice = message.voice;
    const photo = message.photo;

    // Allowlist check
    const allowedIds = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
    if (allowedIds) {
      const ids = allowedIds.split(",").map((id: string) => id.trim());
      if (!ids.includes(String(chatId))) return;
    }

    // ── Commands ────────────────────────────────────────────────────────────

    if (text === "/myid") {
      await sendTelegramMessage(chatId, `Your chat ID is: <code>${chatId}</code>`);
      return;
    }

    if (text === "/start" || text === "/help") {
      await sendTelegramMessage(
        chatId,
        `👋 <b>दोकाने · RK Enterprises</b>\n\n` +
          `Commands:\n` +
          `/summary — Today's sales summary\n` +
          `/weekly — This week's report\n` +
          `/outstanding — Customer balances\n` +
          `/lowstock — Low stock items\n` +
          `/subscribe — Get daily & weekly auto-reports\n` +
          `/unsubscribe — Stop auto-reports\n` +
          `\n🎤 Voice → Log a sale\n📸 Photo → Scan invoice or payment receipt`,
      );
      return;
    }

    if (text === "/subscribe") {
      const chatTitle = message.chat.title ?? message.chat.first_name ?? String(chatId);
      await db.insert(telegramSubscribersTable).values({ chatId: String(chatId), chatTitle }).onConflictDoNothing();
      await sendTelegramMessage(chatId, `✅ Subscribed! Daily report 7 PM IST, weekly Sunday 8 AM IST.`);
      return;
    }

    if (text === "/unsubscribe") {
      await db.delete(telegramSubscribersTable).where(eq(telegramSubscribersTable.chatId, String(chatId)));
      await sendTelegramMessage(chatId, `🔕 Unsubscribed.`);
      return;
    }

    if (text === "/weekly") { await sendWeeklyReport(); return; }

    if (text === "/summary") {
      await sendTelegramMessage(chatId, await getDashboardSummaryText());
      return;
    }

    if (text === "/outstanding") {
      const [allCustomers, allSales, allPayments] = await Promise.all([
        db.select().from(customersTable),
        db.select().from(salesTable),
        db.select().from(creditPaymentsTable),
      ]);
      const debtors = allCustomers
        .map((c) => {
          const credit = allSales.filter((s) => s.customerId === c.id).reduce((s, r) => s + parseFloat(r.creditAmount as string), 0);
          const paid = allPayments.filter((p) => p.customerId === c.id).reduce((s, r) => s + parseFloat(r.amount as string), 0);
          return { name: c.name, phone: c.phone, balance: Math.max(0, credit - paid) };
        })
        .filter((c) => c.balance > 0)
        .sort((a, b) => b.balance - a.balance);
      if (debtors.length === 0) { await sendTelegramMessage(chatId, "✅ No outstanding balances!"); return; }
      let msg = `💳 <b>Outstanding Balances:</b>\n\n`;
      debtors.forEach((d, i) => { msg += `${i + 1}. ${d.name}${d.phone ? ` (${d.phone})` : ""}: ₹${d.balance.toFixed(2)}\n`; });
      await sendTelegramMessage(chatId, msg);
      return;
    }

    if (text === "/lowstock") {
      const products = await db.select().from(productsTable);
      const low = products.filter((p) => p.stockQuantity <= p.lowStockThreshold);
      if (low.length === 0) { await sendTelegramMessage(chatId, "✅ All items well-stocked!"); return; }
      let msg = `⚠️ <b>Low Stock:</b>\n\n`;
      low.forEach((p) => { msg += `• ${p.name}: ${p.stockQuantity} ${p.unit} (min: ${p.lowStockThreshold})\n`; });
      await sendTelegramMessage(chatId, msg);
      return;
    }

    // ── Handle pending OCR edit reply ────────────────────────────────────────
    const editState = pendingState.get(`edit_${chatId}`) as PendingOcr | undefined;
    if (editState && text && !text.startsWith("/")) {
      await handleOcrEditReply(chatId, text, editState);
      return;
    }

    // ── Voice message ─────────────────────────────────────────────────────────
    if (voice) {
      await sendTelegramMessage(chatId, "🎤 Processing...");
      const tkn = token();
      const fileRes = await fetch(`https://api.telegram.org/bot${tkn}/getFile?file_id=${voice.file_id}`);
      const fileData = (await fileRes.json()) as { result: { file_path: string } };
      const audioRes = await fetch(`https://api.telegram.org/file/bot${tkn}/${fileData.result.file_path}`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      const openai = getOpenAI();
      const { Readable } = await import("stream");
      const stream = Readable.from(audioBuffer);
      (stream as unknown as Record<string, unknown>).name = "audio.ogg";

      const transcription = await withRetry(() => openai.audio.transcriptions.create({
        file: stream as unknown as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
        model: "whisper-1",
        language: "hi",
        prompt: "Indian electrical shop. Items: switch, MCB, wire, socket, plate, bulb, LED, fan, RCCB, DB box, conduit, holder, cable, coil.",
      }));
      const transcript = transcription.text;
      const parsed = await parseVoiceIntent(transcript);

      if (parsed.intent === "query") {
        const summary = await getDashboardSummaryText();
        await sendTelegramMessage(chatId, `🎤 "<i>${transcript}</i>"\n\n${summary}`);
        return;
      }

      if (parsed.intent === "edit_sale") {
        await sendTelegramMessage(chatId, `🎤 "<i>${transcript}</i>"\n\n✏️ Sale edits via voice aren't supported yet — please use the web dashboard.`);
        return;
      }

      if (parsed.intent === "delete_sale") {
        await sendTelegramMessage(chatId, `🎤 "<i>${transcript}</i>"\n\n🗑️ Sale deletion via voice isn't supported yet — please use the web dashboard.`);
        return;
      }

      if (!parsed.items || parsed.items.length === 0) {
        await sendTelegramMessage(chatId, `🎤 "<i>${transcript}</i>"\n\nCouldn't identify sale items. Please say product name, quantity, and price.`);
        return;
      }

      // Check for missing prices
      const missingPrices = parsed.items.filter((i) => i.unitPrice === 0).map((i) => i.productName);

      if (missingPrices.length > 0) {
        // Try catalog price fallback
        const allProducts = await db.select().from(productsTable);
        let stillMissing: string[] = [];
        const itemsWithPrices = parsed.items.map((i) => {
          if (i.unitPrice > 0) return i;
          const match = fuzzyMatchProduct(i.productName, allProducts);
          const catalogPrice = match ? parseFloat((match as unknown as { sellingPrice: string }).sellingPrice ?? "0") : 0;
          if (catalogPrice > 0) return { ...i, unitPrice: catalogPrice };
          stillMissing.push(i.productName);
          return i;
        });

        if (stillMissing.length > 0) {
          // Show preview and ask for confirmation with prices
          const key = `voice_${chatId}_${Date.now()}`;
          pendingState.set(key, { kind: "voice", items: itemsWithPrices, missingItems: stillMissing, transcript });

          let msg = `🎤 "<i>${transcript}</i>"\n\n`;
          msg += `⚠️ Price unknown for: <b>${stillMissing.join(", ")}</b>\n\n`;
          msg += `<b>Items so far:</b>\n`;
          itemsWithPrices.forEach((i) => {
            msg += `  • ${i.productName} × ${i.quantity}`;
            msg += i.unitPrice > 0 ? ` @ ₹${i.unitPrice}` : ` @ ₹?`;
            msg += "\n";
          });
          msg += `\nSave with ₹0 for unknown prices, or cancel and resend with prices.`;

          await sendWithKeyboard(chatId, msg, [[
            { text: "✅ Save anyway", callback_data: `voice_save_${key}` },
            { text: "❌ Cancel", callback_data: `voice_cancel_${key}` },
          ]]);
          return;
        }

        // All prices resolved from catalog
        parsed.items = itemsWithPrices;
      }

      // All prices known — show confirm + save
      const total = parsed.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const key = `voice_${chatId}_${Date.now()}`;
      pendingState.set(key, { kind: "voice", items: parsed.items, missingItems: [], transcript });

      let msg = `🎤 "<i>${transcript}</i>"\n\n<b>Items:</b>\n`;
      parsed.items.forEach((i) => { msg += `  • ${i.productName} × ${i.quantity} @ ₹${i.unitPrice} = ₹${(i.quantity * i.unitPrice).toFixed(2)}\n`; });
      msg += `\n<b>Total: ₹${total.toFixed(2)}</b>`;

      await sendWithKeyboard(chatId, msg, [[
        { text: "✅ Save", callback_data: `voice_save_${key}` },
        { text: "❌ Cancel", callback_data: `voice_cancel_${key}` },
      ]]);
      return;
    }

    // ── Photo → unified OCR ──────────────────────────────────────────────────
    if (photo) {
      await sendTelegramMessage(chatId, "📸 Scanning...");
      const tkn = token();
      const largestPhoto = photo[photo.length - 1];
      const fileRes = await fetch(`https://api.telegram.org/bot${tkn}/getFile?file_id=${largestPhoto.file_id}`);
      const fileData = (await fileRes.json()) as { result: { file_path: string } };
      const imgRes = await fetch(`https://api.telegram.org/file/bot${tkn}/${fileData.result.file_path}`);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      const imgBase64 = imgBuffer.toString("base64");

      const r2Key = `invoices/tg-${randomUUID()}.jpg`;
      const r2Url = await uploadToR2(imgBuffer, r2Key, "image/jpeg");
      const imageUrl = r2Url ?? `data:image/jpeg;base64,${imgBase64}`;

      const { ocrType, data } = await runOcr(imgBase64);

      const key = `ocr_${chatId}_${Date.now()}`;
      pendingState.set(key, { kind: "ocr", ocrType, data, imageUrl });

      const preview = formatOcrPreview(ocrType, data);
      await sendWithKeyboard(chatId, preview + `\n\nSave this?`, [[
        { text: "✅ Save", callback_data: `ocr_save_${key}` },
        { text: "✏️ Edit", callback_data: `ocr_edit_${key}` },
        { text: "❌ Cancel", callback_data: `ocr_cancel_${key}` },
      ]]);
      return;
    }

    if (text && !text.startsWith("/")) {
      await sendTelegramMessage(chatId, `💡 Send a voice message to log a sale, or a photo to scan an invoice/receipt.\nType /help for commands.`);
    }
  } catch (err) {
    logger.error({ err }, "Telegram webhook error");
  }
});

export default router;
