'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Trash2, Plus, Minus, ShoppingBag } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { cartApi } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import toast from 'react-hot-toast';

export default function CartPage() {
  const { user }   = useAuth();
  const router     = useRouter();
  const [cart, setCart]     = useState(null);
  const [items, setItems]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!user) { router.push('/auth/login'); return; }
    fetchCart();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchCart = async () => {
    try {
      const res = await cartApi.get();
      setCart(res.data.cart);
      setItems(res.data.items);
    } catch {
      toast.error('Failed to load cart');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateQty = async (id, qty) => {
    try {
      await cartApi.updateItem(id, qty);
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, quantity: qty } : i));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    }
  };

  const handleRemove = async (id) => {
    try {
      await cartApi.removeItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success('Removed');
    } catch {
      toast.error('Remove failed');
    }
  };

  const handleCheckout = async () => {
    setChecking(true);
    try {
      await cartApi.checkout();
      toast.success('Order placed!');
      setItems([]);
      setCart(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Checkout failed');
    } finally {
      setChecking(false);
    }
  };

  const total = items.reduce((s, i) => s + i.quantity * parseFloat(i.unit_price), 0);

  return (
    <>
      <Navbar cartCount={items.length} />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="fade-up">
          <p className="label mb-2">Your</p>
          <h1 className="font-display text-4xl text-ink mb-10">Shopping Cart</h1>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="card animate-pulse flex gap-4">
                  <div className="w-20 h-20 bg-border rounded-sm" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-border rounded w-1/2" />
                    <div className="h-3 bg-border/60 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-24">
              <ShoppingBag size={48} className="mx-auto text-border mb-4" />
              <p className="font-display text-2xl text-ink mb-2">Your cart is empty</p>
              <p className="text-muted text-sm mb-8">Add some items from the shop to get started.</p>
              <Link href="/items" className="btn-primary">Browse Shop</Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-8">
              {/* Items list */}
              <div className="md:col-span-2 space-y-3 stagger">
                {items.map((item) => (
                  <div key={item.id} className="card flex gap-4 items-center">
                    <div className="relative w-16 h-16 bg-cream rounded-sm flex-shrink-0 flex items-center justify-center overflow-hidden">
                      {item.image_url
                        ? <Image src={item.image_url} alt={item.name} fill className="object-cover" sizes="64px" />
                        : <ShoppingBag size={20} className="text-border" />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink text-sm truncate">{item.name}</p>
                      <p className="text-xs text-muted font-mono">
                        Rp {parseFloat(item.unit_price).toLocaleString('id-ID')} each
                      </p>
                    </div>

                    {/* Quantity controls */}
                    <div className="flex items-center gap-2 border border-border">
                      <button
                        onClick={() => item.quantity > 1 ? handleUpdateQty(item.id, item.quantity - 1) : handleRemove(item.id)}
                        className="w-8 h-8 flex items-center justify-center hover:bg-cream transition-colors text-ink"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center font-mono text-sm">{item.quantity}</span>
                      <button
                        onClick={() => handleUpdateQty(item.id, item.quantity + 1)}
                        className="w-8 h-8 flex items-center justify-center hover:bg-cream transition-colors text-ink"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <p className="text-sm font-medium w-24 text-right font-mono">
                      Rp {(item.quantity * parseFloat(item.unit_price)).toLocaleString('id-ID')}
                    </p>

                    <button
                      onClick={() => handleRemove(item.id)}
                      className="text-muted hover:text-rust transition-colors ml-1"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="card self-start sticky top-24 fade-up">
                <h2 className="font-display text-xl text-ink mb-4">Summary</h2>
                <div className="space-y-2 text-sm mb-4">
                  <div className="flex justify-between text-muted">
                    <span>Items ({items.length})</span>
                    <span className="font-mono">Rp {total.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>Shipping</span>
                    <span className="text-sage font-mono">Free</span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between font-medium text-ink">
                    <span>Total</span>
                    <span className="font-mono font-display text-lg">
                      Rp {total.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleCheckout}
                  disabled={checking}
                  className="btn-primary w-full"
                >
                  {checking ? 'Processing…' : 'Place Order'}
                </button>
                <Link href="/items" className="btn-ghost w-full text-center block mt-3 text-sm">
                  ← Continue shopping
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
