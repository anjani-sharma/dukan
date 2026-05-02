import { useState, useRef } from "react";
import {
  useTranscribeVoice,
  useCreateSale,
  useRecordPayment,
  useParseInvoiceImage,
  useListCustomers,
  getListCustomersQueryKey,
  getListSalesQueryKey,
  getListInvoicesQueryKey,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, CreditCard, Upload, Plus, X, Loader2, CheckCircle, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

type Mode = "voice" | "payment" | "invoice";

interface ParsedItem {
  productName: string;
  quantity: number;
  unitPrice: number;
}

export function QuickEntry() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("voice");

  // Voice state
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [voiceDone, setVoiceDone] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Payment state
  const [payCustomerId, setPayCustomerId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");

  // Invoice state
  const [invoicePreview, setInvoicePreview] = useState<string | null>(null);
  const [invoiceData, setInvoiceData] = useState<{
    vendorOrCustomer?: string;
    amount?: number;
    invoiceDate?: string;
    items?: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
  } | null>(null);
  const [stockResult, setStockResult] = useState<{ matched: number; total: number } | null>(null);
  const [editableItems, setEditableItems] = useState<{ name: string; quantity: number }[]>([]);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  const transcribeVoice = useTranscribeVoice();
  const createSale = useCreateSale();
  const recordPayment = useRecordPayment();
  const parseImage = useParseInvoiceImage();

  function resetAll() {
    setTranscript("");
    setParsedItems([]);
    setVoiceDone(false);
    setPayCustomerId("");
    setPayAmount("");
    setPayNotes("");
    setInvoicePreview(null);
    setInvoiceData(null);
    setStockResult(null);
    setEditableItems([]);
    setSavingInvoice(false);
  }

  function close() {
    setOpen(false);
    resetAll();
  }

  // ── VOICE ──────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = (reader.result as string).split(",")[1];
          const result = await transcribeVoice.mutateAsync({ data: { audioBase64: b64, mimeType: "audio/webm" } });
          setTranscript(result.transcript);
          if (result.parsedSale?.items?.length) {
            setParsedItems(result.parsedSale.items);
          }
          setVoiceDone(true);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setRecording(false);
  }

  async function confirmVoiceSale() {
    if (!parsedItems.length) return;
    const total = parsedItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    await createSale.mutateAsync({
      data: {
        customerId: null,
        items: parsedItems.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, productId: null })),
        paidAmount: total,
        notes: `Voice: ${transcript}`,
        source: "web",
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) });
        toast({ title: "Sale recorded", description: `₹${total.toFixed(2)} logged` });
        close();
      },
    });
  }

  // ── PAYMENT ─────────────────────────────────────────────
  async function submitPayment() {
    if (!payCustomerId || !payAmount) return;
    await recordPayment.mutateAsync({
      customerId: parseInt(payCustomerId),
      data: { amount: parseFloat(payAmount), notes: payNotes || null },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCustomersQueryKey({}) });
        toast({ title: "Payment recorded", description: `₹${parseFloat(payAmount).toFixed(2)}` });
        close();
      },
    });
  }

  // ── INVOICE ─────────────────────────────────────────────
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setInvoicePreview(dataUrl);
      // Always set invoiceData so the Save button appears even if AI fails
      setInvoiceData({});
      try {
        const b64 = dataUrl.split(",")[1];
        const result = await parseImage.mutateAsync({ data: { imageBase64: b64, mimeType: file.type || "image/jpeg" } });
        const items = (result.items ?? []).map((it: { name: string; quantity: number; unitPrice: number; subtotal: number }) => ({
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal ?? it.quantity * it.unitPrice,
        }));
        setInvoiceData({
          vendorOrCustomer: result.vendorOrCustomer ?? undefined,
          amount: result.amount ?? undefined,
          invoiceDate: result.invoiceDate ?? undefined,
          items: items.length > 0 ? items : undefined,
        });
        if (items.length > 0) {
          setEditableItems(items.map((it) => ({ name: it.name, quantity: it.quantity })));
        }
        const desc = items.length > 0
          ? `${items.length} item${items.length > 1 ? "s" : ""} extracted — stock will update on save`
          : (result.vendorOrCustomer ?? "Details extracted");
        toast({ title: "Invoice scanned", description: desc });
      } catch {
        toast({ title: "AI scan failed", description: "You can still save the invoice manually", variant: "destructive" });
      }
    };
    reader.readAsDataURL(file);
  }

  async function confirmInvoice() {
    if (savingInvoice) return;
    setSavingInvoice(true);
    try {
      // Extract base64 + mimeType from the scanned image so the server can upload to R2
      let imageBase64: string | undefined;
      let mimeType: string | undefined;
      if (invoicePreview) {
        const match = invoicePreview.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) { mimeType = match[1]; imageBase64 = match[2]; }
      }

      // Use fetch directly so we can include lineItems + imageBase64 (not in generated schema)
      const res = await fetch(`${API_BASE}/api/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "purchase",
          vendorOrCustomer: invoiceData?.vendorOrCustomer ?? null,
          amount: invoiceData?.amount ?? null,
          invoiceDate: invoiceData?.invoiceDate ?? null,
          notes: "Uploaded via Quick Entry",
          lineItems: editableItems.length > 0 ? editableItems : null,
          ...(imageBase64 ? { imageBase64, mimeType: mimeType ?? "image/jpeg" } : {}),
        }),
      });

      if (!res.ok) {
        let detail = "";
        try { const err = await res.json() as { error?: string }; detail = err.error ?? ""; } catch { /* ignore */ }
        toast({ title: "Failed to save invoice", description: detail || `Server error (${res.status})`, variant: "destructive" });
        return;
      }

      const invoice = await res.json() as { id: number };
      qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) });

      // Auto-apply stock if items were confirmed
      if (editableItems.length > 0) {
        try {
          const stockRes = await fetch(`${API_BASE}/api/invoices/${invoice.id}/apply-stock`, { method: "POST" });
          if (stockRes.ok) {
            const stockData = await stockRes.json() as { results: { matched: boolean; name: string }[] };
            const matched = stockData.results.filter((r) => r.matched).length;
            const total = stockData.results.length;
            setStockResult({ matched, total });
            qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
            if (matched > 0) {
              toast({
                title: "Invoice saved — stock updated",
                description: `${matched} of ${total} item${total !== 1 ? "s" : ""} matched & stock increased`,
              });
            } else {
              const unmatched = stockData.results.map((r) => r.name).join(", ");
              toast({
                title: "Invoice saved — no stock updated",
                description: `No products matched: ${unmatched}. Edit names in the list to match your catalog.`,
                variant: "destructive",
              });
            }
            setTimeout(close, 1800);
            return;
          }
        } catch {
          // fall through to plain save toast
        }
      }

      toast({ title: "Invoice saved" });
      close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Failed to save invoice", description: msg, variant: "destructive" });
    } finally {
      setSavingInvoice(false);
    }
  }

  const modeLabel: Record<Mode, string> = { voice: "Voice Sale", payment: "Record Payment", invoice: "Scan Invoice" };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => { setOpen(true); resetAll(); }}
        className="fixed bottom-[4.5rem] right-4 md:bottom-6 md:right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        data-testid="button-quick-entry"
        aria-label="Quick entry"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={close} />

          <div className="relative w-full sm:max-w-md bg-card border border-card-border rounded-t-2xl sm:rounded-2xl shadow-2xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
              <h2 className="font-semibold text-foreground">Quick Entry</h2>
              <Button variant="ghost" size="icon" onClick={close}><X className="w-4 h-4" /></Button>
            </div>

            {/* Mode tabs */}
            <div className="flex border-b border-card-border">
              {(["voice", "payment", "invoice"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); resetAll(); }}
                  className={cn(
                    "flex-1 py-2.5 text-xs font-medium transition-colors",
                    mode === m
                      ? "text-primary border-b-2 border-primary bg-primary/5"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`tab-quick-${m}`}
                >
                  {modeLabel[m]}
                </button>
              ))}
            </div>

            <div className="p-5">
              {/* ── VOICE MODE ── */}
              {mode === "voice" && (
                <div className="space-y-4">
                  {!voiceDone ? (
                    <div className="flex flex-col items-center gap-4 py-4">
                      <button
                        onClick={recording ? stopRecording : startRecording}
                        disabled={transcribeVoice.isPending}
                        className={cn(
                          "w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg",
                          recording
                            ? "bg-red-500 text-white scale-110 animate-pulse"
                            : "bg-primary text-primary-foreground hover:scale-105"
                        )}
                        data-testid="button-quick-mic"
                      >
                        {transcribeVoice.isPending
                          ? <Loader2 className="w-8 h-8 animate-spin" />
                          : recording
                          ? <MicOff className="w-8 h-8" />
                          : <Mic className="w-8 h-8" />}
                      </button>
                      <p className="text-sm text-muted-foreground text-center">
                        {transcribeVoice.isPending
                          ? "Processing your voice..."
                          : recording
                          ? "Recording... tap to stop"
                          : "Tap to record a sale"}
                      </p>
                      <p className="text-xs text-muted-foreground text-center px-4">
                        Say something like: "Sold 5 MCB breakers to Ravi, 45 rupees each, he paid 150"
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-muted/50 rounded-xl p-4">
                        <p className="text-xs text-muted-foreground mb-1">You said</p>
                        <p className="text-sm text-foreground italic">"{transcript}"</p>
                      </div>

                      {parsedItems.length > 0 ? (
                        <>
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Detected Items</p>
                            {parsedItems.map((item, i) => (
                              <div key={i} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5" data-testid={`quick-item-${i}`}>
                                <div>
                                  <div className="text-sm font-medium text-foreground">{item.productName}</div>
                                  <div className="text-xs text-muted-foreground">×{item.quantity} @ ₹{item.unitPrice}</div>
                                </div>
                                <div className="text-sm font-semibold text-primary">
                                  ₹{(item.quantity * item.unitPrice).toFixed(2)}
                                </div>
                              </div>
                            ))}
                            <div className="flex justify-between items-center px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                              <span className="text-sm font-semibold text-foreground">Total</span>
                              <span className="text-sm font-bold text-primary">
                                ₹{parsedItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0).toFixed(2)}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setVoiceDone(false); setTranscript(""); setParsedItems([]); }}>
                              Re-record
                            </Button>
                            <Button size="sm" className="flex-1" onClick={confirmVoiceSale} disabled={createSale.isPending} data-testid="button-confirm-voice-sale">
                              {createSale.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
                              Confirm Sale
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-4">
                          <p className="text-sm text-muted-foreground">Couldn't detect sale items. Try again with product name, quantity, and price.</p>
                          <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setVoiceDone(false); setTranscript(""); }}>
                            Try Again
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── PAYMENT MODE ── */}
              {mode === "payment" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Customer</label>
                    <Select value={payCustomerId} onValueChange={setPayCustomerId}>
                      <SelectTrigger data-testid="quick-select-customer">
                        <SelectValue placeholder="Select customer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(customers ?? [])
                          .filter((c) => c.outstandingBalance > 0)
                          .map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              <span className="flex items-center justify-between w-full gap-4">
                                {c.name}
                                <span className="text-amber-400 text-xs">₹{c.outstandingBalance.toFixed(0)} owed</span>
                              </span>
                            </SelectItem>
                          ))}
                        {(customers ?? [])
                          .filter((c) => c.outstandingBalance === 0)
                          .map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {payCustomerId && (
                    <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
                      <div className="text-xs text-amber-400/70">Outstanding balance</div>
                      <div className="text-lg font-bold text-amber-400">
                        ₹{(customers?.find((c) => String(c.id) === payCustomerId)?.outstandingBalance ?? 0).toFixed(2)}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Amount Received (₹)</label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="text-lg font-semibold"
                      data-testid="quick-input-pay-amount"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Notes (optional)</label>
                    <Input
                      placeholder="e.g. Cash received"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      data-testid="quick-input-pay-notes"
                    />
                  </div>

                  <Button
                    className="w-full"
                    disabled={!payCustomerId || !payAmount || recordPayment.isPending}
                    onClick={submitPayment}
                    data-testid="button-quick-confirm-payment"
                  >
                    {recordPayment.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                    Record Payment
                  </Button>
                </div>
              )}

              {/* ── INVOICE MODE ── */}
              {mode === "invoice" && (
                <div className="space-y-4">
                  <div
                    className="border-2 border-dashed border-card-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => fileRef.current?.click()}
                    data-testid="quick-invoice-upload"
                  >
                    {parseImage.isPending ? (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <p className="text-sm text-muted-foreground">Scanning with AI...</p>
                      </div>
                    ) : invoicePreview ? (
                      invoicePreview.startsWith("data:application/pdf") ? (
                        <div className="flex flex-col items-center gap-2 py-2">
                          <FileText className="w-10 h-10 text-primary" />
                          <p className="text-sm text-muted-foreground">PDF uploaded — AI scanning…</p>
                        </div>
                      ) : (
                        <img src={invoicePreview} alt="Invoice" className="max-h-36 mx-auto rounded object-contain" />
                      )
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <Upload className="w-8 h-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Tap to upload invoice or document</p>
                        <p className="text-xs text-muted-foreground">Photo or PDF — AI will extract vendor, amount & date</p>
                      </div>
                    )}
                    <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleImageUpload} data-testid="quick-input-invoice-image" />
                  </div>

                  {invoiceData && (
                    <div className="bg-muted/50 rounded-xl p-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Extracted Details</p>
                      {invoiceData.vendorOrCustomer && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Vendor</span>
                          <span className="text-foreground font-medium">{invoiceData.vendorOrCustomer}</span>
                        </div>
                      )}
                      {invoiceData.amount && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Amount</span>
                          <span className="text-foreground font-medium">₹{invoiceData.amount.toFixed(2)}</span>
                        </div>
                      )}
                      {invoiceData.invoiceDate && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Date</span>
                          <span className="text-foreground font-medium">{invoiceData.invoiceDate}</span>
                        </div>
                      )}

                      <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Items to stock-in
                          </p>
                          <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                            onClick={() => setEditableItems((prev) => [...prev, { name: "", quantity: 1 }])}
                          >
                            <Plus className="w-3 h-3" /> Add row
                          </button>
                        </div>

                        {editableItems.length === 0 && (
                          <p className="text-xs text-muted-foreground italic">No items extracted — add them manually or save without stock update.</p>
                        )}

                        {editableItems.map((item, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <Input
                              value={item.name}
                              onChange={(e) => setEditableItems((prev) => prev.map((it, idx) => idx === i ? { ...it, name: e.target.value } : it))}
                              placeholder="Item name"
                              className="h-8 text-xs flex-1 min-w-0"
                            />
                            <Input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => setEditableItems((prev) => prev.map((it, idx) => idx === i ? { ...it, quantity: Number(e.target.value) || 1 } : it))}
                              className="h-8 text-xs w-16 shrink-0 text-center"
                            />
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => setEditableItems((prev) => prev.filter((_, idx) => idx !== i))}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}

                        {editableItems.length > 0 && (
                          <p className="text-xs text-muted-foreground">Review & correct the list, then tap Save to update stock.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {invoiceData && (
                    <Button
                      className="w-full"
                      onClick={confirmInvoice}
                      disabled={savingInvoice}
                      data-testid="button-quick-confirm-invoice"
                    >
                      {savingInvoice ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ChevronRight className="w-4 h-4 mr-2" />}
                      {savingInvoice ? "Saving…" : editableItems.length > 0 ? "Save & Update Stock" : "Save Invoice"}
                    </Button>
                  )}

                  {!invoiceData && !parseImage.isPending && (
                    <p className="text-xs text-muted-foreground text-center">
                      Upload a photo, PDF, or use your camera to capture a paper invoice
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
