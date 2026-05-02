import { useState, useRef } from "react";
import { useListSales, useCreateSale, useDeleteSale, useListProducts, useListCustomers, useTranscribeVoice, getListSalesQueryKey, getListProductsQueryKey, getListCustomersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShoppingCart, Mic, MicOff, Loader2, X, PlusCircle, AlertTriangle } from "lucide-react";
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

const saleSchema = z.object({
  customerId: z.string().optional(),
  paidAmount: z.coerce.number().min(0),
  notes: z.string().optional(),
});
type SaleForm = z.infer<typeof saleSchema>;

interface SaleItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  productId: number | null;
}

export default function Sales() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<SaleItem[]>([{ productName: "", quantity: 1, unitPrice: 0, productId: null }]);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: sales, isLoading } = useListSales({}, { query: { queryKey: getListSalesQueryKey({}) } });
  const { data: products } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  const createSale = useCreateSale();
  const deleteSale = useDeleteSale();
  const transcribeVoice = useTranscribeVoice();

  const form = useForm<SaleForm>({
    resolver: zodResolver(saleSchema),
    defaultValues: { customerId: "walk-in", paidAmount: 0, notes: "" },
  });

  const totalAmount = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const paidAmount = form.watch("paidAmount") ?? 0;
  const creditAmount = Math.max(0, totalAmount - paidAmount);

  function openNew() {
    setItems([{ productName: "", quantity: 1, unitPrice: 0, productId: null }]);
    setTranscript("");
    form.reset({ customerId: "walk-in", paidAmount: 0, notes: "" });
    setDialogOpen(true);
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
            return {
              productName: i.productName,
              quantity: i.quantity,
              unitPrice: matched ? matched.sellingPrice : i.unitPrice,
              productId: matched?.id ?? null,
            };
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

  async function onSubmit(data: SaleForm) {
    const validItems = items.filter((i) => i.productName.trim());
    if (!validItems.length) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    await createSale.mutateAsync({
      data: {
        customerId: data.customerId && data.customerId !== "walk-in" ? parseInt(data.customerId) : null,
        items: validItems.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, productId: i.productId })),
        paidAmount: data.paidAmount,
        notes: data.notes || null,
        source: "web",
      }
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) });
        qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        toast({ title: "Sale recorded" });
        setDialogOpen(false);
      },
    });
  }

  async function handleDelete(id: number) {
    await deleteSale.mutateAsync({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) }); toast({ title: "Sale deleted" }); },
    });
  }

  const lowStockItems = (products ?? []).filter((p) => p.stockQuantity <= p.lowStockThreshold);

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

      {/* Low stock warning banner */}
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
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Source</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {(sales ?? []).slice().reverse().map((s) => (
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
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", s.source === "telegram" ? "bg-blue-500/20 text-blue-400" : "bg-muted text-muted-foreground")}>
                      {s.source}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(s.id)} data-testid={`button-delete-sale-${s.id}`}>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Sale</DialogTitle>
          </DialogHeader>

          {/* Voice button */}
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
              {/* Items */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Items</label>
                <div className="space-y-2">
                  {items.map((item, i) => {
                    const matched = products?.find((p) => p.id === item.productId);
                    const isLow = matched && matched.stockQuantity <= matched.lowStockThreshold;
                    return (
                      <div key={i} className="space-y-1" data-testid={`sale-item-${i}`}>
                        <div className="grid grid-cols-[1fr_80px_90px_32px] gap-2 items-center">
                          <Input
                            placeholder="Product name"
                            value={item.productName}
                            onChange={(e) => updateItemName(i, e.target.value)}
                            list="product-suggestions"
                            data-testid={`input-item-name-${i}`}
                          />
                          <Input
                            type="number" min={0.01} step="0.01" placeholder="Qty"
                            value={item.quantity}
                            onChange={(e) => updateItemField(i, "quantity", parseFloat(e.target.value) || 0)}
                            data-testid={`input-item-qty-${i}`}
                          />
                          <Input
                            type="number" min={0} step="0.01" placeholder="Price"
                            value={item.unitPrice}
                            onChange={(e) => updateItemField(i, "unitPrice", parseFloat(e.target.value) || 0)}
                            data-testid={`input-item-price-${i}`}
                          />
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

              {/* Totals */}
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

              {/* Customer */}
              <FormField control={form.control} name="customerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer (optional)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-customer">
                        <SelectValue placeholder="Walk-in customer" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in customer</SelectItem>
                      {customers?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
    </div>
  );
}
