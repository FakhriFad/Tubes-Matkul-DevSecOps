'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Package } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { itemsApi } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import toast from 'react-hot-toast';

const EMPTY_FORM = { name: '', description: '', price: '', stock: '', image_url: '' };

export default function DashboardPage() {
  const { user } = useAuth();
  const router   = useRouter();
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm]     = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);  // item id being edited
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) { router.push('/auth/login'); return; }
    if (user.role !== 'admin') { router.push('/items'); return; }
    fetchItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchItems = async () => {
    try {
      const res = await itemsApi.list();
      setItems(res.data.items);
    } catch { toast.error('Failed to load items'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.price || !form.stock) { toast.error('Name, price and stock are required'); return; }
    setSubmitting(true);
    try {
      const payload = {
        name:        form.name,
        description: form.description || undefined,
        price:       parseFloat(form.price),
        stock:       parseInt(form.stock),
        image_url:   form.image_url || undefined,
      };

      if (editing) {
        const res = await itemsApi.update(editing, payload);
        setItems((prev) => prev.map((i) => i.id === editing ? res.data.item : i));
        toast.success('Item updated');
        setEditing(null);
      } else {
        const res = await itemsApi.create(payload);
        setItems((prev) => [res.data.item, ...prev]);
        toast.success('Item created');
      }
      setForm(EMPTY_FORM);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (item) => {
    setEditing(item.id);
    setForm({ name: item.name, description: item.description || '', price: item.price, stock: item.stock, image_url: item.image_url || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this item?')) return;
    try {
      await itemsApi.remove(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success('Deleted');
    } catch { toast.error('Delete failed'); }
  };

  return (
    <>
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-12 fade-up">
        <p className="label mb-2">Admin</p>
        <h1 className="font-display text-4xl text-ink mb-10">Dashboard</h1>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Form */}
          <div className="md:col-span-1">
            <div className="card sticky top-24">
              <h2 className="font-display text-xl text-ink mb-5 flex items-center gap-2">
                {editing ? <><span>✏️</span> Edit Item</> : <><Plus size={18} /> New Item</>}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Name *</label>
                  <input className="input-field" type="text" placeholder="Product name" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Description</label>
                  <textarea className="input-field resize-none h-20" placeholder="Optional description"
                    value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Price (Rp) *</label>
                    <input className="input-field" type="number" min="0" step="100" placeholder="0"
                      value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Stock *</label>
                    <input className="input-field" type="number" min="0" placeholder="0"
                      value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="label">Image URL</label>
                  <input className="input-field" type="url" placeholder="https://…"
                    value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={submitting} className="btn-primary flex-1">
                    {submitting ? 'Saving…' : editing ? 'Update' : 'Create'}
                  </button>
                  {editing && (
                    <button type="button" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }} className="btn-outline">
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>

          {/* Items table */}
          <div className="md:col-span-2">
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-cream border-b border-border">
                  <tr>
                    {['Item', 'Price', 'Stock', 'Actions'].map((h) => (
                      <th key={h} className="text-left px-5 py-3 label text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-5 py-4"><div className="h-3 bg-border rounded w-3/4" /></td>
                        <td className="px-5 py-4"><div className="h-3 bg-border rounded w-1/2" /></td>
                        <td className="px-5 py-4"><div className="h-3 bg-border rounded w-1/3" /></td>
                        <td className="px-5 py-4"><div className="h-3 bg-border rounded w-1/2" /></td>
                      </tr>
                    ))
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-12 text-muted">
                        <Package size={32} className="mx-auto mb-2 opacity-30" />
                        No items yet
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className={`hover:bg-cream/60 transition-colors ${editing === item.id ? 'bg-gold/5' : ''}`}>
                        <td className="px-5 py-4">
                          <p className="font-medium text-ink">{item.name}</p>
                          {item.description && <p className="text-xs text-muted mt-0.5 truncate max-w-[180px]">{item.description}</p>}
                        </td>
                        <td className="px-5 py-4 font-mono text-ink">
                          Rp {parseFloat(item.price).toLocaleString('id-ID')}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`badge ${item.stock > 0 ? 'badge-customer' : 'bg-rust/10 text-rust border-rust/30'}`}>
                            {item.stock}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex gap-2">
                            <button onClick={() => handleEdit(item)} className="btn-ghost text-xs px-2 py-1 border border-border hover:border-ink">
                              Edit
                            </button>
                            <button onClick={() => handleDelete(item.id)} className="btn-ghost text-xs px-2 py-1 border border-rust/30 text-rust hover:bg-rust hover:text-cream hover:border-rust transition-colors">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
