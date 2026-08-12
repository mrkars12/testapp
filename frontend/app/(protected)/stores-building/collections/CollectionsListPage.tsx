'use client'

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import api from '@/lib/api'

interface CollectionListItem {
  id: number;
  name: string;
  handle: string;
  description: string | null;
  image_url: string | null;
  product_count: number;
  updated_at?: string;
  created_at?: string;
}

/* ─── Icons ──────────────────────────────────────────────────────────────── */
const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconArrowDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
  </svg>
);
const IconRefresh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconMore = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
const IconEye = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const IconImagePlaceholder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);
const IconSpinner = ({ className = "" }: { className?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
const IconCollectionEmpty = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 7l2.5-4h13L21 7" /><line x1="9" y1="11" x2="15" y2="11" />
  </svg>
);
const IconWarning = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/**
 * Relative time formatter driven by a live "now" tick so the label keeps
 * counting forward (minutes -> hours -> days) purely from the real
 * created/updated timestamp, without needing a manual page refresh.
 *
 * Guards against clock-skew (a timestamp that appears to be in the future,
 * e.g. server/client clock mismatch) by clamping to "Just now" instead of
 * showing a nonsensical negative duration.
 */
function timeAgo(dateStr: string | undefined, now: number): string {
  if (!dateStr) return "—";
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Math.max(0, now - then);
  if (diffMs < 60000) return "Just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years !== 1 ? "s" : ""} ago`;
}

type DeleteTarget = { type: 'single'; id: number; name: string } | { type: 'bulk' } | null;
type MenuPos = { top: number; left: number; openUp: boolean };

export default function CollectionsListPage() {
  const [collections, setCollections] = useState<CollectionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const menuPanelRef = useRef<HTMLDivElement>(null);

  // Live clock tick — re-renders every 15s so "X minutes ago" stays accurate
  // to the real wall-clock time regardless of when the tab was opened, and
  // turns over from "Just now" to "1 minute ago" quickly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const fetchCollections = () => api.get('/stores/collections').then(({ data }) => setCollections(data));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCollections().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchCollections(); } finally { setRefreshing(false); }
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return collections;
    const q = query.trim().toLowerCase();
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, query]);

  const allChecked = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  const selectAllOnPage = () => setSelected(new Set(filtered.map((c) => c.id)));
  const unselectAll = () => setSelected(new Set());
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* ─── 3-dot menu: fixed-position + robust click-outside ─────────────────
     Positioned with `position: fixed` from the button's real screen
     coordinates (not `absolute` inside the row), so it can never get
     clipped by an ancestor's overflow/z-index, and it flips upward when
     there isn't enough room below the viewport. Closing/opening is driven
     by a single `mousedown` listener on `document`, and the trigger button
     is explicitly excluded from that listener via `data-menu-trigger`, so
     a single click always opens or closes it — no more double-click. */
  const toggleMenu = (id: number, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openMenuId === id) {
      setOpenMenuId(null);
      setMenuPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 132;
    const menuWidth = 176;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + 12;
    setMenuPos({
      top: openUp ? rect.top - menuHeight - 6 : rect.bottom + 6,
      left: Math.max(8, rect.right - menuWidth),
      openUp,
    });
    setOpenMenuId(id);
  };

  const closeMenu = () => { setOpenMenuId(null); setMenuPos(null); };

  useEffect(() => {
    if (openMenuId === null) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-menu-trigger]')) return; // let the button's own onClick handle it
      if (menuPanelRef.current && menuPanelRef.current.contains(target)) return;
      closeMenu();
    };
    const handleScrollOrResize = () => closeMenu();
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [openMenuId]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'single') {
        await api.delete(`/stores/collections/${deleteTarget.id}`);
        setCollections((prev) => prev.filter((c) => c.id !== deleteTarget.id));
        setSelected((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
      } else {
        const ids = Array.from(selected);
        await Promise.all(ids.map((id) => api.delete(`/stores/collections/${id}`)));
        setCollections((prev) => prev.filter((c) => !selected.has(c.id)));
        setSelected(new Set());
      }
      setDeleteTarget(null);
    } catch {
      alert('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const openMenuCollection = openMenuId !== null ? collections.find((c) => c.id === openMenuId) : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 font-sans sm:px-6">
      {/* Horizontal entrance animation for rows that newly appear while filtering.
          Rows that stay visible across keystrokes are NOT remounted (same key),
          so this only plays for genuinely new matches — no vertical collapse,
          no "closing from the bottom" motion. */}
      <style>{`
        @keyframes collectionRowIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 text-white">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
              <circle cx="6.5" cy="6.5" r="1" fill="currentColor" />
            </svg>
          </span>
          <h1 className="text-[19px] font-bold tracking-tight text-gray-900">Collections</h1>
        </div>
        <Link
          href="/stores-building/collections/new"
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-black active:bg-gray-800"
        >
          <IconPlus /> Add collection
        </Link>
      </div>

      {/* Card container — no overflow-hidden here so row dropdown menus never get clipped */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-6 rounded-t-xl border-b border-gray-200 bg-gray-50/60 px-4 py-3.5">
          <div className="relative max-w-sm flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <IconSearch />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث باسم الكولكشن..."
              dir="auto"
              className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-8 pr-3 text-[13px] text-gray-800 shadow-sm outline-none transition-shadow placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
            />
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50"
          >
            <span className={refreshing ? "animate-spin" : ""}><IconRefresh /></span>
          </button>
        </div>

        {/* Bulk selection bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked
                onChange={unselectAll}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-gray-900 focus:ring-gray-400"
              />
              <span className="text-[13px] font-semibold text-gray-800">
                {selected.size} selected
              </span>
            </label>

            <button
              onClick={() => setDeleteTarget({ type: 'bulk' })}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
              <IconTrash /> Delete collection{selected.size > 1 ? "s" : ""}
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
            <IconSpinner className="text-gray-500" />
            <span className="text-[13px]">Loading...</span>
          </div>
        ) : collections.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <IconCollectionEmpty />
            </span>
            <div>
              <p className="mb-1 text-[15px] font-semibold text-gray-900">No collections yet</p>
              <p className="text-[13px] text-gray-500">Group your products into collections so customers can browse them easily.</p>
            </div>
            <Link
              href="/stores-building/collections/new"
              className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-black"
            >
              <IconPlus /> Create collection
            </Link>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden grid-cols-[36px_1fr_140px_140px_44px] items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 sm:grid">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => (allChecked ? unselectAll() : selectAllOnPage())}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-gray-900 focus:ring-gray-400"
              />
              <span className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Title</span>
              <span className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Products</span>
              <span className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                Updated <IconArrowDown />
              </span>
              <span />
            </div>

            {/* Rows — filtered for real (non-matches are simply not rendered).
                Rows that are still visible keep their React key, so they never
                replay the entrance animation; only genuinely new matches fade
                in horizontally. */}
            <div className="divide-y divide-gray-100">
              {filtered.map((c, idx) => {
                const isSelected = selected.has(c.id);
                const isLast = idx === filtered.length - 1;
                return (
                  <div
                    key={c.id}
                    style={{ animation: "collectionRowIn 0.35s ease-out" }}
                    className={`group relative grid grid-cols-[36px_1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[36px_1fr_140px_140px_44px] ${
                      isSelected ? "bg-gray-50" : "hover:bg-gray-50/70"
                    } ${isLast ? "rounded-b-xl" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleOne(c.id)}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                    />

                    <Link href={`/stores-building/collections/${c.id}/edit`} className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50 text-gray-300">
                        {c.image_url ? (
                          <img src={c.image_url} alt={c.name} className="h-full w-full object-cover" />
                        ) : (
                          <IconImagePlaceholder />
                        )}
                      </div>
                      <span className="truncate text-[13.5px] font-semibold text-blue-600 group-hover:text-blue-700">
                        {c.name}
                      </span>
                    </Link>

                    <span className="hidden text-[13px] text-gray-600 sm:block">
                      {c.product_count} <span className="text-gray-400">product{c.product_count !== 1 ? "s" : ""}</span>
                    </span>

                    <span className="hidden text-[13px] text-gray-500 sm:block">
                      {timeAgo(c.updated_at || c.created_at, now)}
                    </span>

                    <div className="relative flex justify-end">
                      <button
                        data-menu-trigger="true"
                        onClick={(e) => toggleMenu(c.id, e)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                      >
                        <IconMore />
                      </button>
                    </div>

                    {/* Mobile-only meta row */}
                    <div className="col-span-3 -mt-1 flex items-center gap-3 pl-[48px] text-[12px] text-gray-500 sm:hidden">
                      <span>{c.product_count} product{c.product_count !== 1 ? "s" : ""}</span>
                      <span>·</span>
                      <span>{timeAgo(c.updated_at || c.created_at, now)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* "No results" — shows immediately, no artificial delay */}
            {query.trim() && filtered.length === 0 && (
              <div
                style={{ animation: "collectionRowIn 0.7s ease-out" }}
                className="flex flex-col items-center gap-2 px-6 py-16 text-center"
              >
                <p className="text-[14px] font-semibold text-gray-800">لا توجد نتائج لـ "{query}"</p>
                <p className="text-[13px] text-gray-500">جرّب اسم كولكشن مختلف.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Single fixed-position dropdown for whichever row's 3-dot menu is open.
          Rendered once (not per-row) and positioned from real button coordinates,
          so it can never be clipped and always opens/closes on a single click. */}
      {openMenuId !== null && menuPos && openMenuCollection && (
        <div
          ref={menuPanelRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          className="z-[9999] w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          <a
            href={`/collections/${openMenuCollection.handle}`}
            target="_blank"
            rel="noreferrer"
            onClick={closeMenu}
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <IconEye /> View
          </a>
          <Link
            href={`/stores-building/collections/${openMenuCollection.id}/edit`}
            onClick={closeMenu}
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <IconEdit /> Edit
          </Link>
          <button
            onClick={() => {
              const target = openMenuCollection;
              closeMenu();
              setDeleteTarget({ type: 'single', id: target.id, name: target.name });
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-50"
          >
            <IconTrash /> Delete
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setDeleteTarget(null); }}
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                <IconWarning />
              </span>
              <div>
                <h3 className="text-[15px] font-bold text-gray-900">
                  {deleteTarget.type === 'bulk'
                    ? `Delete ${selected.size} collection${selected.size > 1 ? "s" : ""}?`
                    : "Delete collection?"}
                </h3>
                <p className="mt-1 text-[13px] text-gray-500">This can't be undone.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting && <IconSpinner />}
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}