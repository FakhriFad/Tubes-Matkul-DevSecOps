'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Filter } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import toast from 'react-hot-toast';

// Action badge colours
const ACTION_COLOURS = {
  REGISTER:          'bg-sage/10 text-sage border-sage/30',
  LOGIN:             'bg-sage/10 text-sage border-sage/30',
  LOGOUT:            'bg-muted/10 text-muted border-muted/30',
  LOGIN_FAILED:      'bg-rust/10 text-rust border-rust/30',
  LOGIN_MFA_FAILED:  'bg-rust/10 text-rust border-rust/30',
  MFA_ENABLED:       'bg-gold/10 text-gold border-gold/30',
  MFA_DISABLED:      'bg-rust/10 text-rust border-rust/30',
  CREATE_ITEM:       'bg-sage/10 text-sage border-sage/30',
  UPDATE_ITEM:       'bg-gold/10 text-gold border-gold/30',
  DELETE_ITEM:       'bg-rust/10 text-rust border-rust/30',
  ADD_TO_CART:       'bg-sage/10 text-sage border-sage/30',
  UPDATE_CART_ITEM:  'bg-gold/10 text-gold border-gold/30',
  REMOVE_FROM_CART:  'bg-rust/10 text-rust border-rust/30',
  CHECKOUT:          'bg-gold/10 text-gold border-gold/30',
};

// eslint-disable-next-line security/detect-object-injection -- ACTION_COLOURS is
// a const literal defined above; `a` is an action string from our own API response.
const actionClass = (a) =>
  Object.prototype.hasOwnProperty.call(ACTION_COLOURS, a)
    ? ACTION_COLOURS[a] // eslint-disable-line security/detect-object-injection
    : 'bg-muted/10 text-muted border-muted/30';

const ALL_ACTIONS = Object.keys(ACTION_COLOURS);

export default function AuditLogPage() {
  const { user }  = useAuth();
  const router    = useRouter();

  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');    // action filter
  const [page, setPage]       = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const PER_PAGE = 30;

  useEffect(() => {
    if (!user) { router.push('/auth/login'); return; }
    if (user.role !== 'admin') { router.push('/items'); return; }
  }, [user, router]);

  const fetchLogs = useCallback(async (pageNum = 1, actionFilter = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit:  String(PER_PAGE),
        offset: String((pageNum - 1) * PER_PAGE),
      });
      if (actionFilter) params.set('action', actionFilter);

      const res = await api.get(`/audit-logs?${params}`);
      const rows = res.data.logs ?? [];
      setLogs(rows);
      setHasMore(rows.length === PER_PAGE);
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') fetchLogs(page, filter);
  }, [user, page, filter, fetchLogs]);

  const handleFilter = (action) => {
    setFilter(action);
    setPage(1);
  };

  const handleRefresh = () => {
    fetchLogs(page, filter);
    toast.success('Refreshed');
  };

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-12 fade-up">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="label mb-2">Admin</p>
            <h1 className="font-display text-4xl text-ink">Audit Logs</h1>
          </div>
          <button onClick={handleRefresh} className="btn-outline flex items-center gap-2 text-sm">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Action filter pills */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => handleFilter('')}
            className={`badge cursor-pointer transition-colors ${filter === '' ? 'bg-ink text-cream border-ink' : 'bg-white text-muted border-border hover:border-ink hover:text-ink'}`}
          >
            All
          </button>
          {ALL_ACTIONS.map((a) => (
            <button
              key={a}
              onClick={() => handleFilter(a)}
              className={`badge cursor-pointer transition-colors ${filter === a ? actionClass(a) + ' font-bold' : 'bg-white text-muted border-border hover:text-ink hover:border-ink'}`}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream border-b border-border">
                <tr>
                  {['Time', 'Action', 'User', 'Entity', 'IP', 'Details'].map((h) => (
                    <th key={h} className="text-left px-5 py-3 label text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-5 py-3">
                          <div className="h-3 bg-border rounded" style={{ width: `${50 + Math.random() * 40}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-muted">
                      <Filter size={32} className="mx-auto mb-3 opacity-30" />
                      No log entries found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-cream/50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-muted whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`badge text-xs font-mono ${actionClass(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-ink max-w-[140px] truncate" title={log.user_id ?? '—'}>
                        {log.user_id ? log.user_id.slice(0, 8) + '…' : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-5 py-3 text-xs text-ink">
                        {log.entity ? (
                          <span>
                            <span className="text-muted">{log.entity}</span>
                            {log.entity_id && (
                              <span className="font-mono text-muted ml-1" title={log.entity_id}>
                                /{log.entity_id.slice(0, 6)}…
                              </span>
                            )}
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted whitespace-nowrap">
                        {log.ip_address ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        {log.metadata && Object.keys(log.metadata).length > 0 ? (
                          <details className="cursor-pointer">
                            <summary className="text-xs text-muted hover:text-ink list-none underline underline-offset-2">
                              view
                            </summary>
                            <pre className="mt-1 text-xs bg-cream p-2 rounded border border-border max-w-xs overflow-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </details>
                        ) : <span className="text-muted text-xs">—</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {!loading && (logs.length > 0 || page > 1) && (
          <div className="flex items-center justify-between mt-6 text-sm">
            <span className="text-muted">
              Page {page} · showing {logs.length} entries
            </span>
            <div className="flex gap-3">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="btn-outline text-sm py-2 px-4 disabled:opacity-30"
              >
                ← Prev
              </button>
              <button
                disabled={!hasMore}
                onClick={() => setPage((p) => p + 1)}
                className="btn-outline text-sm py-2 px-4 disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
