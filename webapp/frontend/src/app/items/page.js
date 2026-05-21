'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ShoppingCart, Package } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { itemsApi, cartApi } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import toast from 'react-hot-toast';

function ItemCard({ item, onAddToCart, isAdmin, onDelete }) {
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    await onAddToCart(item.id);
    setAdding(false);
  };

  return (
    <div className="card group hover:-translate-y-1 transition-all duration-200 hover:shadow-lg flex flex-col">
      <div className="relative aspect-square bg-cream rounded-sm mb-4 overflow-hidden flex items-center justify-center">
        {item.image_url ? (
          <Image src={item.image_url} alt={item.name} fill className="object-cover" sizes="(max-width: 768px) 50vw, 25vw" />
        ) : (
          <Package size={48} className="text-border" />
        )}
      </div>

      <div className="flex-1">
        <p className="font-medium text-ink mb-1 leading-snug">{item.name}</p>
        {item.description && (
          <p className="text-xs text-muted mb-3 line-clamp-2">{item.description}</p>
        )}
        <div className="flex items-center justify-between mb-3">
          <span className="font-display text-lg text-ink">
            Rp {parseFloat(item.price).toLocaleString('id-ID')}
          </span>
          <span className={`badge ${item.stock > 0 ? 'badge-customer' : 'bg-muted/10 text-muted border-muted/30'}`}>
            {item.stock > 0 ? `${item.stock} left` : 'Out of stock'}
          </span>
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleAdd}
          disabled={adding || item.stock === 0}
          className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5"
        >
          <ShoppingCart size={15} />
          {adding ? 'Adding…' : 'Add to cart'}
        </button>
        {isAdmin && (
          <button
            onClick={() => onDelete(item.id)}
            className="btn-outline px-3 py-2.5 text-rust border-rust hover:bg-rust hover:text-cream"
            title="Delete"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export default function ItemsPage() {
  const { user } = useAuth();
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    fetchItems();
    if (user) fetchCartCount();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchItems = async () => {
    try {
      const res = await itemsApi.list();
      setItems(res.data.items);
    } catch {
      toast.error('Failed to load items');
    } finally {
      setLoading(false);
    }
  };

  const fetchCartCount = async () => {
    try {
      const res = await cartApi.get();
      setCartCount(res.data.items?.length || 0);
    } catch { /* silent */ }
  };

  const handleAddToCart = async (itemId) => {
    if (!user) { toast.error('Please log in to add items'); return; }
    try {
      await cartApi.addItem(itemId, 1);
      setCartCount((c) => c + 1);
      toast.success('Added to cart');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add item');
    }
  };

  const handleDelete = async (itemId) => {
    if (!confirm('Delete this item?')) return;
    try {
      await itemsApi.remove(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      toast.success('Item deleted');
    } catch {
      toast.error('Failed to delete item');
    }
  };

  return (
    <>
      <Navbar cartCount={cartCount} />
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-end justify-between mb-10 fade-up">
          <div>
            <p className="label">Catalogue</p>
            <h1 className="font-display text-4xl text-ink">
              All Items
              <span className="text-muted font-sans text-xl ml-3">({items.length})</span>
            </h1>
          </div>
          {user?.role === 'admin' && (
            <a href="/dashboard" className="btn-outline text-sm">
              + Add item
            </a>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="aspect-square bg-border rounded-sm mb-4" />
                <div className="h-4 bg-border rounded mb-2" />
                <div className="h-3 bg-border/60 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-24 text-muted">
            <Package size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-display text-2xl">No items yet</p>
            {user?.role === 'admin' && <p className="text-sm mt-2">Add some from the admin dashboard.</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 stagger">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onAddToCart={handleAddToCart}
                isAdmin={user?.role === 'admin'}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
