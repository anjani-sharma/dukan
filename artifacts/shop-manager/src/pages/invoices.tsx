import { useState, useRef } from "react";
import { useListInvoices, useCreateInvoice, useDeleteInvoice, useParseInvoiceImage, getListInvoicesQueryKey } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FileText, Upload, Loader2, CheckCircle, Image, X } from "lucide-react";
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

const invoiceSchema = z.object({
  type: z.enum(["purchase", "sale"]),
  vendorOrCustomer: z.string().optional(),
  amount: z.coerce.number().optional(),
  invoiceDate: z.string().optional(),
  notes: z.string().optional(),
});
type InvoiceForm = z.infer<typeof invoiceSchema>;

interface InvoiceRow {
  id: number; type: string; vendorOrCustomer?: string | null; amount?: number | null;
  invoiceDate?: string | null; imageUrl?: string | null; paymentProofUrl?: string | null;
  paid?: boolean; notes?: string | null; createdAt: string;
}

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) }); },
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

  async function markPaid() {
    await patchInvoice.mutateAsync({ paid: true });
    toast({ title: "Invoice marked as paid" });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-card-border rounded-2xl shadow-2xl z-10 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Payment Proof — {invoice.vendorOrCustomer ?? "Invoice"}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div
          className="border-2 border-dashed border-card-border rounded-xl p-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Uploading...</p>
            </div>
          ) : preview ? (
            <img src={preview} alt="Payment proof" className="max-h-48 mx-auto rounded object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-4">
              <Image className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Upload payment screenshot or receipt</p>
            </div>
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
            <Button className="flex-1" onClick={markPaid} disabled={patchInvoice.isPending} data-testid="button-mark-paid">
              <CheckCircle className="w-4 h-4 mr-1.5" /> Mark as Paid
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Invoices() {
  const [tab, setTab] = useState<"all" | "purchase" | "sale">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [proofInvoice, setProofInvoice] = useState<InvoiceRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: invoices, isLoading } = useListInvoices({}, { query: { queryKey: getListInvoicesQueryKey({}) } });
  const createInvoice = useCreateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const parseImage = useParseInvoiceImage();

  const form = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { type: "purchase", vendorOrCustomer: "", amount: undefined, invoiceDate: "", notes: "" },
  });

  const filtered = ((invoices ?? []) as InvoiceRow[]).filter((inv) => tab === "all" || inv.type === tab);

  function openAdd() {
    form.reset({ type: "purchase", vendorOrCustomer: "", notes: "" });
    setImagePreview(null);
    setDialogOpen(true);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      const b64 = dataUrl.split(",")[1];
      const mimeType = file.type || "image/jpeg";
      const result = await parseImage.mutateAsync({ data: { imageBase64: b64, mimeType } });
      if (result.vendorOrCustomer) form.setValue("vendorOrCustomer", result.vendorOrCustomer);
      if (result.amount) form.setValue("amount", result.amount);
      if (result.invoiceDate) form.setValue("invoiceDate", result.invoiceDate);
      toast({ title: "Invoice scanned", description: result.vendorOrCustomer ?? "Details extracted" });
    };
    reader.readAsDataURL(file);
  }

  async function onSubmit(data: InvoiceForm) {
    await createInvoice.mutateAsync({
      data: { type: data.type, vendorOrCustomer: data.vendorOrCustomer || null, amount: data.amount ?? null, invoiceDate: data.invoiceDate || null, notes: data.notes || null }
    }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) }); toast({ title: "Invoice saved" }); setDialogOpen(false); },
    });
  }

  async function handleDelete(id: number) {
    await deleteInvoice.mutateAsync({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) }); toast({ title: "Invoice deleted" }); },
    });
  }

  return (
    <div className="p-6 space-y-5">
      {proofInvoice && <PaymentProofDialog invoice={proofInvoice} onClose={() => setProofInvoice(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{invoices?.length ?? 0} invoices</p>
        </div>
        <Button onClick={openAdd} data-testid="button-add-invoice">
          <Plus className="w-4 h-4 mr-1.5" /> Add Invoice
        </Button>
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
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Vendor / Customer</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Proof</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filtered.slice().reverse().map((inv) => (
                <tr key={inv.id} className="hover:bg-accent/30 transition-colors" data-testid={`row-invoice-${inv.id}`}>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${inv.type === "purchase" ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                      {inv.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground">{inv.vendorOrCustomer ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.invoiceDate ?? format(new Date(inv.createdAt), "MMM d, yyyy")}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{inv.amount != null ? `₹${inv.amount.toFixed(2)}` : "—"}</td>
                  <td className="px-4 py-3">
                    {inv.type === "purchase" ? (
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", inv.paid ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>
                        {inv.paid ? "Paid" : "Unpaid"}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {inv.type === "purchase" && (
                      <button
                        onClick={() => setProofInvoice(inv)}
                        className={cn("text-xs px-2 py-1 rounded-lg transition-colors", inv.paymentProofUrl ? "bg-primary/20 text-primary hover:bg-primary/30" : "bg-muted text-muted-foreground hover:bg-accent")}
                        data-testid={`button-proof-${inv.id}`}
                      >
                        {inv.paymentProofUrl ? "View" : "Upload"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(inv.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Invoice</DialogTitle></DialogHeader>
          <div
            className="border-2 border-dashed border-card-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {parseImage.isPending ? (
              <div className="flex flex-col items-center gap-2"><Loader2 className="w-8 h-8 text-primary animate-spin" /><p className="text-sm text-muted-foreground">Scanning invoice...</p></div>
            ) : imagePreview ? (
              <img src={imagePreview} alt="Invoice" className="max-h-32 mx-auto rounded object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2"><Upload className="w-8 h-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Upload invoice photo — AI will extract details</p></div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="purchase">Purchase (you received goods)</SelectItem>
                      <SelectItem value="sale">Sale (you sold goods)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="vendorOrCustomer" render={({ field }) => (
                <FormItem><FormLabel>Vendor / Customer</FormLabel><FormControl><Input placeholder="Company or person name" {...field} /></FormControl></FormItem>
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
