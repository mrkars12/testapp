'use client'

import { useState, useEffect, useRef } from "react";
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { uploadToR2, confirmUpload } from '@/lib/uploads';
import { RichTextEditor } from './RichTextEditor'; // ← adjust the path based on where ProductForm.tsx lives in your project

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface CollectionProduct {
  id: string;
  title: string;
  image_url: string | null;
}

interface PickableProduct {
  id: string;
  title: string;
  image_url: string | null;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const SEO_TITLE_MAX = 70;
const SEO_DESC_MAX = 320;
const SEO_PREVIEW_LEN = 160;

function toHandle(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, "")
    .replace(/[^a-z0-9\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/* ─── Icons ──────────────────────────────────────────────────────────────── */
const IconGrid = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
const IconList = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
const IconImagePlaceholder = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
);
const IconSpinner = ({ className = "" }: { className?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
);
const IconX = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const IconChevron = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
);
const IconAlertTriangle = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IconArrowLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);
const IconEye = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconDragHandle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" />
    <circle cx="15" cy="6" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="18" r="1.5" />
  </svg>
);

/* ─── Product picker modal ───────────────────────────────────────────────── */
function ProductPickerModal({ initialSelected, onCancel, onDone }: {
  initialSelected: CollectionProduct[];
  onCancel: () => void;
  onDone: (products: CollectionProduct[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [allProducts, setAllProducts] = useState<PickableProduct[]>([]);
  const [selected, setSelected] = useState<Map<string, CollectionProduct>>(
    new Map(initialSelected.map((p) => [p.id, p]))
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/stores/products', { params: { search: query || undefined, limit: 50 } })
        .then(({ data }) => {
          if (cancelled) return;
          const list = (data.products || data.items || data || []) as any[];
          setAllProducts(list.map((p) => ({
            id: p.id.toString(),
            title: p.title,
            image_url: p.images?.[0]?.url || null,
          })));
        })
        .catch(() => { if (!cancelled) setAllProducts([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const toggle = (p: PickableProduct) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, { id: p.id, title: p.title, image_url: p.image_url });
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900">Select products to include</h3>
          <button onClick={onCancel} className="text-gray-400 transition-colors hover:text-gray-700">
            <IconX />
          </button>
        </div>

        {/* Search row */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <span className="text-gray-400"><IconSearch /></span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              className="w-full border-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
            />
          </div>
          <button className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Search by All <IconChevron />
          </button>
        </div>
        <div className="border-b border-gray-100 px-5 py-2.5">
          <button className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
            <IconPlus /> Add filter
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-14 text-gray-400"><IconSpinner /></div>
          ) : allProducts.length === 0 ? (
            <div className="py-14 text-center text-sm text-gray-400">No products found</div>
          ) : (
            allProducts.map((p) => {
              const isChecked = selected.has(p.id);
              return (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-gray-50 px-5 py-2.5 transition-colors hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(p)}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                  />
                  <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-300">
                        <IconImagePlaceholder />
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-medium text-blue-600">{p.title}</span>
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3.5">
          <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onDone(Array.from(selected.values()))}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Collection items box (grid / list views, drag-to-reorder) ─────────── */
function CollectionItemsBox({ products, onRemove, onReorder, onAddClick }: {
  products: CollectionProduct[];
  onRemove: (id: string) => void;
  onReorder: (next: CollectionProduct[]) => void;
  onAddClick: () => void;
}) {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...products];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  const dragProps = (idx: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; },
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); if (dragIdx !== null && idx !== dragIdx) setOverIdx(idx); },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === idx) return;
      reorder(dragIdx, idx);
      setDragIdx(null); setOverIdx(null);
    },
    onDragEnd: () => { setDragIdx(null); setOverIdx(null); },
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-gray-900">Collection items</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{products.length}</span>
        </div>
        <button onClick={onAddClick} className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
          Add products
        </button>
      </div>

      <div className="mb-4 inline-flex rounded-lg bg-gray-100 p-1">
        <button
          onClick={() => setView('grid')}
          className={`rounded-md p-1.5 transition-colors ${view === 'grid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <IconGrid />
        </button>
        <button
          onClick={() => setView('list')}
          className={`rounded-md p-1.5 transition-colors ${view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <IconList />
        </button>
      </div>

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-14 text-center">
          <p className="mb-3 text-sm text-gray-500">No products in this collection yet</p>
          <button onClick={onAddClick} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black">
            + Add products
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-1.5 text-xs text-gray-400">
            <IconDragHandle />
            اسحب المنتجات لإعادة ترتيب ظهورها داخل الكولكشن
          </div>
          {view === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p, idx) => (
                <div
                  key={p.id}
                  {...dragProps(idx)}
                  className={`group relative cursor-grab overflow-hidden rounded-lg border transition-all ${
                    overIdx === idx ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-200"
                  } ${dragIdx === idx ? "opacity-40" : "opacity-100"}`}
                >
                  <div className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <IconDragHandle />
                  </div>
                  <div className="aspect-square w-full bg-gray-50">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-300"><IconImagePlaceholder /></div>
                    )}
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="truncate text-xs font-medium text-gray-700">{p.title}</p>
                  </div>
                  <button
                    onClick={() => onRemove(p.id)}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    title="Remove from collection"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {products.map((p, idx) => (
                <div
                  key={p.id}
                  {...dragProps(idx)}
                  className={`flex cursor-grab items-center gap-3 rounded-lg border px-3 py-2 transition-all ${
                    overIdx === idx ? "border-blue-400 bg-blue-50/60" : "border-gray-100 hover:bg-gray-50"
                  } ${dragIdx === idx ? "opacity-40" : "opacity-100"}`}
                >
                  <span className="flex-shrink-0 text-gray-300"><IconDragHandle /></span>
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-300"><IconImagePlaceholder /></div>
                    )}
                  </div>
                  <span className="flex-1 truncate text-sm font-medium text-gray-800">{p.title}</span>
                  <button onClick={() => onRemove(p.id)} className="p-1 text-gray-400 hover:text-red-600" title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Single-image dropzone ─────────────────────────────────────────────── */
function CollectionImageDropzone({
  imageUrl, uploading, onPickFile, onRemove,
}: {
  imageUrl: string | null; uploading: boolean;
  onPickFile: (file: File) => void; onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDraggingFile(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current--;
    if (dragCounter.current === 0) setIsDraggingFile(false);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDraggingFile(false); dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) onPickFile(file);
  };

  if (imageUrl) {
    return (
      <div className="relative w-full max-w-xs">
        <div className="aspect-square w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          <img src={imageUrl} alt="" className="h-full w-full object-cover" style={{ opacity: uploading ? 0.5 : 1 }} />
        </div>
        {uploading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <IconSpinner className="text-blue-500" />
          </div>
        )}
        {!uploading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-black/0 opacity-0 transition-all hover:bg-black/40 hover:opacity-100">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-white"
            >
              ✎ Change
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md bg-red-600/95 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
            >
              × Remove
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }} />
      </div>
    );
  }

  return (
    <div
      onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}
      onClick={() => fileRef.current?.click()}
      className={`relative w-full max-w-xs cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        isDraggingFile ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
      }`}
    >
      <div className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full transition-colors ${isDraggingFile ? "bg-blue-100" : "bg-gray-200"}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isDraggingFile ? "#458fff" : "#6d7175"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
        </svg>
      </div>
      <p className={`mb-1 text-sm font-semibold ${isDraggingFile ? "text-blue-600" : "text-gray-700"}`}>
        {isDraggingFile ? "Drop the image here" : "Drag and drop an image, or click to select one"}
      </p>
      <p className="text-xs leading-relaxed text-gray-500">
        Max size: <strong>10MB</strong> — Types: <strong>.png, .jpg, .webp</strong>
      </p>
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }} />
    </div>
  );
}

/* ─── SEO section — same preview/edit pattern as ProductForm's
       "Search engine listing" (SeoListingSection): collapsed Google-style
       preview by default, "Edit" reveals the URL + Title + Description
       fields with live character counts, Save/Cancel inside the card.
       - The breadcrumb preview always shows a handle: real handle first,
         then a handle derived from the Title, then the raw Title itself
         (no fake auto-generated placeholder like "collection-172...").
       - The Description (rich text) is stripped of HTML and used as the
         fallback meta description — exactly like ProductForm's
         SeoListingSection does with the product description — so a long
         formatted description gets shortened to something SEO-appropriate
         instead of being left blank or dumped in full.
       - A "view collection" link sits right under the Collection URL
         field so you can jump straight to the live page. ─── */
function CollectionSeoSection({
  name, handle, handleEdited, onHandleChange,
  description, seoTitle, seoDescription, onChange,
}: {
  name: string;
  handle: string;
  handleEdited: boolean;
  onHandleChange: (next: string, edited: boolean) => void;
  description: string;
  seoTitle: string;
  seoDescription: string;
  onChange: (seoTitle: string, seoDescription: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftHandle, setDraftHandle] = useState(handle);
  const [draftTitle, setDraftTitle] = useState(seoTitle);
  const [draftDesc, setDraftDesc] = useState(seoDescription);
  const [linkCopied, setLinkCopied] = useState(false);

  // No fake placeholder anymore: real handle → handle derived from the
  // Title → the raw Title text itself, so an untitled/un-slugged
  // collection just shows its own name instead of a made-up identifier.
  const displayHandle = handle || toHandle(name) || name.trim();

  const plainDesc = stripHtml(description);
  const displayTitle = (seoTitle || name || displayHandle).trim();
  const displayDesc = (seoDescription || plainDesc).trim();

  const startEdit = () => {
    setDraftHandle(handle || toHandle(name) || name.trim());
    setDraftTitle(seoTitle || name);
    setDraftDesc(seoDescription || plainDesc.slice(0, SEO_PREVIEW_LEN));
    setEditing(true);
  };

  const titleOver = draftTitle.length > SEO_TITLE_MAX;
  const descOver = draftDesc.length > SEO_DESC_MAX;

  const save = () => {
    const finalHandle = toHandle(draftHandle) || toHandle(name);
    onHandleChange(finalHandle, true);
    onChange(draftTitle.trim(), draftDesc.trim());
    setEditing(false);
  };
  const cancel = () => setEditing(false);

  const collectionLink = `yourstore.com/collections/${draftHandle || displayHandle}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`https://${collectionLink}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard permissions can fail silently — link text is still selectable */
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[15px] font-semibold text-gray-900">Search engine listing</span>
        {!editing && (
          <button onClick={startEdit} type="button" className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
            <IconEdit /> Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="mb-0.5 truncate text-xs text-[#006621]">
            yourstore.com{" › "}collections{" › "}{displayHandle}
          </div>
          <div className="mb-1 truncate text-[15px] font-normal text-[#1a0dab]">
            {displayTitle.slice(0, SEO_TITLE_MAX)}{displayTitle.length > SEO_TITLE_MAX ? "…" : ""}
          </div>
          {displayDesc ? (
            <div className="text-[13px] leading-snug text-[#545454]">
              {displayDesc.slice(0, SEO_PREVIEW_LEN)}{displayDesc.length > SEO_PREVIEW_LEN ? "…" : ""}
            </div>
          ) : (
            <div className="text-[13px] italic leading-snug text-gray-400">
              No description yet — add one so search engines have something to show.
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="mb-2">
            <label className="mb-1.5 block text-sm font-semibold text-gray-800">Collection URL</label>
            <div className="flex items-center overflow-hidden rounded-lg border border-gray-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
              <span className="whitespace-nowrap border-r border-gray-300 bg-gray-50 px-2.5 py-2 text-xs text-gray-500">collections/</span>
              <input
                value={draftHandle}
                onChange={(e) => {
                  const cleaned = e.target.value
                    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, "")
                    .replace(/[^a-zA-Z0-9\s-]+/g, "");
                  // لو مسحت الحقل خالص، يرجع فورًا لقيمة الـ Title (من غير
                  // ما تستنى الـ blur) — مفيش "اسم تلقائي" وهمي منفصل.
                  setDraftHandle(cleaned.trim() === "" ? toHandle(name) : cleaned);
                }}
                onBlur={(e) => setDraftHandle(toHandle(e.target.value) || toHandle(name))}
                placeholder={toHandle(name) || "collection-url"}
                className="flex-1 border-none bg-transparent px-2.5 py-2 text-sm text-gray-900 outline-none"
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">حروف إنجليزية وأرقام وشرطات فقط.</p>
          </div>

          {/* Direct link to the collection page — sits right under the URL field */}
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-gray-600">{collectionLink}</span>
              <button
                type="button"
                onClick={copyLink}
                className={`flex-shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  linkCopied ? "text-green-600" : "text-blue-600 hover:text-blue-700"
                }`}
              >
                {linkCopied ? "✓ Copied" : "Copy link"}
              </button>
              <a
                href={`/collections/${draftHandle || displayHandle}`}
                target="_blank"
                rel="noreferrer"
                className="flex-shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
              >
                View
              </a>
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-semibold text-gray-800">Page title</label>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={name || displayHandle}
              className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:ring-2 ${
                titleOver ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-gray-300 focus:border-blue-500 focus:ring-blue-100"
              }`}
            />
            <p className={`mt-1 text-xs ${titleOver ? "font-semibold text-red-600" : "text-gray-400"}`}>
              {draftTitle.length} of {SEO_TITLE_MAX} characters used{titleOver ? ` — ${draftTitle.length - SEO_TITLE_MAX} over limit` : ""}
            </p>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-semibold text-gray-800">Meta description</label>
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={4}
              placeholder="A short description that appears in search results"
              className={`w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed text-gray-900 outline-none transition-colors focus:ring-2 ${
                descOver ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-gray-300 focus:border-blue-500 focus:ring-blue-100"
              }`}
            />
            <p className={`mt-1 text-xs ${descOver ? "font-semibold text-red-600" : "text-gray-400"}`}>
              {draftDesc.length} of {SEO_DESC_MAX} characters used{descOver ? ` — ${draftDesc.length - SEO_DESC_MAX} over limit` : ""}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              فاضي؟ هياخد نسخة مختصرة من الـ Description بتاع الكولكشن تلقائيًا.
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={save} type="button" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black">Save</button>
            <button onClick={cancel} type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Not found state ────────────────────────────────────────────────────── */
function CollectionNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
        <IconAlertTriangle />
      </span>
      <div>
        <h1 className="mb-1 text-lg font-bold text-gray-900">Collection not found</h1>
        <p className="text-sm text-gray-500">
          This collection doesn't exist or may have been deleted. Double-check the link, or head back to your collections list.
        </p>
      </div>
      <a
        href="/stores-building/collections"
        className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-black"
      >
        <IconArrowLeft /> Back to collections
      </a>
    </div>
  );
}

/* ─── Main CollectionForm ────────────────────────────────────────────────── */
export default function CollectionForm({ collectionId }: { collectionId?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(!!collectionId);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [description, setDescription] = useState("");
  const [descUploading, setDescUploading] = useState(0);

  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const [products, setProducts] = useState<CollectionProduct[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* ─── Top action group: single "More actions" menu holding
         Duplicate / View / Delete together ───────────────────────────── */
  const [moreOpen, setMoreOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const h = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [moreOpen]);

  useEffect(() => {
    if (!collectionId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    api.get(`/stores/collections/${collectionId}`)
      .then(({ data }) => {
        if (cancelled) return;
        // Existence check happens right here, before any field is populated:
        // an empty/falsy payload for a requested id means there is nothing to edit.
        if (!data || !data.id) {
          setNotFound(true);
          return;
        }
        setName(data.name);
        setHandle(data.handle || "");
        setDescription(data.description || "");
        setSeoTitle(data.seo_title || "");
        setSeoDescription(data.seo_description || "");
        setImageUrl(data.image_url || null);
        setImageKey(data.image_key || null);
        setProducts(data.products || []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        // A 404 (or any "not found"-flavoured error) means the collection
        // was deleted or the id/handle in the URL doesn't exist — show the
        // not-found state instead of a blank/broken form.
        if (err?.response?.status === 404) {
          setNotFound(true);
        } else {
          setError('Failed to load this collection. Please try again.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [collectionId]);

  const handlePickImage = (file: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { setError('This file type is not allowed. Allowed: png, jpg, webp'); return; }
    if (file.size > MAX_IMAGE_SIZE) { setError('The image exceeds the maximum size (10MB)'); return; }
    const localUrl = URL.createObjectURL(file);
    setImageUrl(localUrl);
    setImageUploading(true);
    uploadToR2(file, 'collections')
      .then(({ url, key }) => { setImageUrl(url); setImageKey(key); })
      .catch(() => setError('Failed to upload the image'))
      .finally(() => setImageUploading(false));
  };
  const handleRemoveImage = () => { setImageUrl(null); setImageKey(null); };

  const removeProduct = (id: string) => setProducts((prev) => prev.filter((p) => p.id !== id));
  const reorderProducts = (next: CollectionProduct[]) => setProducts(next);

  const handleSave = async () => {
    if (!name.trim()) { setNameError(true); setError('Please enter a name for the collection'); return; }
    if (imageUploading) { setError('Please wait for the image upload to finish'); return; }
    if (descUploading > 0) { setError('Please wait for the description images to finish uploading'); return; }
    setNameError(false);
    setSaving(true);
    setError("");
    try {
      // Real handle first, otherwise derive one from the Title — no fake
      // auto-generated placeholder.
      const finalHandle = toHandle(handle.trim()) || toHandle(name.trim());
      const payload = {
        name: name.trim(),
        handle: finalHandle,
        description: description || null,
        seo_title: seoTitle.trim() || null,
        seo_description: seoDescription.trim() || null,
        image_url: imageUrl && !imageUrl.startsWith('blob:') ? imageUrl : undefined,
        image_key: imageKey || undefined,
        product_ids: products.map((p) => p.id),
      };
      let res;
      if (collectionId) {
        res = await api.put(`/stores/collections/${collectionId}`, payload);
      } else {
        res = await api.post('/stores/collections', payload);
      }
      if (imageKey) {
        await confirmUpload(imageKey, 'collection', res.data.id.toString());
      }
      router.push('/stores-building/collections');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!collectionId || duplicating) return;
    setMoreOpen(false);
    setDuplicating(true);
    setError("");
    try {
      const { data } = await api.post(`/stores/collections/${collectionId}/duplicate`);
      router.push(`/stores-building/collections/${data.id}/edit`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to duplicate the collection');
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async () => {
    if (!collectionId) return;
    setDeleting(true);
    try {
      await api.delete(`/stores/collections/${collectionId}`);
      router.push('/stores-building/collections');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to delete the collection');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-gray-400">
        <IconSpinner className="text-blue-500" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  if (notFound) {
    return <CollectionNotFound />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 font-sans">
      {/* Breadcrumb back link */}
      <a
        href="/stores-building/collections"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
      >
        <IconArrowLeft /> Collections
      </a>

      {/* Top bar — title + a single "More actions" menu holding Duplicate / View / Delete together */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">{collectionId ? 'Edit collection' : 'Create collection'}</h1>

        {collectionId && (
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              More actions <IconChevron />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={handleDuplicate}
                  disabled={duplicating}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {duplicating ? <IconSpinner /> : <IconCopy />} Duplicate
                </button>
                <a
                  href={`/collections/${handle}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMoreOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <IconEye /> View
                </a>
                <div className="my-1 border-t border-gray-100" />
                <button
                  onClick={() => { setMoreOpen(false); setConfirmDelete(true); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <IconTrash /> Delete collection
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>⚠ {error}</span>
          <button onClick={() => setError("")} className="text-red-500 hover:text-red-700"><IconX /></button>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Title / Description / Image */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-semibold text-gray-800">Title</label>
            <input
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!handleEdited) setHandle(toHandle(v));
                if (nameError) setNameError(false);
              }}
              placeholder="e.g. Summer Collection"
              className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${
                nameError ? "border-red-400" : "border-gray-300"
              }`}
            />
            {nameError && <p className="mt-1.5 text-xs text-red-600">⚠ Add a name for the collection</p>}
          </div>

          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-semibold text-gray-800">Description</label>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              onUploadingChange={setDescUploading}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-800">Image</label>
            <CollectionImageDropzone
              imageUrl={imageUrl}
              uploading={imageUploading}
              onPickFile={handlePickImage}
              onRemove={handleRemoveImage}
            />
          </div>
        </div>

        {/* Collection items — supports drag-to-reorder */}
        <CollectionItemsBox
          products={products}
          onRemove={removeProduct}
          onReorder={reorderProducts}
          onAddClick={() => setPickerOpen(true)}
        />

        {/* Search engine listing — preview/edit toggle, same pattern as ProductForm, including the Collection URL field */}
        <CollectionSeoSection
          name={name}
          handle={handle}
          handleEdited={handleEdited}
          onHandleChange={(next, edited) => { setHandle(next); setHandleEdited(edited); }}
          description={description}
          seoTitle={seoTitle}
          seoDescription={seoDescription}
          onChange={(t, d) => { setSeoTitle(t); setSeoDescription(d); }}
        />
      </div>

      {/* Bottom save bar — Save lives here */}
      <div className="sticky bottom-0 z-40 mt-6 flex justify-end gap-2 border-t border-gray-200 bg-white/95 px-1 py-4 backdrop-blur">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:bg-black disabled:opacity-50"
        >
          {saving && <IconSpinner />}
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {pickerOpen && (
        <ProductPickerModal
          initialSelected={products}
          onCancel={() => setPickerOpen(false)}
          onDone={(picked) => { setProducts(picked); setPickerOpen(false); }}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDelete(false); }}
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                <IconAlertTriangle />
              </span>
              <div>
                <h3 className="text-[15px] font-bold text-gray-900">Delete collection?</h3>
                <p className="mt-1 text-[13px] text-gray-500">This can't be undone.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
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