import { Router } from "express";
import { db } from "@workspace/db";
import { salesTable, customersTable, productsTable, creditPaymentsTable, invoicesTable } from "@workspace/db";
import OpenAI from "openai";
import { logger } from "../lib/logger";

const router = Router();

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function sendTelegramMessage(chatId: number | string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function getDashboardSummaryText(): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const allSales = await db.select().from(salesTable);
  const allProducts = await db.select().from(productsTable);
  const allCustomers = await db.select().from(customersTable);
  const allPayments = await db.select().from(creditPaymentsTable);

  const todaySales = allSales
    .filter((s) => s.createdAt >= todayStart)
    .reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);
  const monthSales = allSales
    .filter((s) => s.createdAt >= monthStart)
    .reduce((sum, s) => sum + parseFloat(s.totalAmount as string), 0);
  const todayTx = allSales.filter((s) => s.createdAt >= todayStart).length;
  const totalCredit = allSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
  const totalPaid = allPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
  const outstanding = Math.max(0, totalCredit - totalPaid);
  const lowStock = allProducts.filter((p) => p.stockQuantity <= p.lowStockThreshold);

  let msg = `📊 <b>Daily Summary</b>\n\n`;
  msg += `📅 Today: <b>${todayTx} sales</b> — Rs ${todaySales.toFixed(2)}\n`;
  msg += `📆 This Month: Rs ${monthSales.toFixed(2)}\n`;
  msg += `💳 Outstanding Balances: Rs ${outstanding.toFixed(2)}\n`;
  msg += `👥 Customers: ${allCustomers.length} | 📦 Products: ${allProducts.length}\n`;

  if (lowStock.length > 0) {
    msg += `\n⚠️ <b>Low Stock (${lowStock.length} items):</b>\n`;
    lowStock.slice(0, 5).forEach((p) => {
      msg += `  • ${p.name}: ${p.stockQuantity} ${p.unit} left\n`;
    });
  }

  const topDebtors = allCustomers
    .map((c) => {
      const cSales = allSales.filter((s) => s.customerId === c.id);
      const cPayments = allPayments.filter((p) => p.customerId === c.id);
      const credit = cSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
      const paid = cPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
      return { name: c.name, balance: Math.max(0, credit - paid) };
    })
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);

  if (topDebtors.length > 0) {
    msg += `\n💰 <b>Top Unpaid Customers:</b>\n`;
    topDebtors.forEach((c) => {
      msg += `  • ${c.name}: Rs ${c.balance.toFixed(2)}\n`;
    });
  }

  return msg;
}

router.post("/telegram/webhook", async (req, res) => {
  const update = req.body;
  res.json({ ok: true });

  try {
    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const text: string | undefined = message.text;
    const voice = message.voice;
    const photo = message.photo;

    if (text === "/start" || text === "/help") {
      await sendTelegramMessage(
        chatId,
        `👋 <b>Electrical Shop Manager</b>\n\n` +
          `Commands:\n` +
          `/summary — Today's sales summary\n` +
          `/outstanding — Customer balances\n` +
          `/lowstock — Low stock items\n` +
          `\n🎤 Voice message → Log a sale automatically\n` +
          `📸 Photo → Scan an invoice`,
      );
      return;
    }

    if (text === "/summary") {
      const summary = await getDashboardSummaryText();
      await sendTelegramMessage(chatId, summary);
      return;
    }

    if (text === "/outstanding") {
      const allCustomers = await db.select().from(customersTable);
      const allSales = await db.select().from(salesTable);
      const allPayments = await db.select().from(creditPaymentsTable);

      const debtors = allCustomers
        .map((c) => {
          const cSales = allSales.filter((s) => s.customerId === c.id);
          const cPayments = allPayments.filter((p) => p.customerId === c.id);
          const credit = cSales.reduce((sum, s) => sum + parseFloat(s.creditAmount as string), 0);
          const paid = cPayments.reduce((sum, p) => sum + parseFloat(p.amount as string), 0);
          return { name: c.name, phone: c.phone, balance: Math.max(0, credit - paid) };
        })
        .filter((c) => c.balance > 0)
        .sort((a, b) => b.balance - a.balance);

      if (debtors.length === 0) {
        await sendTelegramMessage(chatId, "✅ No outstanding balances!");
        return;
      }

      let msg = `💳 <b>Outstanding Balances:</b>\n\n`;
      debtors.forEach((d, i) => {
        msg += `${i + 1}. ${d.name}${d.phone ? ` (${d.phone})` : ""}: Rs ${d.balance.toFixed(2)}\n`;
      });
      await sendTelegramMessage(chatId, msg);
      return;
    }

    if (text === "/lowstock") {
      const products = await db.select().from(productsTable);
      const low = products.filter((p) => p.stockQuantity <= p.lowStockThreshold);
      if (low.length === 0) {
        await sendTelegramMessage(chatId, "✅ All items are well-stocked!");
        return;
      }
      let msg = `⚠️ <b>Low Stock Items:</b>\n\n`;
      low.forEach((p) => {
        msg += `• ${p.name}: ${p.stockQuantity} ${p.unit} (threshold: ${p.lowStockThreshold})\n`;
      });
      await sendTelegramMessage(chatId, msg);
      return;
    }

    // Voice message → auto-log sale
    if (voice) {
      await sendTelegramMessage(chatId, "🎤 Processing your voice message...");
      const token = process.env.TELEGRAM_BOT_TOKEN!;
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${voice.file_id}`);
      const fileData = (await fileRes.json()) as { result: { file_path: string } };
      const filePath = fileData.result.file_path;
      const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      const openai = getOpenAI();
      const { Readable } = await import("stream");
      const stream = Readable.from(audioBuffer);
      (stream as Record<string, unknown>).name = "audio.ogg";

      const transcription = await openai.audio.transcriptions.create({
        file: stream as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
        model: "whisper-1",
      });

      const transcript = transcription.text;

      const parseResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an assistant for an electrical shop. Extract sale items from voice transcripts.
Return JSON: {"items": [{"productName": string, "quantity": number, "unitPrice": number}], "notes": string|null}
Return only valid JSON.`,
          },
          { role: "user", content: transcript },
        ],
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(parseResponse.choices[0]?.message?.content ?? "{}");
      const items: { productName: string; quantity: number; unitPrice: number }[] = parsed.items ?? [];

      if (items.length === 0) {
        await sendTelegramMessage(
          chatId,
          `🎤 I heard: "<i>${transcript}</i>"\n\nCouldn't identify sale items. Please say product name, quantity, and price.`,
        );
        return;
      }

      const totalAmount = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const enrichedItems = items.map((i) => ({
        productId: null,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.quantity * i.unitPrice,
      }));

      await db.insert(salesTable).values({
        customerId: null,
        items: enrichedItems,
        totalAmount: String(totalAmount),
        paidAmount: String(totalAmount),
        creditAmount: "0",
        notes: parsed.notes ?? `Voice: ${transcript}`,
        source: "telegram",
      });

      let msg = `✅ <b>Sale Recorded!</b>\n\n🎤 "<i>${transcript}</i>"\n\n<b>Items:</b>\n`;
      items.forEach((i) => {
        msg += `  • ${i.productName} × ${i.quantity} @ Rs ${i.unitPrice} = Rs ${(i.quantity * i.unitPrice).toFixed(2)}\n`;
      });
      msg += `\n<b>Total: Rs ${totalAmount.toFixed(2)}</b>`;
      await sendTelegramMessage(chatId, msg);
      return;
    }

    // Photo → invoice scan
    if (photo) {
      await sendTelegramMessage(chatId, "📸 Scanning your invoice...");
      const token = process.env.TELEGRAM_BOT_TOKEN!;
      const largestPhoto = photo[photo.length - 1];
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${largestPhoto.file_id}`);
      const fileData = (await fileRes.json()) as { result: { file_path: string } };
      const filePath = fileData.result.file_path;
      const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      const imgBase64 = imgBuffer.toString("base64");

      const openai = getOpenAI();
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract invoice data. Return JSON: {"vendorOrCustomer": string|null, "amount": number|null, "invoiceDate": "YYYY-MM-DD"|null, "items": [{"name": string, "quantity": number, "unitPrice": number, "subtotal": number}]|null, "rawText": string|null}`,
              },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imgBase64}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      const data = JSON.parse(response.choices[0]?.message?.content ?? "{}");

      await db.insert(invoicesTable).values({
        type: "purchase",
        vendorOrCustomer: data.vendorOrCustomer ?? null,
        amount: data.amount != null ? String(data.amount) : null,
        invoiceDate: data.invoiceDate ?? null,
        notes: "Scanned via Telegram",
        aiExtractedData: data,
      });

      let msg = `✅ <b>Invoice Saved!</b>\n\n`;
      if (data.vendorOrCustomer) msg += `🏪 Vendor: ${data.vendorOrCustomer}\n`;
      if (data.invoiceDate) msg += `📅 Date: ${data.invoiceDate}\n`;
      if (data.amount) msg += `💰 Amount: Rs ${data.amount}\n`;
      if (data.items?.length) {
        msg += `\n<b>Items:</b>\n`;
        (data.items as { name: string; quantity: number; unitPrice: number }[]).slice(0, 5).forEach((i) => {
          msg += `  • ${i.name} × ${i.quantity} @ Rs ${i.unitPrice}\n`;
        });
      }
      await sendTelegramMessage(chatId, msg);
      return;
    }

    if (text && !text.startsWith("/")) {
      await sendTelegramMessage(chatId, `💡 Send a voice message to log a sale, or a photo to scan an invoice.\nType /help for all commands.`);
    }
  } catch (err) {
    logger.error({ err }, "Telegram webhook error");
  }
});

export default router;
