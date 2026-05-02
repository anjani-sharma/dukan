import { useState } from "react";
import { useListCustomers, useCreateCustomer, useUpdateCustomer, useDeleteCustomer, useGetCustomer, useRecordPayment, useListCustomerPayments, getListCustomersQueryKey, getGetCustomerQueryKey, getListCustomerPaymentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users, CreditCard, ChevronRight, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
});
const paymentSchema = z.object({
  amount: z.coerce.number().positive("Amount must be positive"),
  notes: z.string().optional(),
});
type CustomerForm = z.infer<typeof customerSchema>;
type PaymentForm = z.infer<typeof paymentSchema>;

function CustomerDetail({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: customer, isLoading } = useGetCustomer(customerId, { query: { queryKey: getGetCustomerQueryKey(customerId) } });
  const { data: payments } = useListCustomerPayments(customerId, { query: { queryKey: getListCustomerPaymentsQueryKey(customerId) } });
  const recordPayment = useRecordPayment();
  const [paymentOpen, setPaymentOpen] = useState(false);

  const payForm = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: 0, notes: "" },
  });

  async function onPayment(data: PaymentForm) {
    await recordPayment.mutateAsync({ customerId, data: { amount: data.amount, notes: data.notes || null } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });
        qc.invalidateQueries({ queryKey: getListCustomerPaymentsQueryKey(customerId) });
        qc.invalidateQueries({ queryKey: getListCustomersQueryKey({}) });
        toast({ title: "Payment recorded" });
        setPaymentOpen(false);
        payForm.reset();
      },
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-end">
      <div className="w-full max-w-xl h-full bg-card border-l border-card-border overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-card-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{customer?.name ?? "Customer"}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : customer ? (
          <div className="p-6 space-y-6">
            {/* Balance summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted rounded-xl p-4 text-center">
                <div className="text-xs text-muted-foreground mb-1">Total Credit</div>
                <div className="text-lg font-bold text-foreground">Rs {customer.totalCredit.toFixed(0)}</div>
              </div>
              <div className="bg-muted rounded-xl p-4 text-center">
                <div className="text-xs text-muted-foreground mb-1">Paid</div>
                <div className="text-lg font-bold text-emerald-400">Rs {customer.totalPaid.toFixed(0)}</div>
              </div>
              <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-4 text-center">
                <div className="text-xs text-amber-400/70 mb-1">Outstanding</div>
                <div className="text-lg font-bold text-amber-400">Rs {customer.outstandingBalance.toFixed(0)}</div>
              </div>
            </div>

            {customer.outstandingBalance > 0 && (
              <Button className="w-full" onClick={() => setPaymentOpen(true)} data-testid="button-record-payment">
                <CreditCard className="w-4 h-4 mr-2" /> Record Payment
              </Button>
            )}

            {/* Contact info */}
            <div className="space-y-1 text-sm">
              {customer.phone && <div className="flex gap-2"><span className="text-muted-foreground w-16">Phone</span><span className="text-foreground">{customer.phone}</span></div>}
              {customer.email && <div className="flex gap-2"><span className="text-muted-foreground w-16">Email</span><span className="text-foreground">{customer.email}</span></div>}
              {customer.address && <div className="flex gap-2"><span className="text-muted-foreground w-16">Address</span><span className="text-foreground">{customer.address}</span></div>}
            </div>

            {/* Payment history */}
            {payments && payments.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">Payments Received</h3>
                <div className="space-y-2">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3" data-testid={`payment-${p.id}`}>
                      <div>
                        <div className="text-sm font-medium text-emerald-400">Rs {p.amount.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(p.createdAt), "MMM d, yyyy")}</div>
                      </div>
                      {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sales history */}
            {customer.sales && customer.sales.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">Sales History</h3>
                <div className="space-y-2">
                  {customer.sales.map((s) => (
                    <div key={s.id} className="bg-muted/50 rounded-lg px-4 py-3" data-testid={`sale-history-${s.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium text-foreground">Rs {s.totalAmount.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(s.createdAt), "MMM d, yyyy")}</div>
                      </div>
                      {s.creditAmount > 0 && (
                        <div className="text-xs text-amber-400">Outstanding: Rs {s.creditAmount.toFixed(2)}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment — {customer?.name}</DialogTitle></DialogHeader>
          <Form {...payForm}>
            <form onSubmit={payForm.handleSubmit(onPayment)} className="space-y-4">
              <FormField control={payForm.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (Rs)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} data-testid="input-payment-amount" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={payForm.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl><Input placeholder="e.g. Cash payment" {...field} data-testid="input-payment-notes" /></FormControl>
                </FormItem>
              )} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setPaymentOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={recordPayment.isPending} data-testid="button-submit-payment">Save Payment</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Customers() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: customers, isLoading } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  const createCustomer = useCreateCustomer();

  const form = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: "", phone: "", email: "", address: "" },
  });

  const filtered = (customers ?? []).filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone ?? "").includes(search)
  );

  async function onSubmit(data: CustomerForm) {
    await createCustomer.mutateAsync({ data: { name: data.name, phone: data.phone || null, email: data.email || null, address: data.address || null } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCustomersQueryKey({}) });
        toast({ title: "Customer added" });
        setDialogOpen(false);
        form.reset();
      },
    });
  }

  return (
    <div className="p-6 space-y-5">
      {selectedId && <CustomerDetail customerId={selectedId} onClose={() => setSelectedId(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{customers?.length ?? 0} customers</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-add-customer">
          <Plus className="w-4 h-4 mr-1.5" /> Add Customer
        </Button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-customers" />
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-card border border-card-border rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card border border-card-border rounded-xl">
          <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No customers yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <button key={c.id} onClick={() => setSelectedId(c.id)} className="w-full text-left bg-card border border-card-border rounded-xl px-5 py-4 hover:border-primary/30 hover:bg-accent/30 transition-all flex items-center justify-between group" data-testid={`card-customer-${c.id}`}>
              <div>
                <div className="font-medium text-foreground">{c.name}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{c.phone ?? "No phone"}</div>
              </div>
              <div className="flex items-center gap-4">
                {c.outstandingBalance > 0 ? (
                  <div className="text-right">
                    <div className="text-sm font-bold text-amber-400">Rs {c.outstandingBalance.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">outstanding</div>
                  </div>
                ) : (
                  <div className="text-xs text-emerald-400 font-medium">Settled</div>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="Customer name" {...field} data-testid="input-customer-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="+971 50 123 4567" {...field} data-testid="input-customer-phone" /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input placeholder="email@example.com" {...field} data-testid="input-customer-email" /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="City, Country" {...field} data-testid="input-customer-address" /></FormControl></FormItem>
              )} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createCustomer.isPending} data-testid="button-save-customer">Add Customer</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
