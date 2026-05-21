'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShoppingCart, LogOut, User, Package, Shield } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import toast from 'react-hot-toast';

export default function Navbar({ cartCount = 0 }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    router.push('/auth/login');
  };

  return (
    <header className="sticky top-0 z-50 bg-ink text-cream border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="font-display text-xl tracking-tight hover:text-gold transition-colors">
          EcomShop
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-8 text-sm">
          <Link href="/items" className="text-cream/70 hover:text-cream transition-colors tracking-wide">
            Shop
          </Link>
          {user?.role === 'admin' && (
            <>
              <Link href="/dashboard" className="text-gold/80 hover:text-gold transition-colors flex items-center gap-1.5">
                <Shield size={13} />
                <span>Admin</span>
              </Link>
              <Link href="/dashboard/audit-logs" className="text-gold/60 hover:text-gold transition-colors text-xs tracking-wide">
                Audit Logs
              </Link>
            </>
          )}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link
                href="/cart"
                className="relative flex items-center gap-1.5 text-cream/70 hover:text-cream transition-colors text-sm"
              >
                <ShoppingCart size={18} />
                {cartCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-rust text-cream text-xs w-4 h-4 rounded-full flex items-center justify-center font-mono">
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </Link>

              <Link
                href="/profile"
                className="flex items-center gap-2 text-cream/70 hover:text-cream transition-colors text-sm"
              >
                <User size={16} />
                <span className="hidden md:block">{user.full_name?.split(' ')[0]}</span>
              </Link>

              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-cream/50 hover:text-rust transition-colors text-sm"
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/auth/login" className="text-cream/70 hover:text-cream text-sm transition-colors">
                Login
              </Link>
              <Link href="/auth/register" className="bg-cream text-ink px-4 py-1.5 text-sm font-medium hover:bg-gold transition-colors">
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
