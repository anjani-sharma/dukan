import { useState, useRef } from "react";
import { useListPurchases, useCreatePurchase, useDeletePurchase, useListProducts, getListPurchasesQueryKey, getListProductsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShoppingBag, X, PlusCircle, Loader2, AlertTriangle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const purchaseSchema = z.object({
  vendorName: z.string().min(1, "Vendor name required"),
  purchaseDate: z.string().optional(),
  notes: z.string().optional(),
});
type PurchaseForm = z.infer<typeof purchaseSchema>;

interface PurchaseItem {
  productName: string;
  quantity: number;
  costPrice: number;
  productId: number | null;
}

export default function Purchases() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<PurchaseItem[]>([{ productName: "", quantity: 1, costPrice: 0, productId: null }]);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dupWarning, setDupWarning] = useState<{ existingPurchase: { id: number; vendorName: string; totalAmount: number; createdAt: string } } | null>(null);
  const pendingSubmitRef = useRef<(() => Promise<void>) | null>(null);

  const { data: purchases, isLoading } = useListPurchases({ query: { queryKey: getListPurchasesQueryKey() } });
  const { data: products } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const createPurchase = useCreatePurchase();
  const deletePurchase = useDeletePurchase();

  const form = useForm<PurchaseForm>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: { vendorName: "", purchaseDate: format(new Date(), "yyyy-MM-dd"), notes: "" },
  });

  const totalAmount = items.reduce((s, i) => s + i.quantity * i.costPrice, 0);

  function openNew() {
    setItems([{ productName: "", quantity: 1, costPrice: 0, productId: null }]);
    form.reset({ vendorName: "", purchaseDate: format(new Date(), "yyyy-MM-dd"), notes: "" });
    setDialogOpen(true);
  }

  function addItem() { setItems([...items, { productName: "", quantity: 1, costPrice: 0, productId: null }]); }
  function removeItem(i: number) { setItems(items.filter((_, idx) => idx !== i)); }

  function updateItemName(i: number, name: string) {
    const matched = products?.find((p) => p.name.toLowerCase() === name.toLowerCase());
    setItems(items.map((item, idx) => idx === i ? {
      ...item,
      productName: name,
      productId: matched?.id ?? null,
      costPrice: matched ? matched.costPrice : item.costPrice,
    } : item));
  }

  function updateItemField(i: number, field: "quantity" | "costPrice", value: number) {
    setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  async function doCreatePurchase(data: PurchaseForm, validItems: PurchaseItem[]) {
    await createPurchase.mutateAsync({
      data: {
        vendorName: data.vendorName,
        purchaseDate: (data.purchaseDate || null) as unknown as string,
        notes: data.notes || null,
        items: validItems.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.costPrice, productId: i.productId })),
        applyStock: true,
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        toast({ title: "Purchase recorded", description: `Stock updated for ${validItems.length} item(s)` });
        setDialogOpen(false);
        setDupWarning(null);
      },
    });
  }

  async function onSubmit(data: PurchaseForm) {
    const validItems = items.filter((i) => i.productName.trim());
    if (!validItems.length) { toast({ title: "Add at least one item", variant: "destructive" }); return; }

    const total = validItems.reduce((s, i) => s + i.quantity * i.costPrice, 0);
    try {
      const params = new URLSearchParams({ vendorName: data.vendorName, totalAmount: String(total) });
      if (data.purchaseDate) params.set("purchaseDate", data.purchaseDate);
      const check = await fetch(`/api/purchases/check-duplicate?${params}`).then((r) => r.json()) as { duplicate: boolean; existingPurchase?: { id: number; vendorName: string; totalAmount: number; createdAt: string } };
      if (check.duplicate && check.existingPurchase) {
        pendingSubmitRef.current = () => doCreatePurchase(data, validItems);
        setDupWarning({ existingPurchase: check.existingPurchase });
        return;
      }
    } catch { /* ignore */ }

    await doCreatePurchase(data, validItems);
  }

  async function handleDelete(id: number) {
    await deletePurchase.mutateAsync({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPurchasesQueryKey() }); toast({ title: "Purchase deleted" }); },
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* Duplicate purchase warning */}
      <Dialog open={!!dupWarning} onOpenChange={(o) => { if (!o) setDupWarning(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-400" /> Possible Duplicate Purchase</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">A purchase from <span className="font-semibold text-foreground">{dupWarning?.existingPurchase?.vendorName}</span> for <span className="font-semibold text-foreground">₹{dupWarning?.existingPurchase?.totalAmount?.toFixed(2)}</span> on the same date already exists (ID #{dupWarning?.existingPurchase?.id}).</p>
          <p className="text-sm text-muted-foreground">This may be a duplicate bill entry. Save anyway?</p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setDupWarning(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { pendingSubmitRef.current?.(); }}>Save Anyway</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Purchases</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Stock-in records · {purchases?.length ?? 0} entries</p>
        </div>
        <Button onClick={openNew} data-testid="button-new-purchase">
          <Plus className="w-4 h-4 mr-1.5" /> New Purchase
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-card border border-card-border rounded-xl animate-pulse" />)}</div>
      ) : !purchases?.length ? (
        <div className="text-center py-16 bg-card border border-card-border rounded-xl">
          <ShoppingBag className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No purchases yet. Record your first stock-in.</p>
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {(purchases ?? []).slice().reverse().map((p) => (
              <div key={p.id} className="bg-card border border-card-border rounded-xl px-4 py-3 space-y-1.5" data-testid={`row-purchase-${p.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {p.purchaseDate ? format(new Date(p.purchaseDate), "MMM d, yyyy") : format(new Date(p.createdAt), "MMM d, yyyy")}
                  </span>
                  <span className="font-bold text-foreground">₹{p.totalAmount.toFixed(2)}</span>
                </div>
                <div className="font-medium text-foreground">{p.vendorName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {(p.items as { productName: string; quantity: number }[]).map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                </div>
                {p.notes && <div className="text-xs text-muted-foreground/70 italic">{p.notes}</div>}
                <div className="flex justify-end pt-1 border-t border-card-border">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(p.id)} data-testid={`button-delete-purchase-${p.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-card-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Vendor</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Total</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {(purchases ?? []).slice().reverse().map((p) => (
                  <tr key={p.id} className="hover:bg-accent/30 transition-colors" data-testid={`row-purchase-${p.id}`}>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {p.purchaseDate ? format(new Date(p.purchaseDate), "MMM d, yyyy") : format(new Date(p.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{p.vendorName}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">
                      {(p.items as { productName: string; quantity: number }[]).map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">₹{p.totalAmount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{p.notes ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(p.id)} data-testid={`button-delete-purchase-${p.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Purchase / Stock-In</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="vendorName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor / Supplier</FormLabel>
                    <FormControl><Input placeholder="e.g. Havells Distributor" {...field} data-testid="input-vendor-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-purchase-date" /></FormControl>
                  </FormItem>
                )} />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Items (auto-updates stock)</label>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-[1fr_80px_100px_32px] gap-2 items-center" data-testid={`purchase-item-${i}`}>
                      <Input
                        placeholder="Product name"
                        value={item.productName}
                        onChange={(e) => updateItemName(i, e.target.value)}
                        list="product-suggestions-buy"
                        data-testid={`input-purchase-item-name-${i}`}
                      />
                      <Input
                        type="number" min={0.01} step="0.01" placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => updateItemField(i, "quantity", parseFloat(e.target.value) || 0)}
                        data-testid={`input-purchase-item-qty-${i}`}
                      />
                      <Input
                        type="number" min={0} step="0.01" placeholder="Cost ₹"
                        value={item.costPrice}
                        onChange={(e) => updateItemField(i, "costPrice", parseFloat(e.target.value) || 0)}
                        data-testid={`input-purchase-item-cost-${i}`}
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => removeItem(i)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <datalist id="product-suggestions-buy">
                  {products?.map((p) => <option key={p.id} value={p.name} />)}
                </datalist>
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={addItem}>
                  <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> Add Item
                </Button>
              </div>

              <div className="bg-muted/50 rounded-xl p-4 flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Total Purchase Amount</span>
                <span className="text-lg font-bold text-foreground">₹{totalAmount.toFixed(2)}</span>
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl><Input placeholder="Invoice number, batch, etc." {...field} data-testid="input-purchase-notes" /></FormControl>
                </FormItem>
              )} />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createPurchase.isPending} data-testid="button-submit-purchase">
                  {createPurchase.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Record Purchase
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
