import { useState, useRef } from "react";
import { useListSales, useCreateSale, useDeleteSale, useListProducts, useListCustomers, useCreateCustomer, useTranscribeVoice, useCreateReturn, getListSalesQueryKey, getListProductsQueryKey, getListCustomersQueryKey, getListReturnsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShoppingCart, Mic, MicOff, Loader2, X, PlusCircle, AlertTriangle, Printer, RotateCcw } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "credit", label: "Credit (Due)" },
];

const saleSchema = z.object({
  customerId: z.string().optional(),
  paidAmount: z.coerce.number().min(0),
  paymentMode: z.enum(["cash", "upi", "card", "credit"]).default("cash"),
  notes: z.string().optional(),
});
type SaleForm = z.infer<typeof saleSchema>;

const returnSchema = z.object({
  reason: z.string().optional(),
  refundMode: z.enum(["cash", "upi", "card", "store-credit"]).default("cash"),
});
type ReturnForm = z.infer<typeof returnSchema>;

interface SaleItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  productId: number | null;
}

interface ReturnItem {
  productName: string;
  quantity: number;
  unitPrice: number;
}

type Sale = {
  id: number;
  createdAt: Date;
  customerName?: string | null;
  totalAmount: number;
  creditAmount: number;
  paidAmount: number;
  paymentMode?: string | null;
  source: string;
  items: unknown;
  customerId?: number | null;
};

function printGstInvoice(sale: Sale, products: { id: number; name: string; hsnCode?: string | null; gstRate?: number | null }[]) {
  const items = sale.items as { productName: string; quantity: number; unitPrice: number; productId?: number | null }[];
  const shopName = "ElectraShop";
  const shopGstin = "GSTIN: 29XXXXX0000X1ZX";
  const shopAddress = "123 Market Road, Bengaluru - 560001";

  const rows = items.map((item) => {
    const prod = products.find((p) => p.id === item.productId || p.name === item.productName);
    const gstRate = prod?.gstRate ?? 0;
    const hsn = prod?.hsnCode ?? "";
    const taxable = item.quantity * item.unitPrice;
    const gst = (taxable * gstRate) / 100;
    const cgst = gst / 2;
    const sgst = gst / 2;
    return { ...item, hsn, gstRate, taxable, cgst, sgst, total: taxable + gst };
  });

  const subtotal = rows.reduce((s, r) => s + r.taxable, 0);
  const totalTax = rows.reduce((s, r) => s + r.cgst + r.sgst, 0);
  const grandTotal = subtotal + totalTax;

  const html = `<!DOCTYPE html><html><head><title>Tax Invoice #${sale.id}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 20px; max-width: 700px; margin: auto; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 2px; }
  .sub { text-align: center; color: #555; margin-bottom: 10px; }
  .header { display: flex; justify-content: space-between; border: 1px solid #ccc; padding: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f4f4f4; font-weight: 600; }
  td.right, th.right { text-align: right; }
  .totals { text-align: right; }
  .totals td { border: none; padding: 3px 8px; }
  .grand { font-size: 14px; font-weight: bold; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>TAX INVOICE</h1>
<div class="sub">${shopName} · ${shopAddress}</div>
<div class="sub">${shopGstin}</div>
<div class="header">
  <div><strong>Invoice #:</strong> INV-${String(sale.id).padStart(4, "0")}<br/><strong>Date:</strong> ${format(new Date(sale.createdAt), "dd/MM/yyyy")}</div>
  <div><strong>Customer:</strong> ${sale.customerName ?? "Walk-in"}</div>
</div>
<table>
  <thead><tr>
    <th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th class="right">Rate (₹)</th>
    <th class="right">Taxable (₹)</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">Total (₹)</th>
  </tr></thead>
  <tbody>
    ${rows.map((r, idx) => `<tr>
      <td>${idx + 1}</td><td>${r.productName}</td><td>${r.hsn}</td><td>${r.quantity}</td>
      <td class="right">${r.unitPrice.toFixed(2)}</td>
      <td class="right">${r.taxable.toFixed(2)}</td>
      <td class="right">${r.gstRate / 2}% — ₹${r.cgst.toFixed(2)}</td>
      <td class="right">${r.gstRate / 2}% — ₹${r.sgst.toFixed(2)}</td>
      <td class="right">${r.total.toFixed(2)}</td>
    </tr>`).join("")}
  </tbody>
</table>
<table class="totals" style="width:300px;margin-left:auto;">
  <tr><td>Subtotal (Taxable)</td><td class="right">₹${subtotal.toFixed(2)}</td></tr>
  <tr><td>Total GST</td><td class="right">₹${totalTax.toFixed(2)}</td></tr>
  <tr class="grand"><td><strong>Grand Total</strong></td><td class="right"><strong>₹${grandTotal.toFixed(2)}</strong></td></tr>
  <tr><td>Amount Paid</td><td class="right">₹${sale.paidAmount.toFixed(2)}</td></tr>
  ${sale.creditAmount > 0 ? `<tr><td style="color:#d97706">Balance Due</td><td class="right" style="color:#d97706">₹${sale.creditAmount.toFixed(2)}</td></tr>` : ""}
</table>
<p style="text-align:center;color:#888;margin-top:20px;font-size:11px;">Thank you for your business! This is a computer-generated invoice.</p>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); w.onload = () => w.print(); }
}

export default function Sales() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [items, setItems] = useState<SaleItem[]>([{ productName: "", quantity: 1, unitPrice: 0, productId: null }]);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dupWarning, setDupWarning] = useState<{ existingSale: { id: number; createdAt: string; totalAmount: number } } | null>(null);
  const pendingSubmitRef = useRef<(() => Promise<void>) | null>(null);

  const { data: sales, isLoading } = useListSales({}, { query: { queryKey: getListSalesQueryKey({}) } });
  const { data: products } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  const createSale = useCreateSale();
  const createCustomer = useCreateCustomer();
  const deleteSale = useDeleteSale();
  const transcribeVoice = useTranscribeVoice();
  const createReturn = useCreateReturn();
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const form = useForm<SaleForm>({
    resolver: zodResolver(saleSchema),
    defaultValues: { customerId: "walk-in", paidAmount: 0, paymentMode: "cash", notes: "" },
  });

  const returnForm = useForm<ReturnForm>({
    resolver: zodResolver(returnSchema),
    defaultValues: { reason: "", refundMode: "cash" },
  });

  const totalAmount = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const paidAmount = form.watch("paidAmount") ?? 0;
  const creditAmount = Math.max(0, totalAmount - paidAmount);

  function openNew() {
    setItems([{ productName: "", quantity: 1, unitPrice: 0, productId: null }]);
    setTranscript("");
    setNewCustomerName("");
    setNewCustomerPhone("");
    form.reset({ customerId: "walk-in", paidAmount: 0, paymentMode: "cash", notes: "" });
    setDialogOpen(true);
  }

  function openReturn(sale: Sale) {
    const saleItems = sale.items as { productName: string; quantity: number; unitPrice: number }[];
    setReturnSale(sale);
    setReturnItems(saleItems.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })));
    returnForm.reset({ reason: "", refundMode: "cash" });
    setReturnDialogOpen(true);
  }

  function addItem() { setItems([...items, { productName: "", quantity: 1, unitPrice: 0, productId: null }]); }
  function removeItem(i: number) { setItems(items.filter((_, idx) => idx !== i)); }

  function updateItemName(i: number, name: string) {
    const matched = products?.find((p) => p.name.toLowerCase() === name.toLowerCase());
    setItems(items.map((item, idx) => idx === i ? {
      ...item,
      productName: name,
      productId: matched?.id ?? null,
      unitPrice: matched ? matched.sellingPrice : item.unitPrice,
    } : item));
  }

  function updateItemField(i: number, field: "quantity" | "unitPrice", value: number) {
    setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  async function startRecording() {
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
          setItems(result.parsedSale.items.map((i: { productName: string; quantity: number; unitPrice: number }) => {
            const matched = products?.find((p) => p.name.toLowerCase() === i.productName.toLowerCase());
            return { productName: i.productName, quantity: i.quantity, unitPrice: matched ? matched.sellingPrice : i.unitPrice, productId: matched?.id ?? null };
          }));
          toast({ title: "Voice processed", description: `Found ${result.parsedSale.items.length} item(s)` });
        }
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach((t) => t.stop());
    };
    mr.start();
    mediaRef.current = mr;
    setRecording(true);
  }

  function stopRecording() {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setRecording(false);
  }

  async function doCreateSale(data: SaleForm, resolvedCustomerId: number | null, validItems: SaleItem[]) {
    await createSale.mutateAsync({
      data: {
        customerId: resolvedCustomerId,
        items: validItems.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, productId: i.productId })),
        paidAmount: data.paidAmount,
        paymentMode: data.paymentMode,
        notes: data.notes || null,
        source: "web",
      }
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) });
        qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        toast({ title: "Sale recorded" });
        setDialogOpen(false);
        setDupWarning(null);
      },
    });
  }

  async function onSubmit(data: SaleForm) {
    const validItems = items.filter((i) => i.productName.trim());
    if (!validItems.length) { toast({ title: "Add at least one item", variant: "destructive" }); return; }

    let resolvedCustomerId: number | null = data.customerId && data.customerId !== "walk-in" ? parseInt(data.customerId) : null;
    if (data.customerId === "new") {
      if (!newCustomerName.trim()) { toast({ title: "Enter a customer name", variant: "destructive" }); return; }
      const created = await createCustomer.mutateAsync({
        data: { name: newCustomerName.trim(), phone: newCustomerPhone.trim() || null }
      });
      resolvedCustomerId = created.id;
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey({}) });
    }

    const total = validItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const params = new URLSearchParams({ totalAmount: String(total) });
    if (resolvedCustomerId) params.set("customerId", String(resolvedCustomerId));
    try {
      const check = await fetch(`/api/sales/check-duplicate?${params}`).then((r) => r.json()) as { duplicate: boolean; existingSale?: { id: number; createdAt: string; totalAmount: number } };
      if (check.duplicate && check.existingSale) {
        pendingSubmitRef.current = () => doCreateSale(data, resolvedCustomerId, validItems);
        setDupWarning({ existingSale: check.existingSale });
        return;
      }
    } catch { /* ignore network errors in duplicate check */ }

    await doCreateSale(data, resolvedCustomerId, validItems);
  }

  async function onReturn(data: ReturnForm) {
    if (!returnSale) return;
    const validItems = returnItems.filter((i) => i.quantity > 0);
    if (!validItems.length) { toast({ title: "Set quantity for at least one item", variant: "destructive" }); return; }
    const totalRefund = validItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

    await createReturn.mutateAsync({
      data: {
        saleId: returnSale.id,
        customerId: returnSale.customerId ?? null,
        reason: data.reason || null,
        refundMode: data.refundMode,
        items: validItems,
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) });
        qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        qc.invalidateQueries({ queryKey: getListReturnsQueryKey() });
        toast({ title: "Return recorded", description: `₹${totalRefund.toFixed(2)} refunded via ${data.refundMode}` });
        setReturnDialogOpen(false);
      },
    });
  }

  async function handleDelete(id: number) {
    await deleteSale.mutateAsync({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) }); toast({ title: "Sale deleted" }); },
    });
  }

  const lowStockItems = (products ?? []).filter((p) => p.stockQuantity <= p.lowStockThreshold);
  const productList = products ?? [];

  const paymentModeColor: Record<string, string> = {
    cash: "bg-emerald-500/15 text-emerald-400",
    upi: "bg-blue-500/15 text-blue-400",
    card: "bg-purple-500/15 text-purple-400",
    credit: "bg-amber-500/15 text-amber-400",
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Sales</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{sales?.length ?? 0} transactions</p>
        </div>
        <Button onClick={openNew} data-testid="button-new-sale">
          <Plus className="w-4 h-4 mr-1.5" /> New Sale
        </Button>
      </div>

      {lowStockItems.length > 0 && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-red-400">Low stock: </span>
            <span className="text-muted-foreground">
              {lowStockItems.map((p) => `${p.name} (${p.stockQuantity} ${p.unit} left)`).join(" · ")}
            </span>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-card border border-card-border rounded-xl animate-pulse" />)}</div>
      ) : !sales?.length ? (
        <div className="text-center py-16 bg-card border border-card-border rounded-xl">
          <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No sales yet. Record your first sale.</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Total</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Credit</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Mode</th>
                <th className="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {(sales ?? []).slice().reverse().map((s) => {
                const sale = s as unknown as Sale;
                return (
                  <tr key={s.id} className="hover:bg-accent/30 transition-colors" data-testid={`row-sale-${s.id}`}>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{format(new Date(s.createdAt), "MMM d, h:mm a")}</td>
                    <td className="px-4 py-3 text-foreground">{s.customerName ?? "Walk-in"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">
                      {(s.items as { productName: string; quantity: number }[]).map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">₹{s.totalAmount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      {s.creditAmount > 0
                        ? <span className="text-amber-400 font-medium">₹{s.creditAmount.toFixed(2)}</span>
                        : <span className="text-emerald-400 text-xs">Paid</span>}
                    </td>
                    <td className="px-4 py-3">
                      {sale.paymentMode && (
                        <span className={cn("text-xs px-2 py-0.5 rounded-full", paymentModeColor[sale.paymentMode] ?? "bg-muted text-muted-foreground")}>
                          {sale.paymentMode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-blue-400" title="Print GST invoice"
                          onClick={() => printGstInvoice(sale, productList.map((p) => ({ id: p.id, name: p.name, hsnCode: (p as { hsnCode?: string | null }).hsnCode, gstRate: (p as { gstRate?: number | null }).gstRate })))}>
                          <Printer className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-amber-400" title="Record return"
                          onClick={() => openReturn({ ...sale, createdAt: new Date(s.createdAt), paidAmount: s.totalAmount - s.creditAmount })}>
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(s.id)} data-testid={`button-delete-sale-${s.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Sale Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Sale</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-xl border border-card-border">
            <Button
              type="button"
              variant={recording ? "destructive" : "secondary"}
              size="sm"
              onClick={recording ? stopRecording : startRecording}
              disabled={transcribeVoice.isPending}
              data-testid="button-voice-record"
            >
              {transcribeVoice.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : recording ? <MicOff className="w-4 h-4 mr-1.5" /> : <Mic className="w-4 h-4 mr-1.5" />}
              {transcribeVoice.isPending ? "Processing..." : recording ? "Stop Recording" : "Voice Entry"}
            </Button>
            {transcript && <p className="text-xs text-muted-foreground italic flex-1 truncate">"{transcript}"</p>}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Items</label>
                <div className="space-y-2">
                  {items.map((item, i) => {
                    const matched = products?.find((p) => p.id === item.productId);
                    const isLow = matched && matched.stockQuantity <= matched.lowStockThreshold;
                    return (
                      <div key={i} className="space-y-1" data-testid={`sale-item-${i}`}>
                        <div className="grid grid-cols-[1fr_80px_90px_32px] gap-2 items-center">
                          <Input placeholder="Product name" value={item.productName} onChange={(e) => updateItemName(i, e.target.value)} list="product-suggestions" data-testid={`input-item-name-${i}`} />
                          <Input type="number" min={0.01} step="0.01" placeholder="Qty" value={item.quantity} onChange={(e) => updateItemField(i, "quantity", parseFloat(e.target.value) || 0)} data-testid={`input-item-qty-${i}`} />
                          <Input type="number" min={0} step="0.01" placeholder="Price" value={item.unitPrice} onChange={(e) => updateItemField(i, "unitPrice", parseFloat(e.target.value) || 0)} data-testid={`input-item-price-${i}`} />
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => removeItem(i)}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        {matched && (
                          <div className="flex items-center gap-2 px-1">
                            <span className={cn("text-xs", isLow ? "text-red-400" : "text-emerald-400")}>
                              {isLow && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                              Stock: {matched.stockQuantity} {matched.unit}
                              {item.quantity > 0 && ` → ${Math.max(0, matched.stockQuantity - item.quantity)} after sale`}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <datalist id="product-suggestions">
                  {products?.map((p) => <option key={p.id} value={p.name} />)}
                </datalist>
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={addItem} data-testid="button-add-item">
                  <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> Add Item
                </Button>
              </div>

              <div className="bg-muted/50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span><span>₹{totalAmount.toFixed(2)}</span>
                </div>
                <FormField control={form.control} name="paidAmount" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-4">
                      <FormLabel className="text-muted-foreground">Amount Paid</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" className="w-40 text-right" {...field} data-testid="input-paid-amount" />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className={cn("flex justify-between font-semibold", creditAmount > 0 ? "text-amber-400" : "text-emerald-400")}>
                  <span>Credit Balance</span><span>₹{creditAmount.toFixed(2)}</span>
                </div>
              </div>

              <FormField control={form.control} name="paymentMode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Mode</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-payment-mode">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAYMENT_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              <FormField control={form.control} name="customerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer (optional)</FormLabel>
                  <Select value={field.value} onValueChange={(v) => { field.onChange(v); if (v !== "new") { setNewCustomerName(""); setNewCustomerPhone(""); } }}>
                    <FormControl>
                      <SelectTrigger data-testid="select-customer">
                        <SelectValue placeholder="Walk-in customer" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in customer</SelectItem>
                      <SelectItem value="new">＋ New customer…</SelectItem>
                      {customers?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {field.value === "new" && (
                    <div className="mt-2 space-y-2 p-3 bg-muted/50 rounded-lg border border-card-border">
                      <Input placeholder="Customer name *" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} autoFocus data-testid="input-new-customer-name" />
                      <Input placeholder="Phone number (optional)" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} data-testid="input-new-customer-phone" />
                    </div>
                  )}
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl><Input placeholder="Any notes..." {...field} data-testid="input-sale-notes" /></FormControl>
                </FormItem>
              )} />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createSale.isPending} data-testid="button-submit-sale">
                  {createSale.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Record Sale
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Return Dialog */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Return — Sale #{returnSale?.id}</DialogTitle>
          </DialogHeader>
          <Form {...returnForm}>
            <form onSubmit={returnForm.handleSubmit(onReturn)} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Items to return (set qty to 0 to skip)</label>
                <div className="space-y-2">
                  {returnItems.map((item, i) => (
                    <div key={i} className="grid grid-cols-[1fr_100px] gap-3 items-center">
                      <div className="text-sm text-foreground">{item.productName} <span className="text-muted-foreground">@ ₹{item.unitPrice}</span></div>
                      <Input
                        type="number" min={0} step="0.01"
                        value={item.quantity}
                        onChange={(e) => setReturnItems(returnItems.map((ri, idx) => idx === i ? { ...ri, quantity: parseFloat(e.target.value) || 0 } : ri))}
                        data-testid={`input-return-qty-${i}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-sm font-semibold text-foreground text-right">
                  Refund: ₹{returnItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0).toFixed(2)}
                </div>
              </div>

              <FormField control={returnForm.control} name="refundMode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Refund Mode</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-refund-mode">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="store-credit">Store Credit</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              <FormField control={returnForm.control} name="reason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl><Input placeholder="Defective, wrong item, etc." {...field} data-testid="input-return-reason" /></FormControl>
                </FormItem>
              )} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setReturnDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createReturn.isPending} data-testid="button-submit-return">
                  {createReturn.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Record Return
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
