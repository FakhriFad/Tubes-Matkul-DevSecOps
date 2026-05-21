'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, ShieldOff, Key } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { authApi } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';

export default function ProfilePage() {
  const { user, updateUser, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [mfaSetup, setMfaSetup] = useState(null);    // { secret, otpauth }
  const [totp, setTotp]   = useState('');
  const [loading, setLoading] = useState(true);
  const [step, setStep]   = useState('idle'); // idle | setup | disable

  useEffect(() => {
    if (!user) { router.push('/auth/login'); return; }
    authApi.me().then((r) => setProfile(r.data)).catch(() => {}).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMfaSetup = async () => {
    try {
      const res = await authApi.mfaSetup();
      setMfaSetup(res.data);
      setStep('setup');
    } catch {
      toast.error('MFA setup failed');
    }
  };

  const handleMfaVerify = async (e) => {
    e.preventDefault();
    try {
      await authApi.mfaVerify(totp);
      toast.success('MFA enabled');
      setProfile((p) => ({ ...p, mfa_enabled: true }));
      updateUser({ mfa_enabled: true });
      setStep('idle');
      setTotp('');
      setMfaSetup(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid code');
    }
  };

  const handleMfaDisable = async (e) => {
    e.preventDefault();
    try {
      await authApi.mfaDisable(totp);
      toast.success('MFA disabled');
      setProfile((p) => ({ ...p, mfa_enabled: false }));
      updateUser({ mfa_enabled: false });
      setStep('idle');
      setTotp('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid code');
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="max-w-2xl mx-auto px-6 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-border rounded w-1/3" />
            <div className="card h-40" />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-12 fade-up">
        <p className="label mb-2">Account</p>
        <h1 className="font-display text-4xl text-ink mb-10">Profile</h1>

        {/* Profile info */}
        <div className="card mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="font-medium text-ink text-lg">{profile?.full_name}</p>
              <p className="text-muted text-sm">{profile?.email}</p>
            </div>
            <span className={`badge ${profile?.role === 'admin' ? 'badge-admin' : 'badge-customer'}`}>
              {profile?.role}
            </span>
          </div>
          <p className="text-xs text-muted font-mono">
            Member since {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
          </p>
        </div>

        {/* MFA Card */}
        <div className="card mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${profile?.mfa_enabled ? 'bg-sage/20' : 'bg-rust/10'}`}>
              {profile?.mfa_enabled ? <Shield size={16} className="text-sage" /> : <ShieldOff size={16} className="text-rust" />}
            </div>
            <div>
              <p className="font-medium text-sm text-ink">Two-Factor Authentication</p>
              <p className="text-xs text-muted">{profile?.mfa_enabled ? 'Enabled — your account is protected' : 'Disabled — we recommend enabling this'}</p>
            </div>
          </div>

          {step === 'idle' && (
            <button
              onClick={() => profile?.mfa_enabled ? setStep('disable') : handleMfaSetup()}
              className={profile?.mfa_enabled ? 'btn-outline text-sm border-rust text-rust hover:bg-rust hover:text-cream' : 'btn-primary text-sm'}
            >
              {profile?.mfa_enabled ? 'Disable MFA' : 'Enable MFA'}
            </button>
          )}

          {step === 'setup' && mfaSetup && (
            <div className="space-y-4 border-t border-border pt-4">
              <p className="text-sm text-muted">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.).</p>
              <div className="flex justify-center p-4 bg-white border border-border inline-block">
                <QRCodeSVG value={mfaSetup.otpauth} size={180} />
              </div>
              <div>
                <p className="label">Manual entry key</p>
                <p className="font-mono text-xs bg-cream border border-border px-3 py-2 break-all">{mfaSetup.secret}</p>
              </div>
              <form onSubmit={handleMfaVerify} className="space-y-3">
                <div>
                  <label className="label">Enter the 6-digit code to confirm</label>
                  <input
                    className="input-field font-mono text-xl tracking-[0.4em] text-center"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </div>
                <div className="flex gap-3">
                  <button type="submit" disabled={totp.length !== 6} className="btn-primary flex-1">Activate MFA</button>
                  <button type="button" onClick={() => { setStep('idle'); setMfaSetup(null); setTotp(''); }} className="btn-outline">Cancel</button>
                </div>
              </form>
            </div>
          )}

          {step === 'disable' && (
            <form onSubmit={handleMfaDisable} className="space-y-3 border-t border-border pt-4">
              <p className="text-sm text-muted">Enter your current authenticator code to disable MFA.</p>
              <input
                className="input-field font-mono text-xl tracking-[0.4em] text-center"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
              <div className="flex gap-3">
                <button type="submit" disabled={totp.length !== 6} className="btn-primary flex-1 bg-rust hover:bg-ink">Confirm Disable</button>
                <button type="button" onClick={() => { setStep('idle'); setTotp(''); }} className="btn-outline">Cancel</button>
              </div>
            </form>
          )}
        </div>

        {/* Danger zone */}
        <div className="border border-rust/30 rounded p-5">
          <p className="label text-rust mb-3">Danger zone</p>
          <button
            onClick={async () => { await logout(); router.push('/'); }}
            className="btn-outline border-rust text-rust hover:bg-rust hover:text-cream text-sm"
          >
            Sign out of all sessions
          </button>
        </div>
      </main>
    </>
  );
}
