import { Router } from "express";
import { TranscribeVoiceBody, ParseInvoiceImageBody } from "@workspace/api-zod";
import OpenAI from "openai";
import { logger } from "../lib/logger";

const router = Router();

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

router.post("/ai/transcribe-voice", async (req, res) => {
  const body = TranscribeVoiceBody.parse(req.body);
  const openai = getOpenAI();

  try {
    // Convert base64 to buffer for Whisper
    const audioBuffer = Buffer.from(body.audioBase64, "base64");
    const mimeType = body.mimeType ?? "audio/ogg";
    const ext = mimeType.split("/")[1]?.split(";")[0] ?? "ogg";

    // Use Whisper via file upload
    const { Readable } = await import("stream");
    const stream = Readable.from(audioBuffer);
    (stream as Record<string, unknown>).name = `audio.${ext}`;

    const transcription = await openai.audio.transcriptions.create({
      file: stream as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
      model: "whisper-1",
    });

    const transcript = transcription.text;

    // Parse transcript into sale items with GPT-4
    const parseResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an assistant for an electrical shop. Extract sale items from voice transcripts.
Return JSON with this structure: {"items": [{"productName": string, "quantity": number, "unitPrice": number}], "notes": string|null}
If you can't parse specific prices, use 0. Always return valid JSON only, no markdown.`,
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
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract invoice data from this image. Return JSON with:
{"vendorOrCustomer": string|null, "amount": number|null, "invoiceDate": "YYYY-MM-DD"|null, "items": [{"name": string, "quantity": number, "unitPrice": number, "subtotal": number}]|null, "rawText": string|null}
Return only valid JSON, no markdown.`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(content);
    return res.json(data);
  } catch (err) {
    req.log.error({ err }, "Invoice image parsing failed");
    return res.status(500).json({ error: "Image parsing failed" });
  }
});

export default router;
