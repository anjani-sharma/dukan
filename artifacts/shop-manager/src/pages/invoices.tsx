import { useState, useRef } from "react";
import { useListInvoices, useCreateInvoice, useDeleteInvoice, useParseInvoiceImage, getListInvoicesQueryKey } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FileText, Upload, Loader2, CheckCircle, Image, X, Package, AlertTriangle, Edit2, RotateCcw } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type LineItem = { name: string; quantity: number; unitPrice: number; subtotal: number };

interface InvoiceRow {
  id: number; type: string; vendorOrCustomer?: string | null; amount?: number | null;
  invoiceDate?: string | null; imageUrl?: string | null; paymentProofUrl?: string | null;
  paid?: boolean; lineItems?: LineItem[] | null; stockUpdated?: boolean;
  notes?: string | null; createdAt: string;
}

const invoiceSchema = z.object({
  type: z.enum(["purchase", "sale"]),
  vendorOrCustomer: z.string().optional(),
  amount: z.coerce.number().optional(),
  invoiceDate: z.string().optional(),
  notes: z.string().optional(),
});
type InvoiceForm = z.infer<typeof invoiceSchema>;

// ── Payment Proof Panel ────────────────────────────────────────────────────
function PaymentProofDialog({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [preview, setPreview] = useState<string | null>(invoice.paymentProofUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const patchInvoice = useMutation({
    mutationFn: async (data: { paid?: boolean; paymentProofUrl?: string | null }) => {
      const r = await fetch(`${BASE}/api/invoices/${invoice.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) }),
  });

  async function handleProofUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      await patchInvoice.mutateAsync({ paymentProofUrl: dataUrl });
      setUploading(false);
      toast({ title: "Payment proof uploaded" });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-card-border rounded-2xl shadow-2xl z-10 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Payment Proof — {invoice.vendorOrCustomer ?? "Invoice"}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="border-2 border-dashed border-card-border rounded-xl p-5 text-center cursor-pointer hover:border-primary/50 transition-colors" onClick={() => fileRef.current?.click()}>
          {uploading ? (
            <div className="flex flex-col items-center gap-2 py-4"><Loader2 className="w-8 h-8 text-primary animate-spin" /><p className="text-sm text-muted-foreground">Uploading...</p></div>
          ) : preview ? (
            <img src={preview} alt="Payment proof" className="max-h-48 mx-auto rounded object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-4"><Image className="w-8 h-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Upload bank slip or GPay receipt</p></div>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProofUpload} />
        </div>
        {invoice.amount && (
          <div className="bg-muted/50 rounded-xl px-4 py-3 flex justify-between text-sm">
            <span className="text-muted-foreground">Invoice Amount</span>
            <span className="font-semibold text-foreground">₹{invoice.amount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Close</Button>
          {!invoice.paid && (
            <Button className="flex-1" onClick={async () => { await patchInvoice.mutateAsync({ paid: true }); toast({ title: "Invoice marked as paid" }); onClose(); }} disabled={patchInvoice.isPending}>
              <CheckCircle className="w-4 h-4 mr-1.5" /> Mark as Paid
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Line Items Review Dialog ────────────────────────────────────────────────
function LineItemsReviewDialog({
  vendorOrCustomer, invoiceDate, amount, lineItems: initial, imagePreview,
  onConfirm, onCancel,
}: {
  vendorOrCustomer: string; invoiceDate: string; amount: number;
  lineItems: LineItem[]; imagePreview: string | null;
  onConfirm: (data: { vendorOrCustomer: string; invoiceDate: string; amount: number; lineItems: LineItem[]; applyStock: boolean; type: "purchase" | "sale" }) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<LineItem[]>(initial.length > 0 ? initial : [{ name: "", quantity: 1, unitPrice: 0, subtotal: 0 }]);
  const [vendor, setVendor] = useState(vendorOrCustomer);
  const [date, setDate] = useState(invoiceDate);
  const [total, setTotal] = useState(amount);
  const [applyStock, setApplyStock] = useState(true);
  const [type, setType] = useState<"purchase" | "sale">("purchase");

  function updateItem(idx: number, field: keyof LineItem, val: string | number) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === "quantity" || field === "unitPrice") {
        next[idx].subtotal = Number(next[idx].quantity) * Number(next[idx].unitPrice);
      }
      return next;
    });
  }

  function addRow() { setItems((prev) => [...prev, { name: "", quantity: 1, unitPrice: 0, subtotal: 0 }]); }
  function removeRow(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }
  const calcTotal = items.reduce((s, it) => s + (it.subtotal || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative bg-card border border-card-border rounded-2xl shadow-2xl z-10 w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border flex-shrink-0">
          <h3 className="font-semibold text-foreground text-base">Review Invoice Items</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="overflow-auto flex-1 p-6 space-y-4">
          {imagePreview && <img src={imagePreview} alt="Invoice" className="w-full max-h-32 object-contain rounded-lg border border-card-border" />}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Vendor</label>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor name" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Invoice Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as "purchase" | "sale")} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="purchase">Purchase</option>
                <option value="sale">Sale</option>
              </select>
            </div>
          </div>

          {/* Line items table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Line Items</span>
              <Button size="sm" variant="ghost" onClick={addRow} className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" />Add Row</Button>
            </div>
            <div className="border border-card-border rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-card-border">
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Product / Item</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium w-20">Qty</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium w-24">Unit Price</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium w-24">Subtotal</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1.5">
                        <Input value={item.name} onChange={(e) => updateItem(idx, "name", e.target.value)} className="h-7 text-xs" placeholder="Item name" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)} className="h-7 text-xs text-right" min={0} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} className="h-7 text-xs text-right" min={0} step="0.01" />
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium text-foreground">₹{item.subtotal.toFixed(2)}</td>
                      <td className="px-1 py-1.5">
                        <button onClick={() => removeRow(idx)} className="text-destructive hover:text-destructive/70 p-1"><X className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-card-border bg-muted/20">
                    <td colSpan={3} className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">Calculated Total</td>
                    <td className="px-3 py-2 text-sm font-bold text-foreground text-right">₹{calcTotal.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {type === "purchase" && (
            <label className="flex items-center gap-3 cursor-pointer bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
              <input type="checkbox" checked={applyStock} onChange={(e) => setApplyStock(e.target.checked)} className="w-4 h-4 rounded accent-emerald-500" />
              <div>
                <div className="text-sm font-medium text-emerald-400 flex items-center gap-1.5">
                  <Package className="w-4 h-4" /> Update stock quantities
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Matching products will have their stock increased by the item quantities above</div>
              </div>
            </label>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-card-border flex-shrink-0">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1" onClick={() => onConfirm({ vendorOrCustomer: vendor, invoiceDate: date, amount: calcTotal || total, lineItems: items.filter((it) => it.name.trim()), applyStock, type })}>
            Save Invoice
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── View Invoice Dialog ─────────────────────────────────────────────────────
function ViewInvoiceDialog({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [applying, setApplying] = useState(false);

  async function applyStock() {
    setApplying(true);
    try {
      const r = await fetch(`${BASE}/api/invoices/${invoice.id}/apply-stock`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Failed", variant: "destructive" }); return; }
      const matched = (data.results as { matched: boolean }[]).filter((x) => x.matched).length;
      const unmatched = data.results.length - matched;
      toast({ title: `Stock updated`, description: `${matched} products updated${unmatched > 0 ? `, ${unmatched} not matched` : ""}` });
      qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) });
      qc.invalidateQueries({ queryKey: ["products"] });
    } finally {
      setApplying(false);
      onClose();
    }
  }

  const items = invoice.lineItems ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-card border border-card-border rounded-2xl shadow-2xl z-10 w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border flex-shrink-0">
          <h3 className="font-semibold text-foreground">{invoice.vendorOrCustomer ?? "Invoice"}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="overflow-auto flex-1 p-6 space-y-4">
          {invoice.imageUrl && <img src={invoice.imageUrl} alt="Invoice" className="w-full max-h-48 object-contain rounded-lg border border-card-border" />}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/40 rounded-lg px-3 py-2"><div className="text-xs text-muted-foreground">Date</div><div className="font-medium">{invoice.invoiceDate ?? format(new Date(invoice.createdAt), "MMM d, yyyy")}</div></div>
            <div className="bg-muted/40 rounded-lg px-3 py-2"><div className="text-xs text-muted-foreground">Amount</div><div className="font-medium">₹{invoice.amount?.toFixed(2) ?? "—"}</div></div>
          </div>
          {items.length > 0 && (
            <div>
              <div className="text-sm font-medium text-foreground mb-2">Line Items</div>
              <div className="border border-card-border rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-muted/40 border-b border-card-border"><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2 w-16">Qty</th><th className="text-right px-3 py-2 w-20">Price</th><th className="text-right px-3 py-2 w-20">Total</th></tr></thead>
                  <tbody className="divide-y divide-card-border">
                    {items.map((it, i) => <tr key={i}><td className="px-3 py-2 text-foreground">{it.name}</td><td className="px-3 py-2 text-right">{it.quantity}</td><td className="px-3 py-2 text-right">₹{it.unitPrice.toFixed(2)}</td><td className="px-3 py-2 text-right font-medium">₹{it.subtotal.toFixed(2)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {invoice.stockUpdated && (
            <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" /> Stock has been updated from this invoice
            </div>
          )}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-card-border flex-shrink-0">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Close</Button>
          {!invoice.stockUpdated && items.length > 0 && invoice.type === "purchase" && (
            <Button className="flex-1" onClick={applyStock} disabled={applying}>
              <Package className="w-4 h-4 mr-1.5" /> {applying ? "Updating..." : "Apply to Stock"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function Invoices() {
  const [tab, setTab] = useState<"all" | "purchase" | "sale">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState("image/jpeg");
  const [parsedData, setParsedData] = useState<{ vendorOrCustomer?: string; amount?: number; invoiceDate?: string; items?: LineItem[] } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [proofInvoice, setProofInvoice] = useState<InvoiceRow | null>(null);
  const [viewInvoice, setViewInvoice] = useState<InvoiceRow | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ message: string; existing: InvoiceRow } | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: invoices, isLoading } = useListInvoices({}, { query: { queryKey: getListInvoicesQueryKey({}) } });
  const createInvoice = useCreateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const parseImage = useParseInvoiceImage();

  const filtered = ((invoices ?? []) as InvoiceRow[]).filter((inv) => tab === "all" || inv.type === tab);

  function openAdd() {
    setImagePreview(null);
    setImageBase64(null);
    setParsedData(null);
    setDuplicateWarning(null);
    setDialogOpen(true);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    const mime = file.type || "image/jpeg";
    setImageMime(mime);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const b64 = dataUrl.split(",")[1];
      setImagePreview(dataUrl);
      setImageBase64(b64);

      // Check duplicate
      const hashRes = await fetch(`${BASE}/api/invoices/check-duplicate?hash=${await sha256(b64)}`);
      const hashData = await hashRes.json();
      if (hashData.duplicate) {
        setDuplicateWarning({ message: `This invoice was already uploaded (${hashData.existingInvoice.vendorOrCustomer ?? "unknown vendor"}, ${hashData.existingInvoice.invoiceDate ?? "no date"})`, existing: hashData.existingInvoice });
        setScanning(false);
        return;
      }

      // AI parse
      const result = await parseImage.mutateAsync({ data: { imageBase64: b64, mimeType: mime } });
      setParsedData({
        vendorOrCustomer: result.vendorOrCustomer ?? undefined,
        amount: result.amount ?? undefined,
        invoiceDate: result.invoiceDate ?? undefined,
        items: result.items ?? undefined,
      });
      setScanning(false);
      setDialogOpen(false);
      setReviewOpen(true);
    };
    reader.readAsDataURL(file);
  }

  async function sha256(base64: string): Promise<string> {
    const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function handleReviewConfirm(data: { vendorOrCustomer: string; invoiceDate: string; amount: number; lineItems: LineItem[]; applyStock: boolean; type: "purchase" | "sale" }) {
    setReviewOpen(false);
    const body = {
      type: data.type,
      vendorOrCustomer: data.vendorOrCustomer || null,
      amount: data.amount || null,
      invoiceDate: data.invoiceDate || null,
      notes: null,
      imageBase64: imageBase64 ?? undefined,
      mimeType: imageMime,
      lineItems: data.lineItems,
    };
    const r = await fetch(`${BASE}/api/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const invoice = await r.json();
    qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) });
    toast({ title: "Invoice saved" });

    if (data.applyStock && data.type === "purchase" && invoice.id) {
      const sr = await fetch(`${BASE}/api/invoices/${invoice.id}/apply-stock`, { method: "POST" });
      const sd = await sr.json();
      const matched = (sd.results as { matched: boolean }[])?.filter((x) => x.matched).length ?? 0;
      const unmatched = (sd.results?.length ?? 0) - matched;
      toast({ title: "Stock updated", description: `${matched} products updated${unmatched > 0 ? `, ${unmatched} items not matched to products` : ""}` });
      qc.invalidateQueries({ queryKey: ["products"] });
    }
  }

  async function handleManualSave(data: InvoiceForm) {
    await createInvoice.mutateAsync({ data: { type: data.type, vendorOrCustomer: data.vendorOrCustomer || null, amount: data.amount ?? null, invoiceDate: data.invoiceDate || null, notes: data.notes || null } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) }); toast({ title: "Invoice saved" }); setDialogOpen(false); },
    });
  }

  async function handleDelete(id: number) {
    await deleteInvoice.mutateAsync({ id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) }); toast({ title: "Invoice deleted" }); } });
  }

  const form = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { type: "purchase", vendorOrCustomer: "", amount: undefined, invoiceDate: "", notes: "" },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {proofInvoice && <PaymentProofDialog invoice={proofInvoice} onClose={() => setProofInvoice(null)} />}
      {viewInvoice && <ViewInvoiceDialog invoice={viewInvoice} onClose={() => setViewInvoice(null)} />}
      {reviewOpen && parsedData && (
        <LineItemsReviewDialog
          vendorOrCustomer={parsedData.vendorOrCustomer ?? ""}
          invoiceDate={parsedData.invoiceDate ?? ""}
          amount={parsedData.amount ?? 0}
          lineItems={(parsedData.items ?? []).map((it) => ({ ...it, subtotal: it.subtotal ?? it.quantity * it.unitPrice }))}
          imagePreview={imagePreview}
          onConfirm={handleReviewConfirm}
          onCancel={() => setReviewOpen(false)}
        />
      )}

      {duplicateWarning && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-medium text-amber-400">Duplicate Invoice Detected</div>
            <div className="text-xs text-muted-foreground mt-1">{duplicateWarning.message}</div>
          </div>
          <button onClick={() => { setDuplicateWarning(null); setViewInvoice(duplicateWarning.existing); }} className="text-xs text-primary underline flex-shrink-0">View</button>
          <button onClick={() => setDuplicateWarning(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{invoices?.length ?? 0} invoices</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-1.5" /> Add Invoice</Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="purchase">Purchases</TabsTrigger>
          <TabsTrigger value="sale">Sales</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-card border border-card-border rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card border border-card-border rounded-xl">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No invoices yet. Upload your first invoice.</p>
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {filtered.slice().reverse().map((inv) => (
              <div key={inv.id} className="bg-card border border-card-border rounded-xl px-4 py-3 space-y-1.5 cursor-pointer" onClick={() => setViewInvoice(inv)}>
                <div className="flex items-center justify-between">
                  <span className={cn("text-xs px-2 py-0.5 rounded-full", inv.type === "purchase" ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400")}>{inv.type}</span>
                  <span className="font-bold text-foreground">{inv.amount != null ? `₹${inv.amount.toFixed(2)}` : "—"}</span>
                </div>
                <div className="font-medium text-foreground">{inv.vendorOrCustomer ?? "—"}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{inv.invoiceDate ?? format(new Date(inv.createdAt), "MMM d, yyyy")}</span>
                  {inv.type === "purchase" && (
                    <span className={cn("px-1.5 py-0.5 rounded-full", inv.paid ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>{inv.paid ? "Paid" : "Unpaid"}</span>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-card-border" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    {inv.type === "purchase" && (
                      inv.stockUpdated
                        ? <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Stock done</span>
                        : (inv.lineItems as LineItem[] | null)?.length ? <span className="text-xs text-amber-400 flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Stock pending</span> : null
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {inv.type === "purchase" && (
                      <button onClick={() => setProofInvoice(inv)} className={cn("text-xs px-2 py-1 rounded-lg transition-colors", inv.paymentProofUrl ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                        {inv.paymentProofUrl ? "Receipt" : "Pay"}
                      </button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(inv.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-card-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Vendor / Customer</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Stock</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {filtered.slice().reverse().map((inv) => (
                  <tr key={inv.id} className="hover:bg-accent/30 transition-colors cursor-pointer" onClick={() => setViewInvoice(inv)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", inv.type === "purchase" ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400")}>{inv.type}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{inv.vendorOrCustomer ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.invoiceDate ?? format(new Date(inv.createdAt), "MMM d, yyyy")}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">{inv.amount != null ? `₹${inv.amount.toFixed(2)}` : "—"}</td>
                    <td className="px-4 py-3">
                      {inv.type === "purchase" ? (
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", inv.paid ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>{inv.paid ? "Paid" : "Unpaid"}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.type === "purchase" && (
                        inv.stockUpdated
                          ? <span title="Stock updated"><CheckCircle className="w-4 h-4 text-emerald-400 mx-auto" /></span>
                          : (inv.lineItems as LineItem[] | null)?.length ? <span title="Stock not yet updated"><RotateCcw className="w-4 h-4 text-amber-400 mx-auto" /></span> : null
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {inv.type === "purchase" && (
                          <button onClick={() => setProofInvoice(inv)} className={cn("text-xs px-2 py-1 rounded-lg transition-colors", inv.paymentProofUrl ? "bg-primary/20 text-primary hover:bg-primary/30" : "bg-muted text-muted-foreground hover:bg-accent")}>
                            {inv.paymentProofUrl ? "Receipt" : "Pay"}
                          </button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(inv.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Add invoice dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Invoice</DialogTitle></DialogHeader>

          {/* Image upload area */}
          <div className="border-2 border-dashed border-card-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors" onClick={() => fileRef.current?.click()}>
            {scanning || parseImage.isPending ? (
              <div className="flex flex-col items-center gap-2"><Loader2 className="w-8 h-8 text-primary animate-spin" /><p className="text-sm text-muted-foreground">Scanning invoice and extracting items...</p></div>
            ) : imagePreview ? (
              <img src={imagePreview} alt="Invoice" className="max-h-32 mx-auto rounded object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Upload invoice photo</p>
                <p className="text-xs text-muted-foreground">AI will extract items, quantities and prices for you to review</p>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </div>

          <div className="relative flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-card-border" />
            <span className="text-xs text-muted-foreground">or enter manually</span>
            <div className="flex-1 h-px bg-card-border" />
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleManualSave)} className="space-y-4">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="purchase">Purchase (received goods)</SelectItem>
                      <SelectItem value="sale">Sale (sold goods)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="vendorOrCustomer" render={({ field }) => (
                <FormItem><FormLabel>Vendor / Customer</FormLabel><FormControl><Input placeholder="Name" {...field} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem><FormLabel>Amount (₹)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="invoiceDate" render={({ field }) => (
                  <FormItem><FormLabel>Invoice Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notes</FormLabel><FormControl><Input placeholder="Any notes..." {...field} /></FormControl></FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createInvoice.isPending}>Save Invoice</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
