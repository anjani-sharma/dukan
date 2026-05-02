import { useState } from "react";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Package, Pencil, Trash2, AlertTriangle, PackagePlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
});
type ProductForm = z.infer<typeof productSchema>;

const adjustSchema = z.object({ amount: z.coerce.number().int() });
type AdjustForm = z.infer<typeof adjustSchema>;

export default function Products() {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<{ id: number; name: string; stock: number; unit: string } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: products, isLoading } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const form = useForm<ProductForm>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: "", costPrice: 0, sellingPrice: 0, stockQuantity: 0, lowStockThreshold: 5, unit: "pcs" },
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
    form.reset({ name: "", costPrice: 0, sellingPrice: 0, stockQuantity: 0, lowStockThreshold: 5, unit: "pcs" });
    setDialogOpen(true);
  }

  function openEdit(p: NonNullable<typeof products>[0]) {
    setEditingId(p.id);
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
    });
    setDialogOpen(true);
  }

  function openAdjust(p: NonNullable<typeof products>[0]) {
    setAdjustProduct({ id: p.id, name: p.name, stock: p.stockQuantity, unit: p.unit });
    adjustForm.reset({ amount: 0 });
  }

  async function onSubmit(data: ProductForm) {
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
    };
    if (editingId) {
      await updateProduct.mutateAsync({ id: editingId, data: payload }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) }); toast({ title: "Product updated" }); setDialogOpen(false); },
      });
    } else {
      await createProduct.mutateAsync({ data: payload }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) }); toast({ title: "Product added" }); setDialogOpen(false); },
      });
    }
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
        <Button onClick={openAdd} data-testid="button-add-product">
          <Plus className="w-4 h-4 mr-1.5" /> Add Product
        </Button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-products"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-card border border-card-border rounded-xl animate-pulse" />)}
        </div>
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
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Cost</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Price</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Stock</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filtered.map((p) => {
                const isLow = p.stockQuantity <= p.lowStockThreshold;
                return (
                  <tr key={p.id} className={cn("hover:bg-accent/30 transition-colors", isLow && "bg-red-500/5")} data-testid={`row-product-${p.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.name}</div>
                      {p.sku && <div className="text-xs text-muted-foreground">{p.sku}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">₹{p.costPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">₹{p.sellingPrice.toFixed(2)}</td>
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
        <DialogContent className="max-w-lg">
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
                  <FormItem>
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
                <Button type="submit" disabled={updateProduct.isPending} data-testid="button-confirm-adjust">
                  Update Stock
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
