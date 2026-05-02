import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Image, X, Loader2, ChevronDown, ChevronRight, CreditCard, Wallet, Smartphone, Building2, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type PaymentMethod = "cash" | "bank" | "gpay" | "upi" | "cheque";

interface VendorPayment {
  id: number; vendorName: string; amount: number; paymentDate?: string | null;
  paymentMethod: string; proofImageUrl?: string | null; notes?: string | null;
  linkedInvoiceId?: number | null; createdAt: string;
}

interface VendorSummary {
  vendorName: string; totalBilled: number; totalPaid: number; outstanding: number;
  invoiceCount: number; paymentCount: number; lastPayment: string | null;
}

const METHOD_ICONS: Record<string, typeof CreditCard> = {
  cash: Wallet, bank: Building2, gpay: Smartphone, upi: Smartphone, cheque: CreditCard,
};
const METHOD_COLORS: Record<string, string> = {
  cash: "bg-emerald-500/20 text-emerald-400",
  bank: "bg-blue-500/20 text-blue-400",
  gpay: "bg-purple-500/20 text-purple-400",
  upi: "bg-orange-500/20 text-orange-400",
  cheque: "bg-gray-500/20 text-gray-400",
};

function fmt(n: number) { return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function AddPaymentDialog({ prefillVendor, onClose }: { prefillVendor?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [vendorName, setVendorName] = useState(prefillVendor ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [method, setMethod] = useState<PaymentMethod>("gpay");
  const [notes, setNotes] = useState("");
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Get vendors from summary for autocomplete
  const { data: summary } = useQuery<VendorSummary[]>({
    queryKey: ["vendor-payments", "summary"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/vendor-payments/summary`); return r.json(); },
  });
  const vendorNames = (summary ?? []).map((v) => v.vendorName);

  const create = useMutation({
    mutationFn: async (body: object) => {
      const r = await fetch(`${BASE}/api/vendor-payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-payments"] });
      toast({ title: "Payment recorded" });
      onClose();
    },
  });

  const [scanning, setScanning] = useState(false);
  const [scannedInfo, setScannedInfo] = useState<{ bankName?: string; accountHolder?: string; referenceNumber?: string } | null>(null);

  async function handleProofUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const mime = file.type || "image/jpeg";
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setProofPreview(dataUrl);
      setUploading(false);

      // AI parse the receipt
      setScanning(true);
      try {
        const b64 = dataUrl.split(",")[1];
        const r = await fetch(`${BASE}/api/ai/parse-payment-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: b64, mimeType: mime }),
        });
        const data = await r.json();
        if (data.amount) setAmount(String(data.amount));
        if (data.paymentDate) setDate(data.paymentDate);
        if (data.paymentMethod) setMethod(data.paymentMethod as PaymentMethod);
        if (data.bankName || data.accountHolder || data.referenceNumber) {
          setScannedInfo({ bankName: data.bankName, accountHolder: data.accountHolder, referenceNumber: data.referenceNumber });
          const noteParts = [data.bankName, data.referenceNumber ? `Ref: ${data.referenceNumber}` : null].filter(Boolean);
          if (noteParts.length > 0 && !notes) setNotes(noteParts.join(" · "));
        }
        if (data.merchantOrVendor && !vendorName) setVendorName(data.merchantOrVendor);
        toast({ title: "Receipt scanned", description: `₹${data.amount ?? "?"} · ${data.paymentMethod ?? "unknown method"}` });
      } catch {
        toast({ title: "Could not read receipt automatically", description: "Please fill in details manually" });
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!vendorName.trim() || !amount) { toast({ title: "Vendor and amount are required", variant: "destructive" }); return; }
    await create.mutateAsync({ vendorName, amount: parseFloat(amount), paymentDate: date || null, paymentMethod: method, notes: notes || null, proofImageUrl: proofPreview ?? null });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-card-border rounded-2xl shadow-2xl z-10 w-full max-w-md space-y-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">Record Payment to Vendor</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Upload a receipt — AI will fill in the details</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {/* Receipt upload FIRST — AI fills the form */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Receipt / Bank Slip / Screenshot</label>
          <div className="border-2 border-dashed border-card-border rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 transition-colors" onClick={() => fileRef.current?.click()}>
            {uploading || scanning ? (
              <div className="flex flex-col items-center gap-2 py-3">
                <Loader2 className="w-7 h-7 text-primary animate-spin" />
                <p className="text-xs text-muted-foreground">{uploading ? "Loading image..." : "AI reading receipt..."}</p>
              </div>
            ) : proofPreview ? (
              <div className="space-y-2">
                <img src={proofPreview} alt="Receipt" className="max-h-32 mx-auto rounded object-contain" />
                {scannedInfo && (
                  <div className="text-left bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-xs space-y-0.5">
                    {scannedInfo.bankName && <div className="text-emerald-400 font-medium">{scannedInfo.bankName}</div>}
                    {scannedInfo.accountHolder && <div className="text-muted-foreground">A/c: {scannedInfo.accountHolder}</div>}
                    {scannedInfo.referenceNumber && <div className="text-muted-foreground">Ref: {scannedInfo.referenceNumber}</div>}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Tap to change</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-3">
                <Image className="w-7 h-7 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Upload bank slip, GPay or UPI screenshot</p>
                  <p className="text-xs text-muted-foreground mt-0.5">AI will extract amount, date and bank details automatically</p>
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProofUpload} />
          </div>
        </div>

        {/* Vendor name with datalist */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Vendor / Supplier Name</label>
          <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Who did you pay?" list="vendor-list" />
          <datalist id="vendor-list">{vendorNames.map((v) => <option key={v} value={v} />)}</datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Amount (₹)</label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Payment Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {/* Payment method */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Payment Method</label>
          <div className="grid grid-cols-5 gap-1.5">
            {(["cash", "gpay", "upi", "bank", "cheque"] as PaymentMethod[]).map((m) => {
              const Icon = METHOD_ICONS[m] ?? CreditCard;
              return (
                <button key={m} onClick={() => setMethod(m)} className={cn("flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-xs font-medium border transition-colors", method === m ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 text-muted-foreground border-card-border hover:bg-accent")}>
                  <Icon className="w-4 h-4" />{m.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Notes</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Bank of Baroda · Ref: 0208376469" />
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={save} disabled={create.isPending || scanning}>Save Payment</Button>
        </div>
      </div>
    </div>
  );
}

function VendorCard({ vendor, payments, onAddPayment }: { vendor: VendorSummary; payments: VendorPayment[]; onAddPayment: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [viewProof, setViewProof] = useState<string | null>(null);

  const deletePayment = useMutation({
    mutationFn: async (id: number) => { await fetch(`${BASE}/api/vendor-payments/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-payments"] }); toast({ title: "Payment deleted" }); },
  });

  const vendorPayments = payments.filter((p) => p.vendorName === vendor.vendorName);

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      {viewProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setViewProof(null)}>
          <div className="absolute inset-0 bg-black/80" />
          <img src={viewProof} alt="Receipt" className="relative z-10 max-h-[80vh] max-w-[90vw] rounded-xl object-contain" />
        </div>
      )}

      {/* Vendor header */}
      <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-accent/20 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{vendor.vendorName}</span>
            {vendor.outstanding > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium">Owes</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{vendor.invoiceCount} invoices · {vendor.paymentCount} payments</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className={cn("font-bold text-base", vendor.outstanding > 0 ? "text-red-400" : "text-emerald-400")}>
            {fmt(vendor.outstanding)}
          </div>
        </div>
        <div className="text-right hidden sm:block">
          <div className="text-xs text-muted-foreground">Billed</div>
          <div className="text-sm font-medium text-foreground">{fmt(vendor.totalBilled)}</div>
        </div>
        <div className="text-right hidden sm:block">
          <div className="text-xs text-muted-foreground">Paid</div>
          <div className="text-sm font-medium text-emerald-400">{fmt(vendor.totalPaid)}</div>
        </div>
        <button className="text-muted-foreground ml-1">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Progress bar */}
      {vendor.totalBilled > 0 && (
        <div className="h-1 bg-muted/50 mx-5 mb-2 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, (vendor.totalPaid / vendor.totalBilled) * 100)}%` }} />
        </div>
      )}

      {expanded && (
        <div className="border-t border-card-border">
          <div className="px-5 py-3 flex items-center justify-between bg-muted/20">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payment History</span>
            <Button size="sm" onClick={(e) => { e.stopPropagation(); onAddPayment(); }} className="h-7 text-xs">
              <Plus className="w-3 h-3 mr-1" /> Add Payment
            </Button>
          </div>
          {vendorPayments.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">No payments recorded yet</div>
          ) : (
            <div className="divide-y divide-card-border">
              {vendorPayments.slice().reverse().map((p) => {
                const Icon = METHOD_ICONS[p.paymentMethod] ?? CreditCard;
                return (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/20 transition-colors">
                    <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", METHOD_COLORS[p.paymentMethod] ?? "bg-muted text-muted-foreground")}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{fmt(p.amount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.paymentDate ? format(new Date(p.paymentDate + "T00:00:00"), "MMM d, yyyy") : format(new Date(p.createdAt), "MMM d, yyyy")}
                        {" · "}{p.paymentMethod.toUpperCase()}
                        {p.notes && ` · ${p.notes}`}
                      </div>
                    </div>
                    {p.proofImageUrl && (
                      <button onClick={() => setViewProof(p.proofImageUrl!)} className="text-xs px-2 py-1 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors flex-shrink-0">
                        Receipt
                      </button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0" onClick={() => deletePayment.mutate(p.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VendorPayments() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [prefillVendor, setPrefillVendor] = useState<string | undefined>();

  const { data: summary, isLoading: summaryLoading } = useQuery<VendorSummary[]>({
    queryKey: ["vendor-payments", "summary"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/vendor-payments/summary`); return r.json(); },
  });

  const { data: payments } = useQuery<VendorPayment[]>({
    queryKey: ["vendor-payments"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/vendor-payments`); return r.json(); },
  });

  const totalOutstanding = (summary ?? []).reduce((s, v) => s + v.outstanding, 0);
  const totalBilled = (summary ?? []).reduce((s, v) => s + v.totalBilled, 0);
  const totalPaid = (summary ?? []).reduce((s, v) => s + v.totalPaid, 0);

  function openAdd(vendor?: string) {
    setPrefillVendor(vendor);
    setAddDialogOpen(true);
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {addDialogOpen && <AddPaymentDialog prefillVendor={prefillVendor} onClose={() => setAddDialogOpen(false)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Vendor Payments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track bills and payments per vendor</p>
        </div>
        <Button onClick={() => openAdd()}><Plus className="w-4 h-4 mr-1.5" /> Add Payment</Button>
      </div>

      {/* Summary bar */}
      {!summaryLoading && (
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Billed by Vendors</div>
            <div className="text-xl font-bold text-foreground">{fmt(totalBilled)}</div>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Paid</div>
            <div className="text-xl font-bold text-emerald-400">{fmt(totalPaid)}</div>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Still Owe</div>
            <div className={cn("text-xl font-bold", totalOutstanding > 0 ? "text-red-400" : "text-emerald-400")}>{fmt(totalOutstanding)}</div>
          </div>
        </div>
      )}

      {summaryLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-card border border-card-border rounded-xl animate-pulse" />)}</div>
      ) : !summary || summary.length === 0 ? (
        <div className="text-center py-16 bg-card border border-card-border rounded-xl">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No vendor records yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Add purchase invoices or record payments to see vendors here.</p>
          <Button className="mt-4" onClick={() => openAdd()}><Plus className="w-4 h-4 mr-1.5" /> Add Payment</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {summary.map((vendor) => (
            <VendorCard key={vendor.vendorName} vendor={vendor} payments={payments ?? []} onAddPayment={() => openAdd(vendor.vendorName)} />
          ))}
        </div>
      )}
    </div>
  );
}
