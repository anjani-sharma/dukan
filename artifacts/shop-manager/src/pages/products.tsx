import { useState, useRef } from "react";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Package, Pencil, Trash2, AlertTriangle, PackagePlus, Upload, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const GST_RATES = [0, 5, 12, 18, 28];

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  sku: z.string().optional(),
  category: z.string().optional(),
  costPrice: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  stockQuantity: z.coerce.number().int().min(0),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  unit: z.string().default("pcs"),
  hsnCode: z.string().optional(),
  gstRate: z.coerce.number().int().min(0).default(0),
});
type ProductForm = z.infer<typeof productSchema>;

const adjustSchema = z.object({ amount: z.coerce.number().int() });
type AdjustForm = z.infer<typeof adjustSchema>;

function parseCSV(text: string): Partial<ProductForm>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/['"]/g, "").toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/['"]/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return {
      name: row["name"] || row["product name"] || row["item"] || "",
      category: row["category"] || row["cat"] || "",
      sku: row["sku"] || row["code"] || "",
      costPrice: parseFloat(row["cost price"] || row["cost"] || row["costprice"] || "0") || 0,
      sellingPrice: parseFloat(row["selling price"] || row["price"] || row["sellingprice"] || row["mrp"] || "0") || 0,
      stockQuantity: parseInt(row["stock"] || row["quantity"] || row["qty"] || row["stock quantity"] || "0") || 0,
      unit: row["unit"] || "pcs",
      hsnCode: row["hsn"] || row["hsn code"] || row["hsncode"] || "",
      gstRate: parseInt(row["gst"] || row["gst rate"] || row["gstrate"] || "0") || 0,
      lowStockThreshold: parseInt(row["low stock"] || row["threshold"] || "5") || 5,
    };
  }).filter((r) => r.name);
}

export default function Products() {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<{ id: number; name: string; stock: number; unit: string } | null>(null);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<Partial<ProductForm>[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dupWarning, setDupWarning] = useState<{ existingProduct: { id: number; name: string } } | null>(null);
  const pendingSubmitRef = useRef<(() => Promise<void>) | null>(null);

  const { data: products, isLoading } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const form = useForm<ProductForm>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: "", costPrice: 0, sellingPrice: 0, stockQuantity: 0, lowStockThreshold: 5, unit: "pcs", gstRate: 0, hsnCode: "" },
  });

  const adjustForm = useForm<AdjustForm>({
    resolver: zodResolver(adjustSchema),
    defaultValues: { amount: 0 },
  });

  const filtered = (products ?? []).filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.category ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const lowStockCount = (products ?? []).filter((p) => p.stockQuantity <= p.lowStockThreshold).length;

  function openAdd() {
    setEditingId(null);
    form.reset({ name: "", costPrice: 0, sellingPrice: 0, stockQuantity: 0, lowStockThreshold: 5, unit: "pcs", gstRate: 0, hsnCode: "" });
    setDialogOpen(true);
  }

  function openEdit(p: NonNullable<typeof products>[0]) {
    setEditingId(p.id);
    const pp = p as unknown as ProductForm & { hsnCode?: string; gstRate?: number };
    form.reset({
      name: p.name,
      description: p.description ?? "",
      sku: p.sku ?? "",
      category: p.category ?? "",
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      stockQuantity: p.stockQuantity,
      lowStockThreshold: p.lowStockThreshold,
      unit: p.unit,
      hsnCode: pp.hsnCode ?? "",
      gstRate: pp.gstRate ?? 0,
    });
    setDialogOpen(true);
  }

  function openAdjust(p: NonNullable<typeof products>[0]) {
    setAdjustProduct({ id: p.id, name: p.name, stock: p.stockQuantity, unit: p.unit });
    adjustForm.reset({ amount: 0 });
  }

  async function doSaveProduct(data: ProductForm) {
    const payload = {
      name: data.name,
      description: data.description || null,
      sku: data.sku || null,
      category: data.category || null,
      costPrice: data.costPrice,
      sellingPrice: data.sellingPrice,
      stockQuantity: data.stockQuantity,
      lowStockThreshold: data.lowStockThreshold,
      unit: data.unit,
      hsnCode: data.hsnCode || null,
      gstRate: data.gstRate ?? 0,
    };
    if (editingId) {
      await updateProduct.mutateAsync({ id: editingId, data: payload }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) }); toast({ title: "Product updated" }); setDialogOpen(false); setDupWarning(null); },
      });
    } else {
      await createProduct.mutateAsync({ data: payload }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) }); toast({ title: "Product added" }); setDialogOpen(false); setDupWarning(null); },
      });
    }
  }

  async function onSubmit(data: ProductForm) {
    if (!editingId) {
      try {
        const check = await fetch(`/api/products/check-duplicate?name=${encodeURIComponent(data.name)}`).then((r) => r.json()) as { duplicate: boolean; existingProduct?: { id: number; name: string } };
        if (check.duplicate && check.existingProduct) {
          pendingSubmitRef.current = () => doSaveProduct(data);
          setDupWarning({ existingProduct: check.existingProduct });
          return;
        }
      } catch { /* ignore */ }
    }
    await doSaveProduct(data);
  }

  async function onAdjust(data: AdjustForm) {
    if (!adjustProduct) return;
    const newQty = Math.max(0, adjustProduct.stock + data.amount);
    await updateProduct.mutateAsync({ id: adjustProduct.id, data: { stockQuantity: newQty } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        toast({ title: data.amount >= 0 ? `Added ${data.amount} to stock` : `Removed ${Math.abs(data.amount)} from stock`, description: `${adjustProduct.name}: now ${newQty} ${adjustProduct.unit}` });
        setAdjustProduct(null);
      },
    });
  }

  async function handleDelete(id: number) {
    await deleteProduct.mutateAsync({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) }); toast({ title: "Product deleted" }); },
    });
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (!rows.length) { toast({ title: "No valid rows found", description: "Check CSV format: name, category, costPrice, sellingPrice, stockQuantity, unit, hsnCode, gstRate", variant: "destructive" }); return; }
      setCsvPreview(rows);
      setCsvDialogOpen(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function importCSV() {
    setCsvImporting(true);
    let ok = 0;
    for (const row of csvPreview) {
      if (!row.name) continue;
      try {
        await createProduct.mutateAsync({ data: {
          name: row.name,
          category: row.category || null,
          sku: row.sku || null,
          costPrice: row.costPrice ?? 0,
          sellingPrice: row.sellingPrice ?? 0,
          stockQuantity: row.stockQuantity ?? 0,
          lowStockThreshold: row.lowStockThreshold ?? 5,
          unit: row.unit || "pcs",
          hsnCode: row.hsnCode || null,
          gstRate: row.gstRate ?? 0,
          description: null,
        }});
        ok++;
      } catch {
        // skip errored rows
      }
    }
    qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
    setCsvImporting(false);
    setCsvDialogOpen(false);
    setCsvPreview([]);
    toast({ title: `Imported ${ok} of ${csvPreview.length} products` });
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {products?.length ?? 0} items in inventory
            {lowStockCount > 0 && <span className="ml-2 text-red-400 font-medium">· {lowStockCount} low stock</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFile} data-testid="input-csv-file" />
          <Button variant="outline" onClick={() => csvInputRef.current?.click()} data-testid="button-csv-import">
            <Upload className="w-4 h-4 mr-1.5" /> Import CSV
          </Button>
          <Button onClick={openAdd} data-testid="button-add-product">
            <Plus className="w-4 h-4 mr-1.5" /> Add Product
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-products" />
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-card border border-card-border rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card border border-card-border rounded-xl">
          <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No products yet. Add your first product.</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Product</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">HSN / GST</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Cost</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Price</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Margin</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Stock</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filtered.map((p) => {
                const pp = p as unknown as { hsnCode?: string; gstRate?: number } & typeof p;
                const isLow = p.stockQuantity <= p.lowStockThreshold;
                const margin = p.costPrice > 0 ? ((p.sellingPrice - p.costPrice) / p.costPrice * 100) : 0;
                return (
                  <tr key={p.id} className={cn("hover:bg-accent/30 transition-colors", isLow && "bg-red-500/5")} data-testid={`row-product-${p.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.name}</div>
                      {p.sku && <div className="text-xs text-muted-foreground">{p.sku}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {pp.hsnCode && <span className="mr-1">{pp.hsnCode}</span>}
                      {(pp.gstRate ?? 0) > 0 && <span className="bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full">{pp.gstRate}%</span>}
                      {!pp.hsnCode && !(pp.gstRate) && "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">₹{p.costPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">₹{p.sellingPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn("text-xs font-medium", margin >= 20 ? "text-emerald-400" : margin >= 10 ? "text-amber-400" : "text-muted-foreground")}>
                        {margin > 0 ? `${margin.toFixed(0)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={cn("inline-flex items-center gap-1 font-medium", isLow ? "text-red-400" : "text-emerald-400")}>
                          {isLow && <AlertTriangle className="w-3 h-3" />}
                          {p.stockQuantity} {p.unit}
                        </span>
                        {isLow && <span className="text-xs text-red-400/70">min {p.lowStockThreshold}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-400 hover:text-emerald-300" onClick={() => openAdjust(p)} title="Adjust stock" data-testid={`button-adjust-stock-${p.id}`}>
                          <PackagePlus className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} data-testid={`button-edit-product-${p.id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(p.id)} data-testid={`button-delete-product-${p.id}`}>
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

      {/* Add/Edit product dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Product Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Cable 2.5mm" {...field} data-testid="input-product-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl><Input placeholder="Cables, Breakers..." {...field} data-testid="input-product-category" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="sku" render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU</FormLabel>
                    <FormControl><Input placeholder="CAB-001" {...field} data-testid="input-product-sku" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="costPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost Price (₹)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-product-cost" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="sellingPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Selling Price (₹)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-product-price" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="hsnCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>HSN Code</FormLabel>
                    <FormControl><Input placeholder="e.g. 8544" {...field} data-testid="input-product-hsn" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="gstRate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>GST Rate</FormLabel>
                    <Select value={String(field.value ?? 0)} onValueChange={(v) => field.onChange(parseInt(v))}>
                      <FormControl>
                        <SelectTrigger data-testid="select-product-gst">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="stockQuantity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock Quantity</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-product-stock" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="unit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl><Input placeholder="pcs, roll, m..." {...field} data-testid="input-product-unit" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="lowStockThreshold" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Low Stock Alert At</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-product-threshold" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createProduct.isPending || updateProduct.isPending} data-testid="button-save-product">
                  {editingId ? "Save Changes" : "Add Product"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Quick stock adjust dialog */}
      <Dialog open={!!adjustProduct} onOpenChange={(o) => !o && setAdjustProduct(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock — {adjustProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground mb-3">
            Current stock: <span className="font-semibold text-foreground">{adjustProduct?.stock} {adjustProduct?.unit}</span>
          </div>
          <Form {...adjustForm}>
            <form onSubmit={adjustForm.handleSubmit(onAdjust)} className="space-y-4">
              <FormField control={adjustForm.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity to add (use negative to remove)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="e.g. 50 or -5" autoFocus {...field} data-testid="input-adjust-amount" />
                  </FormControl>
                  <FormMessage />
                  {adjustProduct && adjustForm.watch("amount") !== 0 && (
                    <p className="text-xs text-muted-foreground">
                      New stock: <span className="font-semibold text-foreground">
                        {Math.max(0, adjustProduct.stock + (adjustForm.watch("amount") || 0))} {adjustProduct.unit}
                      </span>
                    </p>
                  )}
                </FormItem>
              )} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAdjustProduct(null)}>Cancel</Button>
                <Button type="submit" disabled={updateProduct.isPending} data-testid="button-confirm-adjust">Update Stock</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* CSV Import Preview Dialog */}
      <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import {csvPreview.length} Products from CSV</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground mb-3">Review before importing. Stock will be set as specified.</div>
          <div className="bg-card border border-card-border rounded-xl overflow-hidden mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-card-border bg-muted/30">
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-right px-3 py-2">Cost ₹</th>
                  <th className="text-right px-3 py-2">Price ₹</th>
                  <th className="text-right px-3 py-2">Stock</th>
                  <th className="text-left px-3 py-2">Unit</th>
                  <th className="text-left px-3 py-2">HSN</th>
                  <th className="text-right px-3 py-2">GST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {csvPreview.slice(0, 20).map((row, i) => (
                  <tr key={i} data-testid={`csv-row-${i}`}>
                    <td className="px-3 py-2 font-medium text-foreground">{row.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.category || "—"}</td>
                    <td className="px-3 py-2 text-right">{row.costPrice?.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{row.sellingPrice?.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{row.stockQuantity}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.unit}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.hsnCode || "—"}</td>
                    <td className="px-3 py-2 text-right">{row.gstRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {csvPreview.length > 20 && <p className="text-xs text-muted-foreground text-center py-2">...and {csvPreview.length - 20} more</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCsvDialogOpen(false)}>Cancel</Button>
            <Button onClick={importCSV} disabled={csvImporting} data-testid="button-confirm-csv-import">
              {csvImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Upload className="w-4 h-4 mr-1.5" />}
              Import All
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
