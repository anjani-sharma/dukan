import { Router } from "express";
import { TranscribeVoiceBody, ParseInvoiceImageBody } from "@workspace/api-zod";
import OpenAI from "openai";
import { z } from "zod";

const router = Router();

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

router.post("/ai/transcribe-voice", async (req, res) => {
  const body = TranscribeVoiceBody.parse(req.body);
  const openai = getOpenAI();

  try {
    const audioBuffer = Buffer.from(body.audioBase64, "base64");
    const mimeType = body.mimeType ?? "audio/ogg";
    const ext = mimeType.split("/")[1]?.split(";")[0] ?? "ogg";

    const { Readable } = await import("stream");
    const stream = Readable.from(audioBuffer);
    (stream as Record<string, unknown>).name = `audio.${ext}`;

    const transcription = await openai.audio.transcriptions.create({
      file: stream as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
      model: "whisper-1",
      language: "hi", // support Hindi + English mix
    });

    const transcript = transcription.text;

    const parseResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an assistant for an Indian electrical goods shop. Extract sale items from voice transcripts (may be Hindi, English or mixed).
Common electrical item names: switch, socket, plate, MCB, wire, cable, holder, fan, LED, bulb, tube, conduit, PVC, RCCB, DB box, angle holder, battery holder, converter.
Return JSON: {"items": [{"productName": string, "quantity": number, "unitPrice": number}], "customerName": string|null, "notes": string|null}
If price not mentioned use 0. Return valid JSON only, no markdown.`,
        },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    let parsedSale = null;
    try {
      const content = parseResponse.choices[0]?.message?.content ?? "{}";
      parsedSale = JSON.parse(content);
    } catch {
      req.log.warn("Failed to parse GPT response as JSON");
    }

    return res.json({ transcript, parsedSale });
  } catch (err) {
    req.log.error({ err }, "Voice transcription failed");
    return res.status(500).json({ error: "Transcription failed" });
  }
});

router.post("/ai/parse-invoice-image", async (req, res) => {
  const body = ParseInvoiceImageBody.parse(req.body);
  const openai = getOpenAI();

  try {
    const mimeType = body.mimeType ?? "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${body.imageBase64}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert at reading Indian electrical goods invoices, estimates, and delivery challans.
These are often handwritten on preprinted forms with columns: QNTY | PARTICULAR | RATE | AMOUNT (or similar).

Key extraction rules:
- VENDOR/SUPPLIER: Look for the company name at top (letterhead), e.g. "MLA", "Havells", "Anchor" etc. This is the seller.
- CUSTOMER: Look for "M/s.", "Party:", "To:" fields — this is who bought the goods.
- For invoices coming INTO the shop (purchases), vendorOrCustomer = the supplier company name from letterhead.
- DATE: Often written as DD/MM/YY or DD/MM/YYYY next to "Date". Convert to YYYY-MM-DD format.
- ITEMS: Each row in the table. Quantity units may be: Pc, Pcs, Pkt, Pkts, Box, Nos, No., Set, Mtr, Roll.
  The "quantity" field should be the numeric amount only (ignore units like Pc/Pkt/Box).
  "name" should include the full item description from PARTICULAR column.
- AMOUNTS: Indian format uses commas (1,200 = 1200). Remove commas. Ignore "+" prefix if present.
  "GRAND TOTAL" or "+ TOTO" (total) is the final amount.
- If an item row has no rate/amount, try to calculate from qty × rate or leave subtotal as 0.
- "rawText": Transcribe ALL visible text from the document for reference.

Return JSON only (no markdown):
{
  "vendorOrCustomer": string|null,
  "customerName": string|null,
  "amount": number|null,
  "invoiceDate": "YYYY-MM-DD"|null,
  "invoiceNumber": string|null,
  "items": [{"name": string, "quantity": number, "unit": string, "unitPrice": number, "subtotal": number}]|null,
  "rawText": string|null
}`,
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            { type: "text", text: "Extract all invoice data from this image. Pay careful attention to the handwritten text in the table rows." },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(content);
    return res.json(data);
  } catch (err) {
    req.log.error({ err }, "Invoice image parsing failed");
    return res.status(500).json({ error: "Image parsing failed" });
  }
});

// Parse a payment receipt (bank deposit slip, GPay/UPI screenshot)
const ParseReceiptBody = z.object({
  imageBase64: z.string(),
  mimeType: z.string().optional(),
});

router.post("/ai/parse-payment-receipt", async (req, res) => {
  const body = ParseReceiptBody.parse(req.body);
  const openai = getOpenAI();

  try {
    const mimeType = body.mimeType ?? "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${body.imageBase64}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert at reading Indian payment receipts and bank documents. Common types:

1. BANK DEPOSIT SLIPS (e.g. Bank of Baroda, SBI, HDFC, ICICI, PNB):
   - Look for: bank name, account holder name, account number, date, total amount deposited, slip/form number.
   - Date format is often DD/MM/YY or DD-MM-YYYY. Convert to YYYY-MM-DD.
   - Amount: ignore commas (49,500 = 49500). "TOTAL" or "(Cash/Cheque) TOTAL" is the final amount.
   - paymentMethod = "bank"

2. GPAY / PHONEPE / PAYTM SCREENSHOTS:
   - Look for: merchant/receiver name, amount (₹ symbol), date/time, UPI transaction ID.
   - paymentMethod = "gpay" or "upi"

3. NEFT / IMPS / RTGS RECEIPTS:
   - Look for: beneficiary name, amount, UTR/reference number, date.
   - paymentMethod = "bank"

4. CASH RECEIPTS:
   - paymentMethod = "cash"

Return JSON only (no markdown):
{
  "amount": number|null,
  "paymentDate": "YYYY-MM-DD"|null,
  "paymentMethod": "cash"|"bank"|"gpay"|"upi"|"cheque",
  "bankName": string|null,
  "accountHolder": string|null,
  "accountNumber": string|null,
  "referenceNumber": string|null,
  "merchantOrVendor": string|null,
  "notes": string|null
}`,
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            { type: "text", text: "Extract all payment details from this receipt/slip." },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(content);
    return res.json(data);
  } catch (err) {
    req.log.error({ err }, "Payment receipt parsing failed");
    return res.status(500).json({ error: "Receipt parsing failed" });
  }
});

export default router;
