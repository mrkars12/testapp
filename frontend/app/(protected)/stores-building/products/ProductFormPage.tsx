'use client'

import { useState, useRef, useEffect, useCallback } from "react";
import api from '@/lib/api'  // ← الـ axios instance بتاعك
import { useParams } from 'next/navigation'
import { uploadToR2, deleteFromR2, confirmUpload } from '@/lib/uploads';
import { createPortal } from "react-dom";

/* ─── Shared TypeScript types ────────────────────────────────────────────── */

interface VariantOption {
  name: string;
  values: string[];
  colors?: Record<string, string>;
  displayType?: "buttons" | "select" | "tabs" | "input"; // ← جديد
}

interface VariantRow {
  id?: string;
  combination: string[];
  price: string;
  salePrice: string;
  cost: string;
  quantity: number;
  sku: string;
  barcode?: string;
  image: ProductImage | null;
  active: boolean;
}

interface ProductImage {
  url: string;
  alt: string;
  file?: File;
  type: "image" | "video";
  key?: string;          // ← جديد: مسار R2، للحذف والـ confirm
  uploading?: boolean;   // ← جديد: حالة الرفع
  uploadError?: boolean; // ← جديد
}

type Tag = { id: string; name: string; _pending?: boolean };
type ProductType = { id: string; name: string; _pending?: boolean };
type Collection = { id: string; name: string; image_url?: string; _pending?: boolean };

interface ProductFormState {
  title: string;
  description: string;
  url_handle: string;
  status: string;
  product_type: ProductType | null;
  tags: Tag[];
  collections: Collection[];
  price: string;
  compare_at_price: string;
  cost_per_item: string;
  charge_tax: boolean;
  track_inventory: boolean;
  quantity: number;
  sku: string;
  barcode: string;
  continue_selling: boolean;
  category: string;
  options: VariantOption[];
  images: ProductImage[];
  variants: VariantRow[];
  seo_title: string;
  seo_description: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function toHandle(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // يشيل الحروف العربية بكل أشكالها
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, "")
    // يسمح بس بحروف/أرقام لاتينية ومسافات وشرطات
    .replace(/[^a-z0-9\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EGP: "E£",
  USD: "$",
  EUR: "€",
  GBP: "£",
  SAR: "SR",
  AED: "AED",
  KWD: "KD",
};
const ACTIVE_CURRENCY = "EGP";
const CURRENCY_SYMBOL = CURRENCY_SYMBOLS[ACTIVE_CURRENCY] ?? ACTIVE_CURRENCY;
const CURRENCY_CODE = ACTIVE_CURRENCY;

function formatCurrency(value: string | number, currencyCode: string = ACTIVE_CURRENCY): string {
  const num = typeof value === "number" ? value : parseFloat(value);
  const safe = isNaN(num) || num < 0 ? 0 : num;
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
  return `${symbol}${safe.toFixed(2)} ${currencyCode}`;
}

/** يمنع الأصفار الزيادة في الأول (00 -> 0) وأكتر من نقطة عشرية واحدة،
 *  من غير ما يرجّع أي قيمة قديمة — القيمة بتفضل زي ما المستخدم كاتبها
 *  بالظبط، حتى لو فاضية أو بتساوي صفر. المنع الحقيقي بيحصل وقت الحفظ. */
function sanitizePriceTyping(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  if (/^0[0-9]/.test(v)) v = v.replace(/^0+/, "");
  return v;
}

function isValidPositivePrice(val: string): boolean {
  if (val.trim() === "") return false;
  const n = parseFloat(val);
  return !isNaN(n) && n > 0;
}

/* ─── Constants ──────────────────────────────────────────────────────────── */
const CATEGORY_TREE: Record<string, string[]> = {
  "Animals & Pet Supplies": [
    "Bird Supplies", "Cat Supplies", "Dog Supplies", "Fish & Aquatic Pet Supplies",
    "Horse Supplies", "Live Animals", "Pet Agility Equipment", "Pet Apparel",
    "Pet Carriers & Crates", "Pet Feeding & Watering Supplies", "Pet Food",
    "Pet Grooming Supplies", "Pet Habitat Accessories", "Pet Halters & Leashes",
    "Pet ID Tags", "Pet Memorial Products", "Pet Steps & Ramps",
    "Pet Toys", "Pet Training Aids", "Reptile & Amphibian Supplies",
  ],
  "Apparel & Accessories": [
    "Baby & Toddler Clothing", "Clothing", "Clothing Accessories", "Costumes & Accessories",
    "Handbags, Wallets & Cases", "Jewelry", "Men's Clothing", "Shoe Accessories",
    "Shoes", "Sleepwear", "Sunglasses & Eyewear Accessories", "Swimwear",
    "Underwear & Socks", "Uniforms", "Women's Clothing",
  ],
  "Arts & Entertainment": [
    "Event Tickets", "Hobbies & Creative Arts", "Party & Celebration",
    "Photography", "Collectibles", "Craft Supplies", "Musical Instruments",
    "Painting, Drawing & Art Supplies", "Sewing & Fabric",
  ],
  "Baby & Toddler": [
    "Baby Bathing", "Baby Health", "Baby Safety", "Baby Toys",
    "Baby Transport", "Baby Transport Accessories", "Car Seats", "Car Seat Accessories",
    "Diapering", "Feeding", "Nursery", "Potty Training",
  ],
  "Business & Industrial": [
    "Agriculture", "Construction", "Fire & Safety Equipment", "Fluid Handling",
    "Food Service", "Heavy Machinery", "Industrial Cleaning & Janitorial Supplies",
    "Industrial Materials & Chemicals", "Occupational Health & Safety Equipment",
    "Packing & Shipping Supplies", "Printing & Graphic Arts Equipment",
    "Retail & Wholesale Supplies", "Science & Laboratory", "Signage", "Storage & Organization",
  ],
  "Cameras & Optics": [
    "Binoculars & Telescopes", "Camera & Optic Accessories", "Cameras",
    "Lenses", "Night Vision Equipment", "Optical Instruments", "Tripods & Monopods",
  ],
  "Electronics": [
    "Audio", "Cameras & Optics", "Circuit Boards & Components", "Communications",
    "Computers", "Electronics Accessories", "GPS & Navigation", "Networking",
    "Power Supplies", "Print, Copy, Scan & Fax", "Radar & Signal Detectors",
    "Smart Home", "Telephony", "Video", "Video Game Consoles", "Wearable Technology",
  ],
  "Food, Beverages & Tobacco": [
    "Beverages", "Candy & Chocolate", "Cooking & Baking Ingredients", "Dairy Products",
    "Fish & Seafood", "Food Items", "Fruits & Vegetables", "Meat & Poultry",
    "Snack Foods", "Tobacco Products", "Vaping & Alternative Smoking",
  ],
  "Furniture": [
    "Baby & Toddler Furniture", "Bar Furniture", "Bedroom Furniture", "Benches",
    "Cabinets & Storage", "Chairs & Seating", "Entertainment Centers & TV Stands",
    "Furniture Sets", "Office Furniture", "Outdoor Furniture", "Shelving",
    "Sofas", "Tables", "Furniture Accessories",
  ],
  "Hardware": [
    "Building Consumables", "Fencing & Barriers", "Fuel Containers & Tanks",
    "Hardware Accessories", "Hardware Pumps", "Heating, Ventilation & Air Conditioning",
    "Locks & Keys", "Plumbing", "Power & Hand Tools", "Safes", "Tool Boxes",
    "Vehicle Parts & Accessories", "Welding Equipment", "Work Wear & Protective Gear",
  ],
  "Health & Beauty": [
    "Bath & Body", "Cosmetics", "Fragrances", "Hair Care", "Health Care",
    "Makeup", "Massage & Relaxation", "Nail Care", "Oral Care", "Personal Care",
    "Saunas & Spas", "Skin Care", "Sleep Aids", "Vision Care", "Weight Loss",
  ],
  "Home & Garden": [
    "Decor", "Emergency Preparedness", "Fireplace & Wood Stove Accessories",
    "Flood, Fire & Gas Safety", "Household Appliance Accessories", "Household Appliances",
    "Household Supplies", "Kitchen & Dining", "Lawn & Garden",
    "Lighting", "Linens & Bedding", "Plants (Artificial & Dried)", "Pool & Spa",
    "Smoking Accessories", "Yard, Garden & Outdoor Living",
  ],
  "Luggage & Bags": [
    "Backpacks", "Briefcases", "Diaper Bags", "Duffel Bags",
    "Luggage", "Luggage Accessories", "Messenger Bags", "Suitcases", "Travel Accessories",
  ],
  "Mature": [
    "Adult Novelty Products", "Adult Videos & DVDs", "Lingerie",
    "Smoking & Vaping Accessories (Adult)", "Tobacco Alternatives",
  ],
  "Media": [
    "Books", "Magazines & Newspapers", "Movies", "Music",
    "Podcasts", "Sheet Music", "Video Games (Media)",
  ],
  "Office Supplies": [
    "Filing & Organization", "General Office Supplies", "Office Equipment",
    "Office Instruments", "Presentation Supplies", "Shipping Supplies",
    "Time Management & Planning", "Writing & Correction Supplies",
  ],
  "Religious & Ceremonial": [
    "Funeral Supplies", "Religious Books & Texts", "Religious Jewelry",
    "Religious Organization Furniture", "Religious Textiles", "Ritual Items",
    "Wedding Supplies",
  ],
  "Software": [
    "Antivirus & Security Software", "Business & Productivity Software",
    "Computer Software", "Educational Software", "Mobile Apps",
    "Operating Systems", "Software Subscriptions", "Video Game Software",
  ],
  "Sporting Goods": [
    "Athletics", "Boating", "Cycling", "Exercise & Fitness", "Fishing",
    "Golf", "Gymnastics", "Hunting", "Indoor Games", "Martial Arts & Self Defense",
    "Outdoor Recreation", "Team Sports", "Water Sports", "Winter Sports",
  ],
  "Toys & Games": [
    "Action Figures", "Arts & Crafts Toys", "Baby & Toddler Toys", "Board Games",
    "Building Toys", "Card Games", "Dolls & Accessories", "Educational Toys",
    "Novelty & Gag Toys", "Outdoor Toys", "Party Games", "Puzzles",
    "Ride-On Toys", "Stuffed Animals & Plush Toys", "Video Games",
  ],
  "Vehicles & Parts": [
    "Vehicle Care & Cleaning", "Vehicle Electronics", "Vehicle Maintenance Tools",
    "Vehicle Parts & Accessories", "Vehicle Safety & Security", "Vehicle Storage",
    "Vehicles", "Watercraft",
  ],
  // ملاحظة: في Shopify الحقيقي، دول الـ 3 فئات دي (Gift Cards, Uncategorized,
  // Bundles) عبارة عن "leaf" قابلة للاختيار مباشرة بدون فئات فرعية (زر
  // بدون سهم ">"). عشان الكومبوننت بتاعنا (CategoryPicker) مبني على إن كل
  // فئة رئيسية ليها array فرعي، بنحطلها قيمة وحيدة بنفس اسم الفئة الرئيسية
  // نفسها، فتبقى قابلة للاختيار بضغطة واحدة برضه.
  "Gift Cards": ["Gift Cards"],
  "Uncategorized": ["Uncategorized"],
  "Services": [
    "Consulting Services", "Design Services", "Digital Services",
    "Educational Services", "Home Services", "Installation & Repair Services",
    "Photography Services", "Subscription Services",
  ],
  "Product Add-Ons": [
    "Extended Warranty", "Gift Wrapping", "Installation Add-On",
    "Personalization / Engraving", "Rush Processing",
  ],
  "Bundles": ["Bundles"],
};

const TOP_CATEGORIES = Object.keys(CATEGORY_TREE);

const PRESET_OPTION_NAMES = ["Color", "Size", "Material", "Style", "Weight", "Volume", "Storage"];

const OPTION_SUGGESTIONS: Record<string, string[]> = {
  Color: ["Red", "Blue", "Green", "Black", "White", "Yellow", "Purple", "Pink", "Orange", "Gray"],
  Size: ["XS", "S", "M", "L", "XL", "XXL", "One Size"],
  Material: ["Cotton", "Polyester", "Wool", "Silk", "Leather", "Linen", "Nylon"],
  Style: ["Classic", "Modern", "Vintage", "Casual", "Formal", "Sport"],
  Weight: ["100g", "250g", "500g", "1kg", "2kg", "5kg"],
  Volume: ["50ml", "100ml", "250ml", "500ml", "1L", "2L"],
  Storage: ["16GB", "32GB", "64GB", "128GB", "256GB", "512GB", "1TB"],
};

/* خريطة أسماء الألوان الجاهزة (المقترحة فوق) لأقرب لون HEX ليها — بتُستخدم
   كقيمة افتراضية للسواتش بجانب كل قيمة لون، لحد ما المستخدم يغيّرها يدويًا
   من الـ color picker. */
const COLOR_PRESETS: Record<string, string> = {
  Red: "#e53e3e",
  Blue: "#3182ce",
  Green: "#38a169",
  Black: "#000000",
  White: "#ffffff",
  Yellow: "#ecc94b",
  Purple: "#805ad5",
  Pink: "#ed64a6",
  Orange: "#ed8936",
  Gray: "#a0aec0",
};

function normalizeColorKey(v: string): string {
  return v.trim().toLowerCase();
}

function getPresetHex(v: string): string | undefined {
  const key = normalizeColorKey(v);
  const found = Object.keys(COLOR_PRESETS).find((k) => k.toLowerCase() === key);
  return found ? COLOR_PRESETS[found] : undefined;
}

/** بيحدد هل اسم الاختيار (Option name) الحالي هو "لون/Color" ولا لأ —
 * بنقارن بالانجليزي والعربي عشان يشتغل مع الاتنين. */
function isColorOptionName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "color" || n === "colour" || name.trim() === "لون";
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

let _pid = 0;
const newPendingId = () => `__p__${++_pid}`;

/* ─── Variant logic ─────────────────────────────────────────────────────── */
function buildCombinations(options: VariantOption[]): string[][] {
  const filled = options.filter((o) => o.name && o.values.filter(Boolean).length > 0);
  if (!filled.length) return [];
  let result: string[][] = [[]];
  for (const opt of filled) {
    const vals = opt.values.filter(Boolean);
    const next: string[][] = [];
    for (const existing of result) for (const v of vals) next.push([...existing, v]);
    result = next;
  }
  return result;
}

interface VariantPriceDefaults {
  price?: string;
  salePrice?: string;
  cost?: string;
}

function comboKey(combo: string[]): string {
  // مفتاح غير مرتبط بترتيب الاختيارات — بيحل مشكلة فقدان بيانات
  // الفارينت لما تعمل إعادة ترتيب بين اختيارين (زي اللون والمساحة)
  return [...combo].sort().join("|");
}

function syncVariants(
  options: VariantOption[],
  existing: VariantRow[],
  defaults?: VariantPriceDefaults
): VariantRow[] {
  return buildCombinations(options).map((combo) => {
    const key = comboKey(combo);
    const found = existing.find((r) => comboKey(r.combination) === key);
    return found
      ? { ...found, combination: combo }
      : {
          combination: combo,
          price: defaults?.price ?? "",
          salePrice: defaults?.salePrice ?? "",
          cost: defaults?.cost ?? "",
          quantity: 0,
          sku: "",
          barcode: "",
          image: null,
          active: true,
        };
  });
}
// ضيفها فوق variantPriceMismatch
function variantPriceExceedsOriginal(row: VariantRow): boolean {
  const price = parseFloat(row.price);
  const original = parseFloat(row.salePrice); // salePrice = السعر الأصلي هنا
  if (isNaN(price) || isNaN(original)) return false;
  return price > original;
}

// وتعديل الدالة القديمة
function variantPriceMismatch(row: VariantRow): boolean {
  return (
    !isValidPositivePrice(row.price) ||
    !isValidPositivePrice(row.salePrice) ||
    variantPriceExceedsOriginal(row)
  );
}

/** بيتنادى مباشرة جوه onChange مش onBlur — لو القيمة بقت فاضية وانت
 *  لسه بتكتب/بتمسح، بترجع فورًا لقيمة الـ Pricing العام (fallback) بدل
 *  ما تفضل فاضية لحد ما تخرج من الحقل */
function handlePriceChange(raw: string, fallback: string | undefined, onChange: (v: string) => void) {
  const sanitized = sanitizePriceTyping(raw);
  if (sanitized === "" && fallback && fallback.trim() !== "") {
    onChange(fallback);
  } else {
    onChange(sanitized);
  }
}

/* ─── Shared styles ─────────────────────────────────────────────────────── */
const S = {
  body: {
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    margin: 0,
    background: "transparent",
    minHeight: "100vh",
  } as React.CSSProperties,
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 15,
    borderRadius: 10,
    zIndex: 300,
    justifyContent: 'end'
  } as React.CSSProperties,
  card: {
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #e3e3e3",
    padding: "20px",
    marginBottom: 12,
    position: "relative",
  } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#303030",
    marginBottom: 5,
  } as React.CSSProperties,
  inp: {
    maxWidth: '100%',
    width: "100%",
    padding: "7px 10px",
    fontSize: 14,
    border: "1px solid #c9cccf",
    borderRadius: 7,
    outline: "none",
    background: "#fff",
    color: "#303030",
    boxSizing: "border-box" as const,
    transition: "border-color 0.15s,box-shadow 0.15s",
  },
  drop: {
    position: "fixed" as const,
    background: "#fff",
    border: "1px solid #c9cccf",
    borderRadius: 8,
    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
    zIndex: 9999,
    overflow: "hidden",
    maxHeight: 240,
    overflowY: "auto" as const,
  },
  dropItem: {
    padding: "9px 12px",
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "#303030",
    background: "none",
    border: "none",
    width: "100%",
    textAlign: "left" as const,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "#303030",
    display: "block",
    marginBottom: 14,
  } as React.CSSProperties,
  pillBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    fontSize: 13,
    color: "#303030",
    background: "#f1f1f1",
    border: "1px solid #d9d9d9",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 400,
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
};

/* ─── Dropdown position hook ─────────────────────────────────────────────── */
function useDropdownPosition(
  open: boolean,
  ref: React.RefObject<HTMLDivElement | null>,
) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const recalc = useCallback(() => {
    if (ref.current) setRect(ref.current.getBoundingClientRect());
  }, [ref]);
  useEffect(() => {
    if (!open) return;
    recalc();
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, recalc]);
  return { rect, recalc };
}

/* ─── Toggle ─────────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 38, height: 22, borderRadius: 11,
        background: checked ? "#1a9c3e" : "#babfc3",
        border: "none", cursor: "pointer", position: "relative",
        padding: 0, flexShrink: 0, transition: "background .2s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 18 : 3,
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .2s",
      }} />
    </button>
  );
}

/* ─── DragHandle ─────────────────────────────────────────────────────────── */
function DragHandle() {
  return (
    <div style={{ cursor: "grab", color: "#d0d0d0", display: "flex", alignItems: "center", padding: "0 2px", flexShrink: 0 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="6" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="18" r="1.5" />
      </svg>
    </div>
  );
}

/* ─── Icons ──────────────────────────────────────────────────────────────── */
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#d72c0d">
      <circle cx="12" cy="12" r="10" />
      <rect x="11" y="6" width="2" height="8" rx="1" fill="#fff" />
      <rect x="11" y="16" width="2" height="2" rx="1" fill="#fff" />
    </svg>
  );
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ transition: "transform 0.2s", transform: up ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/* ─── IconBtn ────────────────────────────────────────────────────────────── */
function IconBtn({
  onClick, danger, title, children,
}: {
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      title={title}
      type="button"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? (danger ? "#fff0f0" : "#f1f1f1") : "none",
        color: danger ? "#d72c0d" : "#6d7175",
        border: "none", cursor: "pointer", padding: 4, borderRadius: 5,
        display: "flex", alignItems: "center", flexShrink: 0, transition: "background .15s",
      }}
    >
      {children}
    </button>
  );
}

/* ─── SmallImagePicker ──────────────────────────────────────────────────── */
function SmallImagePicker({
  image, onPickFile, onRemove,
}: {
  image: ProductImage | null;
  onPickFile: (file: File) => void;
  onRemove?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [hov, setHov] = useState(false);
  return (
    <div style={{ position: "relative", width: 38, height: 38, flexShrink: 0 }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <button type="button" onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}
        style={{
          width: 38, height: 38, borderRadius: 7,
          border: `1.5px ${image ? "solid" : "dashed"} ${image ? "#c9cccf" : "#b0b0b0"}`,
          background: image ? "transparent" : "#f9fafb",
          cursor: "pointer", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
        }}>
        {image ? (
          <img src={image.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        )}
      </button>
      {image && hov && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 7,
          background: "rgba(0,0,0,.45)", display: "flex",
          alignItems: "center", justifyContent: "center", gap: 3,
        }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}
            style={{ background: "rgba(255,255,255,.9)", border: "none", borderRadius: 4, padding: "2px 4px", cursor: "pointer", fontSize: 10, fontWeight: 700, color: "#303030" }}
            title="Change image">✎</button>
          {onRemove && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{ background: "rgba(255,60,60,.9)", border: "none", borderRadius: 4, padding: "2px 4px", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#fff" }}
              title="Remove">×</button>
          )}
        </div>
      )}
      <input ref={ref} type="file" accept=".png,.jpg,.jpeg,.webp" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { onPickFile(f); e.target.value = ""; } }} />
    </div>
  );
}

/* ─── OptionNameInput ────────────────────────────────────────────────────── */
function OptionNameInput({ value, onChange, existingNames, hasError = false }: {
  value: string; onChange: (v: string) => void; existingNames: string[]; hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { rect, recalc } = useDropdownPosition(open, ref);

  const available = PRESET_OPTION_NAMES.filter((n) => !existingNames.includes(n));
  const isCustom = value && !PRESET_OPTION_NAMES.includes(value);
  const filtered = isEditing && inputVal.trim()
    ? available.filter((n) => n.toLowerCase().includes(inputVal.toLowerCase()))
    : available;
  const exactMatch = available.some((n) => n.toLowerCase() === inputVal.trim().toLowerCase());
  const showCreate = isEditing && inputVal.trim() !== "" && !exactMatch;
  const hasItems = filtered.length > 0 || showCreate || (isCustom && !isEditing);
  

  const openDrop = () => { setIsEditing(false); setInputVal(value); recalc(); setOpen(true); };
  const select = (e: React.MouseEvent, name: string) => {
    e.preventDefault(); onChange(name); setInputVal(name); setIsEditing(false); setOpen(false);
  };
  const createNew = (e: React.MouseEvent) => {
    e.preventDefault(); const t = inputVal.trim(); onChange(t); setInputVal(t); setIsEditing(false); setOpen(false);
  };

  /* FIX: القائمة دي كانت الوحيدة من بين كل الدروب داون (Tags, Product
     type, Category) اللي معملهاش إقفال لما تدوس في أي مكان بره الحقل —
     فكنت مضطر تدوس على الاسم المختار نفسه تاني عشان تقفلها. دلوقتي أي
     دوسة بره الحقل (من غير اختيار) بتقفلها وترجّع القيمة زي ما كانت. */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setIsEditing(false); setInputVal(value);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [value]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input value={inputVal}
        onChange={(e) => { setInputVal(e.target.value); setIsEditing(true); if (!open) { recalc(); setOpen(true); } }}
        onFocus={() => { if (!open) openDrop(); }}
        onClick={() => { if (!open) openDrop(); }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && value !== "") { e.preventDefault(); onChange(""); setInputVal(""); setIsEditing(false); if (!open) { recalc(); setOpen(true); } }
          if (e.key === "Enter") { e.preventDefault(); if (showCreate) createNew(e as unknown as React.MouseEvent); else if (filtered.length > 0) select(e as unknown as React.MouseEvent, filtered[0]); }
          if (e.key === "Escape") { setOpen(false); setIsEditing(false); setInputVal(value); }
        }}
        placeholder="e.g. Color, Size…"
        style={{ ...S.inp, borderColor: open ? "#458fff" : hasError ? "#d72c0d" : "#c9cccf", boxShadow: open ? "0 0 0 2px rgba(69,143,255,.2)" : hasError ? "0 0 0 2px rgba(215,44,13,.15)" : "none", paddingRight: 32 }}
      />
      <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#8c9196" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
      </div>
      {open && rect && hasItems && (
        <div style={{ ...S.drop, top: rect.bottom + 4, left: rect.left, width: rect.width }}>
          {isCustom && !isEditing && (
            <button onMouseDown={(e) => select(e, value)} style={{ ...S.dropItem, background: "#f0f6ff", color: "#458fff" }}>
              <span style={{ width: 16, display: "inline-flex", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
              </span>{value}
            </button>
          )}
          {filtered.map((name) => (
            <button key={name} onMouseDown={(e) => select(e, name)}
              style={{ ...S.dropItem, background: value === name && !isEditing ? "#f0f6ff" : "none", color: value === name && !isEditing ? "#458fff" : "#303030" }}>
              <span style={{ width: 16, display: "inline-flex", flexShrink: 0 }}>
                {value === name && !isEditing && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>{name}
            </button>
          ))}
          {showCreate && (
            <button onMouseDown={createNew} style={{ ...S.dropItem, borderTop: filtered.length > 0 || (isCustom && !isEditing) ? "1px solid #f1f1f1" : "none" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#458fff", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>+ Create</span>
              <span>"{inputVal.trim()}"</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const OptionNameInputValidated = OptionNameInput;

/* ─── OptionValuesEditor ─────────────────────────────────────────────────── */
function OptionValuesEditor({
  values, onChange, optionName = "", hasError = false, forceShowAllDuplicates = false,
  colors, onColorsChange,
}: {
  values: string[]; onChange: (v: string[]) => void; optionName?: string; hasError?: boolean; forceShowAllDuplicates?: boolean;
  colors?: Record<string, string>; onColorsChange?: (c: Record<string, string>) => void;
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const list = values.length ? values : [""];
  const lastIsFilled = list[list.length - 1]?.trim() !== "";
  const usedSet = new Set(list.filter(Boolean));
  const suggestions = (OPTION_SUGGESTIONS[optionName] || []).filter((s) => !usedSet.has(s));
  const norm = (s: string) => s.trim().toLowerCase();
  const groupsByValue = new Map<string, number[]>();
  list.forEach((v, i) => {
    if (v.trim() === "") return;
    const key = norm(v);
    const arr = groupsByValue.get(key) ?? [];
    arr.push(i);
    groupsByValue.set(key, arr);
  });
  const duplicateIndices = new Set<number>();
  const duplicateMessageIdx = new Set<number>();
  groupsByValue.forEach((idxs) => {
    if (idxs.length < 2) return;
    idxs.forEach((i) => duplicateIndices.add(i));
    duplicateMessageIdx.add(Math.max(...idxs));
  });
  const lastDuplicate = duplicateIndices.has(list.length - 1);
  const showDupState = (idx: number) => duplicateMessageIdx.has(idx) || (forceShowAllDuplicates && duplicateIndices.has(idx));

  /* لون فقط: بنحدد هل الاختيار الحالي هو "لون/Color" عشان نظهر سواتش
     اختيار اللون جنب كل قيمة. أي اسم اختيار تاني (زي المقاس) بيرجع
     الشكل العادي زي ما كان بالظبط. */
  const isColor = isColorOptionName(optionName);
  const colorMap = colors ?? {};
  const getColorFor = (val: string): string => {
    if (!val.trim()) return "#cccccc";
    const key = normalizeColorKey(val);
    return colorMap[key] ?? getPresetHex(val) ?? "#cccccc";
  };
  const setColorFor = (val: string, hex: string) => {
    if (!val.trim() || !onColorsChange) return;
    const key = normalizeColorKey(val);
    onColorsChange({ ...colorMap, [key]: hex });
  };

  const update = (idx: number, val: string) => {
    const next = [...list]; next[idx] = val;
    if (idx === next.length - 1 && val.trim() !== "") next.push("");
    onChange(next);
  };
  const remove = (idx: number) => {
    if (list.length === 1) { onChange([""]); return; }
    const next = list.filter((_, i) => i !== idx);
    onChange(next);
    setTimeout(() => inputRefs.current[Math.min(idx, next.length - 1)]?.focus(), 0);
  };
  const addRow = () => {
    if (!lastIsFilled || lastDuplicate) return;
    const next = [...list, ""];
    onChange(next);
    setTimeout(() => inputRefs.current[next.length - 1]?.focus(), 0);
  };

  return (
    <div>
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#8c9196", marginBottom: 5, fontWeight: 500 }}>Suggested:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {suggestions.map((s) => (
              <button key={s} type="button"
                onClick={() => {
                  const filled = list.filter(Boolean);
                  onChange([...filled, s, ""]);
                }}
                style={{ fontSize: 12, padding: "3px 10px", borderRadius: 99, border: "1px solid #c9cccf", background: "#f7f7f7", color: "#303030", cursor: "pointer", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {isColor && (
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: COLOR_PRESETS[s] ?? "#cccccc", border: "1px solid rgba(0,0,0,.15)", flexShrink: 0 }} />
                )}
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {list.map((val, idx) => (
          <div key={idx}>
            <div
              onDragEnter={(e) => { e.preventDefault(); if (dragIdx !== null && idx !== dragIdx) setOverIdx(idx); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx === null || dragIdx === idx) return;
                const n = [...list]; const [m] = n.splice(dragIdx, 1); n.splice(idx, 0, m);
                onChange(n); setDragIdx(null); setOverIdx(null);
              }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              style={{ display: "flex", alignItems: "center", gap: 8, opacity: dragIdx === idx ? 0.4 : 1, background: overIdx === idx ? "#f0f6ff" : "transparent", borderRadius: 6 }}>
              <span
                draggable
                onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
                style={{ display: "inline-flex" }}
              >
                <DragHandle />
              </span>
              <input ref={(el) => { inputRefs.current[idx] = el; }} value={val}
                onChange={(e) => update(idx, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); if (idx < list.length - 1) inputRefs.current[idx + 1]?.focus(); else if (val.trim()) addRow(); }
                  if (e.key === "Backspace" && val === "" && list.length > 1) { e.preventDefault(); remove(idx); }
                }}
                placeholder={idx === 0 ? "e.g. Value 1…" : "Add value…"}
                style={{
                  ...S.inp,
                  borderColor: showDupState(idx) || (hasError && idx === 0) ? "#d72c0d" : "#c9cccf",
                  boxShadow: showDupState(idx) || (hasError && idx === 0) ? "0 0 0 2px rgba(215,44,13,.15)" : "none",
                }}
              />
              {/* سواتش اختيار اللون — بيظهر بس لما اسم الاختيار يكون "لون".
                  بيتحط تلقائيًا على أقرب لون مطابق لاسم القيمة (لو Red/Blue..
                  إلخ)، ولو المستخدم داس عليه بيفتحله الـ color picker بتاع
                  المتصفح عشان يختار أي لون يحبه بحرية تامة. */}
              {isColor && val.trim() !== "" && (
                <input
                  type="color"
                  value={getColorFor(val)}
                  onChange={(e) => setColorFor(val, e.target.value)}
                  title="اختر لون يمثل هذه القيمة"
                  style={{ width: 30, height: 30, padding: 0, border: "1px solid #c9cccf", borderRadius: 6, cursor: "pointer", flexShrink: 0, background: "none" }}
                />
              )}
              <button type="button" onClick={() => remove(idx)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#8c9196", flexShrink: 0, padding: 4, display: "flex" }}>
                <TrashIcon />
              </button>
            </div>
            {showDupState(idx) && (
              <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 4, paddingLeft: 24 }}>⚠ This value has already been added.</div>
            )}
            {hasError && idx === 0 && !showDupState(idx) && (
              <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 4, paddingLeft: 24 }}>⚠ Add at least one value.</div>
            )}
          </div>
        ))}
      </div>
      <button onClick={addRow} type="button" disabled={!lastIsFilled || lastDuplicate}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: lastIsFilled && !lastDuplicate ? "pointer" : "default", color: lastIsFilled && !lastDuplicate ? "#458fff" : "#c4c4c4", fontSize: 13, fontWeight: 500, marginTop: 10, padding: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Add another value
      </button>
    </div>
  );
}

function OptionValuesEditorValidated(props: {
  values: string[]; onChange: (v: string[]) => void; optionName?: string; hasError?: boolean; forceShowAllDuplicates?: boolean;
  colors?: Record<string, string>; onColorsChange?: (c: Record<string, string>) => void;
}) {
  return <OptionValuesEditor {...props} />;
}

/* ─── EditOptionModal ────────────────────────────────────────────────────── */
function EditOptionModal({ option, existingNames, onSave, onCancel }: {
  option: VariantOption; existingNames: string[];
  onSave: (o: VariantOption) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(option.name);
  const [values, setValues] = useState<string[]>(option.values.length ? option.values : [""]);
  const [colors, setColors] = useState<Record<string, string>>(option.colors ?? {});
  const [nameError, setNameError] = useState("");
  const [valuesError, setValuesError] = useState(false);
  const [showAllDuplicates, setShowAllDuplicates] = useState(false);
  const [displayType, setDisplayType] = useState<VariantOption["displayType"]>(option.displayType || "buttons");

  const hasDuplicateValues = (() => {
    const seen = new Set<string>();
    for (const v of values) {
      const key = v.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  })();

  /* FIX: نفس مبدأ AddOptionForm — أي تبديل بين فئة "لون" وأي فئة تانية
     أثناء التعديل بيمسح القيم القديمة اللي مش منطقية للاسم الجديد ويرجّع
     الحقل فاضي. */
  const prevIsColorRef = useRef(isColorOptionName(name));
  useEffect(() => {
    const nowIsColor = isColorOptionName(name);
    if (nowIsColor !== prevIsColorRef.current) {
      setValues([""]);
      setColors({});
      setValuesError(false);
      setShowAllDuplicates(false);
    }
    prevIsColorRef.current = nowIsColor;
  }, [name]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>تعديل الخيار</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#8c9196" }}>×</button>
        </div>
        <div style={{ marginBottom: 16, padding: 14, background: "#f9fafb", border: "1px solid #e3e3e3", borderRadius: 8 }}>
          <label style={S.label}>Option name</label>
          <OptionNameInputValidated value={name} onChange={(v) => { setName(v); if (nameError) setNameError(""); }}
            existingNames={existingNames.filter((n) => n !== option.name)} hasError={!!nameError} />
          <div style={{ marginTop: 12 }}>
            <DisplayTypePicker value={displayType} onChange={setDisplayType} />
          </div>
          {nameError && <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 5 }}>⚠ {nameError}</div>}
          <div style={{ marginTop: 12 }}>
            <label style={S.label}>Option values</label>
            <OptionValuesEditorValidated values={values} onChange={(v) => { setValues(v); if (valuesError) setValuesError(false); if (showAllDuplicates) setShowAllDuplicates(false); }}
              optionName={name} hasError={valuesError} forceShowAllDuplicates={showAllDuplicates}
              colors={colors} onColorsChange={setColors} />
          </div>
          
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#fff", color: "#303030", border: "1px solid #c9cccf" }}>Cancel</button>
          <button onClick={() => {
            let hasErr = false;
            if (!name.trim()) { setNameError("Please select an option name. Must be 20 letters max."); hasErr = true; }
            else if (name.trim().length > 20) { setNameError("Must be 20 letters max."); hasErr = true; }
            const cleaned = values.map((v) => v.trim()).filter(Boolean);
            if (!cleaned.length) { setValuesError(true); hasErr = true; }
            if (hasDuplicateValues) { setShowAllDuplicates(true); hasErr = true; }
            if (hasErr) return;
            const cleanColors = (colors: Record<string,string>, values: string[]) => {
              const validKeys = new Set(values.map((v) => v.trim().toLowerCase()))
              return Object.fromEntries(Object.entries(colors).filter(([k]) => validKeys.has(k)))
            }

            onSave({ name: name.trim(), values: cleaned, colors: isColorOptionName(name) ? cleanColors(colors, cleaned) : undefined, displayType });
          }} style={{ padding: "8px 18px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#303030", color: "#fff", border: "none", fontWeight: 600 }}>Apply</button>
        </div>
      </div>
    </div>
  );
}


function SimpleSelectDropdown({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, openUp: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  const recalc = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const estimatedMenuHeight = Math.min(options.length * 42 + 8, 260);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimatedMenuHeight;
    setCoords({
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      openUp,
    });
  };

  const toggleOpen = () => {
    if (!open) recalc();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => recalc();
    const onClickOutside = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          display: "flex", alignItems: "center", width: "100%", gap: 8,
          padding: "7px 10px", fontSize: 14, fontWeight: 600, borderRadius: 7,
          background: "#fff", color: "#303030", cursor: "pointer",
          border: "1px solid",
          borderColor: open ? "#458fff" : hovering ? "#8fb8ff" : "#c9cccf",
          boxShadow: open ? "0 0 0 2px rgba(69,143,255,.15)" : "none",
          transition: "border-color .15s, box-shadow .15s",
        }}
      >
        <span style={{ flex: 1, textAlign: "left" }}>{current?.label || "—"}</span>
        <span style={{
          display: "flex", color: open ? "#458fff" : "#8c9196",
          transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            zIndex: 10050,
            top: coords.openUp ? undefined : coords.top,
            bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
            left: coords.left,
            width: coords.width,
            background: "#fff", borderRadius: 8,
            border: "1px solid #e3e3e3", overflow: "hidden",
            boxShadow: "0 10px 24px -6px rgba(0,0,0,.15), 0 2px 6px rgba(0,0,0,.06)",
          }}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", width: "100%", gap: 8,
                  padding: "9px 12px", fontSize: 13, fontWeight: 500, textAlign: "left",
                  background: isSelected ? "#f0f6ff" : "#fff", color: "#303030",
                  border: "none", borderTop: i > 0 ? "1px solid #f1f1f1" : "none", cursor: "pointer",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f6f6f7"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isSelected ? "#f0f6ff" : "#fff"; }}
              >
                <span style={{ flex: 1 }}>{opt.label}</span>
                {isSelected && (
                  <span style={{ color: "#458fff", display: "flex" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

const DISPLAY_TYPE_OPTIONS: { value: NonNullable<VariantOption["displayType"]>; label: string }[] = [
  { value: "buttons", label: "Buttons" },
  { value: "select", label: "Select" },
  { value: "tabs", label: "Tabs" },
];

function DisplayTypePicker({ value, onChange }: {
  value: VariantOption["displayType"];
  onChange: (v: NonNullable<VariantOption["displayType"]>) => void;
}) {
  const current = value || "buttons";
  return (
    <div>
      <label style={S.label}>Choose type</label>
      <SimpleSelectDropdown
        value={current}
        options={DISPLAY_TYPE_OPTIONS}
        onChange={(v) => onChange(v as NonNullable<VariantOption["displayType"]>)}
      />
    </div>
  );
}

/* ─── AddOptionForm ──────────────────────────────────────────────────────── */
function AddOptionForm({ onDone, onCancel, existingNames }: {
  onDone: (o: VariantOption) => void; onCancel: () => void; existingNames: string[];
}) {
  const [name, setName] = useState("");
  const [values, setValues] = useState<string[]>([""]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [nameError, setNameError] = useState("");
  const [valuesError, setValuesError] = useState(false);
  const [showAllDuplicates, setShowAllDuplicates] = useState(false);
  const [displayType, setDisplayType] = useState<VariantOption["displayType"]>("buttons");
  const hasDuplicateValues = (() => {
    const seen = new Set<string>();
    for (const v of values) {
      const key = v.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  })();

  /* FIX: لو بدّلت الاسم من "لون" لأي اسم تاني (أو العكس)، القيم القديمة
     (زي "احمر" اللي اتكتبت وقت ما كان الاختيار لون) كانت فاضلة في اللستة
     بعد التبديل رغم إنها مش منطقية للاسم الجديد (زي المقاس). دلوقتي أي
     تبديل بين فئة "لون" وأي فئة تانية بيمسح القيم ويرجّع الحقل فاضي من
     جديد تلقائيًا. */
  const prevIsColorRef = useRef(isColorOptionName(name));
  useEffect(() => {
    const nowIsColor = isColorOptionName(name);
    if (nowIsColor !== prevIsColorRef.current) {
      setValues([""]);
      setColors({});
      setValuesError(false);
      setShowAllDuplicates(false);
    }
    prevIsColorRef.current = nowIsColor;
  }, [name]);

  return (
    <div style={{ background: "#f9fafb", border: "1px solid #e3e3e3", borderRadius: 8, padding: 14 }}>
      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Option name</label>
        <OptionNameInputValidated value={name} onChange={(v) => { setName(v); if (nameError) setNameError(""); }}
          existingNames={existingNames} hasError={!!nameError} />
        {nameError && <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 5 }}>⚠ {nameError}</div>}
      </div>
      <div style={{ marginBottom: 14 }}>
        <DisplayTypePicker value={displayType} onChange={setDisplayType} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Option values</label>
        <OptionValuesEditorValidated values={values} onChange={(v) => { setValues(v); if (valuesError) setValuesError(false); if (showAllDuplicates) setShowAllDuplicates(false); }}
          optionName={name} hasError={valuesError} forceShowAllDuplicates={showAllDuplicates}
          colors={colors} onColorsChange={setColors} />
      </div>
      
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={onCancel} style={{ fontSize: 13, border: "none", background: "none", cursor: "pointer", fontWeight: 500, color: "#d72c0d" }}>Cancel</button>
        <button onClick={() => {
          let hasErr = false;
          if (!name.trim()) { setNameError("Please select an option name. Must be 20 letters max."); hasErr = true; }
          else if (name.trim().length > 20) { setNameError("Must be 20 letters max."); hasErr = true; }
          const cleaned = values.map((v) => v.trim()).filter(Boolean);
          if (!cleaned.length) { setValuesError(true); hasErr = true; }
          if (hasDuplicateValues) { setShowAllDuplicates(true); hasErr = true; }
          if (hasErr) return;
          onDone({ name: name.trim(), values: cleaned, colors: isColorOptionName(name) ? colors : undefined, displayType });
        }} style={{ padding: "6px 16px", fontSize: 13, fontWeight: 600, borderRadius: 7, cursor: "pointer", background: "#303030", color: "#fff", border: "none" }}>Done</button>
      </div>
    </div>
  );
}

/* ─── ApplyAllInput ──────────────────────────────────────────────────────── */
function ApplyAllInput({ value, onChange, onApply, type = "text", prefix }: {
  value: string; onChange: (v: string) => void; onApply: () => void; type?: string; prefix?: string;
}) {
  const isEmpty = value.trim() === "";
  return (
    <div style={{ display: "flex", alignItems: "stretch", border: "1px solid #c9cccf", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
      {prefix && <span style={{ padding: "0 9px", display: "flex", alignItems: "center", fontSize: 12, color: "#6d7175", borderRight: "1px solid #e3e3e3", background: "#f9fafb", whiteSpace: "nowrap" }}>{prefix}</span>}
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type}
        onKeyDown={(e) => { if (e.key === "Enter" && !isEmpty) onApply(); }}
        onFocus={(e) => e.currentTarget.select()} placeholder="—" min={type === "number" ? "0" : undefined}
        style={{ flex: 1, padding: "6px 8px", fontSize: 13, border: "none", outline: "none", background: "transparent", color: "#303030", width: 0, minWidth: 0 }} />
      <button type="button" onClick={() => { if (!isEmpty) onApply(); }} disabled={isEmpty}
        style={{ padding: "0 10px", fontSize: 12, fontWeight: 600, color: isEmpty ? "#c4c4c4" : "#458fff", background: "none", border: "none", borderLeft: "1px solid #e3e3e3", cursor: isEmpty ? "default" : "pointer", whiteSpace: "nowrap" }}>
        Apply all
      </button>
    </div>
  );
}

/* ─── MixedCell ──────────────────────────────────────────────────────────── */
function MixedCell({ prefix }: { prefix?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", border: "1px solid #e8e8e8", borderRadius: 7, overflow: "hidden", background: "#fafafa", height: 31 }}>
      {prefix && <span style={{ padding: "0 7px", fontSize: 12, color: "#c4c4c4", borderRight: "1px solid #e8e8e8", background: "#f3f3f3", whiteSpace: "nowrap", lineHeight: "31px" }}>{prefix}</span>}
      <span style={{ flex: 1, padding: "0 8px", fontSize: 11, color: "#bbb", fontStyle: "italic" }}>Mixed</span>
    </div>
  );
}

// suppress unused warning
void MixedCell;

/* ─── VariantTableModal ──────────────────────────────────────────────────── */
function VariantTableModal({ title, rows: initRows, pricingDefaults, onSave, onCancel }: {
  title: string; rows: VariantRow[]; pricingDefaults: VariantPriceDefaults;
  onSave: (rows: VariantRow[]) => void; onCancel: () => void;
}) {
  const [rows, setRows] = useState<VariantRow[]>(initRows.map((r) => ({ ...r })));
  const [applyPrice, setApplyPrice] = useState("");
  const [applySale, setApplySale] = useState("");
  const [applyCost, setApplyCost] = useState("");
  const [applyQty, setApplyQty] = useState("");
  const [applySku, setApplySku] = useState("");

  const updRow = (idx: number, field: keyof VariantRow, val: unknown) =>
    setRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], [field]: val }; return n; });
  const applyAll = (field: "price" | "salePrice" | "cost" | "quantity" | "sku", rawVal: string) =>
    setRows((prev) => prev.map((r) => ({ ...r, [field]: field === "quantity" ? parseInt(rawVal) || 0 : rawVal })));

  const colHdr: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#6d7175", padding: "7px 10px", background: "#f9fafb", borderBottom: "1px solid #e3e3e3", textAlign: "left", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.04em" };
  const applyHdr: React.CSSProperties = { padding: "5px 8px", background: "#f9fafb", borderBottom: "1px solid #ddd" };
  const cell: React.CSSProperties = { padding: "5px 8px", borderBottom: "1px solid #f1f1f1", verticalAlign: "middle" };

  const priceCell = (val: string, onChange: (v: string) => void, hasError: boolean | undefined, fallback: string | undefined) => (
    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${hasError ? "#d72c0d" : "#c9cccf"}`, borderRadius: 6, overflow: "hidden" }}>
      <span style={{ padding: "0 9px", fontSize: 12, color: "#6d7175", borderRight: "1px solid #e3e3e3", background: "#f9fafb", whiteSpace: "nowrap", lineHeight: "32px" }}>EGP</span>
      <input
        value={val}
        onChange={(e) => handlePriceChange(e.target.value, fallback, onChange)}
        onFocus={(e) => e.currentTarget.select()}
        type="text" inputMode="decimal" placeholder="0.00"
        style={{ flex: 1, padding: "6px 8px", fontSize: 13, border: "none", outline: "none", background: "transparent", color: "#303030", minWidth: 0, width: 0 }}
      />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "40px 16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 1120, boxShadow: "0 8px 40px rgba(0,0,0,.18)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #e3e3e3" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#303030" }}>{title}</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#8c9196", lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...colHdr, minWidth: 110 }}>Options</th>
                <th style={{ ...colHdr, minWidth: 150 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>Original Price
                    <button onClick={() => setRows((prev) => prev.map((r) => ({ ...r, salePrice: "" })))}
                      style={{ fontSize: 11, color: "#458fff", background: "none", border: "none", cursor: "pointer", fontWeight: 500, padding: "0 2px" }}>Reset</button>
                  </span>
                </th>
                <th style={{ ...colHdr, minWidth: 150 }}>Price</th>
                <th style={{ ...colHdr, minWidth: 150 }}>تكلفة المنتج</th>
                <th style={{ ...colHdr, minWidth: 150 }}>QTY</th>
                <th style={{ ...colHdr, minWidth: 150 }}>تعريف</th>
              </tr>
              <tr>
                <td style={{ ...applyHdr, fontSize: 11, color: "#8c9196", fontStyle: "italic", paddingLeft: 10 }}>Apply to all</td>
                <td style={applyHdr}><ApplyAllInput value={applySale} onChange={(v) => setApplySale(sanitizePriceTyping(v))} type="text" prefix="EGP" onApply={() => { applyAll("salePrice", applySale); setApplySale(""); }} /></td>
                <td style={applyHdr}><ApplyAllInput value={applyPrice} onChange={(v) => setApplyPrice(sanitizePriceTyping(v))} type="text" prefix="EGP" onApply={() => { applyAll("price", applyPrice); setApplyPrice(""); }} /></td>
                <td style={applyHdr}><ApplyAllInput value={applyCost} onChange={(v) => setApplyCost(sanitizePriceTyping(v))} type="text" prefix="EGP" onApply={() => { applyAll("cost", applyCost); setApplyCost(""); }} /></td>
                <td style={applyHdr}><ApplyAllInput value={applyQty} onChange={setApplyQty} type="number" onApply={() => { applyAll("quantity", applyQty); setApplyQty(""); }} /></td>
                <td style={applyHdr}><ApplyAllInput value={applySku} onChange={setApplySku} onApply={() => { applyAll("sku", applySku); setApplySku(""); }} /></td>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const priceInvalid = !isValidPositivePrice(row.price) || variantPriceExceedsOriginal(row);
                const saleInvalid = !isValidPositivePrice(row.salePrice);
                return (
                <tr key={idx} onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")} onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}>
                  <td style={{ ...cell, fontWeight: 600, fontSize: 12, color: "#303030" }}>{row.combination.join(" / ")}</td>
                  <td style={cell}>{priceCell(row.salePrice, (v) => updRow(idx, "salePrice", v), saleInvalid, pricingDefaults.salePrice)}</td>
                  <td style={cell}>{priceCell(row.price, (v) => updRow(idx, "price", v), priceInvalid, pricingDefaults.price)}</td>
                  <td style={cell}>{priceCell(row.cost, (v) => updRow(idx, "cost", v), false, pricingDefaults.cost)}</td>
                  <td style={cell}>
                    <input value={row.quantity} onChange={(e) => updRow(idx, "quantity", parseInt(e.target.value) || 0)}
                      type="number" min="0" placeholder="0" onFocus={(e) => e.currentTarget.select()}
                      style={{ display: "block", width: "100%", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, padding: "6px 8px", outline: "none", color: "#303030", background: "#fff", boxSizing: "border-box" }} />
                  </td>
                  <td style={cell}>
                    <input value={row.sku} onChange={(e) => updRow(idx, "sku", e.target.value)}
                      placeholder="-" onFocus={(e) => e.currentTarget.select()}
                      style={{ display: "block", width: "100%", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, padding: "6px 8px", outline: "none", color: "#303030", background: "#fff", boxSizing: "border-box" }} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #e3e3e3" }}>
          <button onClick={() => {
            const hasErr = rows.some(variantPriceMismatch);
            if (hasErr) return;
            onSave(rows);
          }} style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 7, cursor: "pointer", background: "#1a9c3e", color: "#fff", border: "none" }}>Save changes</button>
          <button onClick={onCancel} style={{ padding: "8px 16px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#fff", color: "#303030", border: "1px solid #c9cccf" }}>Discard</button>
        </div>
      </div>
    </div>
  );
}

function BulkEditModal({ variants, pricingDefaults, onSave, onCancel }: { variants: VariantRow[]; pricingDefaults: VariantPriceDefaults; onSave: (rows: VariantRow[]) => void; onCancel: () => void }) {
  return <VariantTableModal title="Bulk Edit" rows={variants} pricingDefaults={pricingDefaults} onSave={onSave} onCancel={onCancel} />;
}

function EditSelectedModal({ selectedRows, pricingDefaults, onSave, onCancel }: { selectedRows: VariantRow[]; pricingDefaults: VariantPriceDefaults; onSave: (rows: VariantRow[]) => void; onCancel: () => void }) {
  return <VariantTableModal title={`Edit selected (${selectedRows.length})`} rows={selectedRows} pricingDefaults={pricingDefaults} onSave={onSave} onCancel={onCancel} />;
}


/* ─── VariantEditModal ───────────────────────────────────────────────────── */
function VariantEditModal({ variant, pricingDefaults, onSave, onCancel, onPickImage }: {
  variant: VariantRow; pricingDefaults: VariantPriceDefaults; onSave: (row: VariantRow) => void; onCancel: () => void;
  onPickImage: (file: File, cb: (img: ProductImage) => void) => void;
}) {
  const [row, setRow] = useState<VariantRow>({ ...variant });
  const upd = (field: keyof VariantRow, val: unknown) => setRow((r) => ({ ...r, [field]: val }));

  const priceInvalid = !isValidPositivePrice(row.price) || variantPriceExceedsOriginal(row);
  const saleInvalid = !isValidPositivePrice(row.salePrice);

  const priceInput = (val: string, onChange: (v: string) => void, placeholder = "0.00", hasError: boolean | undefined, fallback: string | undefined) => (
    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${hasError ? "#d72c0d" : "#c9cccf"}`, borderRadius: 7, overflow: "hidden" }}>
      <span style={{ padding: "0 8px", fontSize: 12, color: "#6d7175", borderRight: "1px solid #e3e3e3", background: "#f9fafb", whiteSpace: "nowrap" }}>{CURRENCY_SYMBOL}</span>
      <input
        value={val}
        onChange={(e) => handlePriceChange(e.target.value, fallback, onChange)}
        onFocus={(e) => e.currentTarget.select()}
        type="text" inputMode="decimal" placeholder={placeholder}
        style={{ flex: 1, padding: "6px 8px", fontSize: 13, border: "none", outline: "none", background: "transparent", color: "#303030" }}
      />
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,.18)", direction: "rtl" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>تعديل: {row.combination.join(" / ")}</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#8c9196" }}>×</button>
        </div>
        <div style={{ marginBottom: 14 }}><label style={S.label}>الصورة</label><SmallImagePicker image={row.image} onPickFile={(f) => onPickImage(f, (img) => upd("image", img))} onRemove={() => upd("image", null)} /></div>
        <div style={{ marginBottom: 14 }}>
          <label style={S.label}>السعر الأصلي (قبل الخصم)</label>
          {priceInput(row.salePrice, (v) => upd("salePrice", v), "السعر الأصلي", saleInvalid, pricingDefaults.salePrice)}
        </div>
        <div style={{ marginBottom: 14 }}><label style={S.label}>السعر</label>{priceInput(row.price, (v) => upd("price", v), "0.00", priceInvalid, pricingDefaults.price)}</div>
          {variantPriceExceedsOriginal(row) && (
            <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 5 }}>
              ⚠ السعر لازم يكون أصغر من أو يساوي السعر الأصلي
            </div>
          )}
        <div style={{ marginBottom: 14 }}><label style={S.label}>تكلفة المنتج</label>{priceInput(row.cost, (v) => upd("cost", v), "0.00", false, pricingDefaults.cost)}</div>
        <div style={{ marginBottom: 14 }}><label style={S.label}>الكمية</label><input type="number" min="0" value={row.quantity} onChange={(e) => upd("quantity", parseInt(e.target.value) || 0)} placeholder="0" style={{ ...S.inp, fontSize: 13, width: 100 }} /></div>
        <div style={{ marginBottom: 14 }}><label style={S.label}>تعريف</label><input value={row.sku} onChange={(e) => upd("sku", e.target.value)} style={S.inp} placeholder="-" /></div>
        <div style={{ marginBottom: 14 }}><label style={S.label}>الباركود</label><input value={row.barcode || ""} onChange={(e) => upd("barcode", e.target.value)} style={S.inp} placeholder="-" /></div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", fontWeight: 600, color: "#303030" }}>
            <Toggle checked={row.active} onChange={(v) => upd("active", v)} /> نشط
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, paddingTop: 12, borderTop: "1px solid #f1f1f1" }}>
          <button onClick={() => { if (priceInvalid || saleInvalid) return; onSave(row); }} style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 7, cursor: "pointer", background: "#303030", color: "#fff", border: "none" }}>حفظ</button>
          <button onClick={onCancel} style={{ padding: "8px 16px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#fff", color: "#303030", border: "1px solid #c9cccf" }}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

/* ─── VariantsTable ──────────────────────────────────────────────────────── */
function VariantsTable({ variants, options, onChange, onAddImage, pricingDefaults }: {
  variants: VariantRow[]; options: VariantOption[];
  onChange: (rows: VariantRow[]) => void;
  onAddImage: (file: File, cb: (img: ProductImage) => void) => void;
  pricingDefaults: VariantPriceDefaults;
  onFirstGroupPriceChange?: (price: string | null) => void;
}) {
  const [showBulk, setShowBulk] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showEditSelected, setShowEditSelected] = useState(false);

  const allChecked = selected.size === variants.length && variants.length > 0;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(variants.map((_, i) => i)));
  const toggleOne = (idx: number) => setSelected((prev) => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const updateRow = (idx: number, field: keyof VariantRow, val: unknown) => { const next = [...variants]; next[idx] = { ...next[idx], [field]: val }; onChange(next); };

  const colHdr: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#6d7175", padding: "10px 10px", background: "#f9fafb", borderBottom: "1px solid #e3e3e3", textAlign: "left", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.04em" };
  const cell: React.CSSProperties = { padding: "10px 5px", borderBottom: "1px solid #f1f1f1", verticalAlign: "middle" };

  const priceCellInput = (val: string, onChangeFn: (v: string) => void, hasError: boolean | undefined, fallback: string | undefined) => (
    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${hasError ? "#d72c0d" : "#c9cccf"}`, borderRadius: 7, overflow: "hidden" }}>
      <span style={{ padding: "8px 8px", fontSize: 12, color: "#6d7175", borderRight: "1px solid #e3e3e3", background: "#fff", whiteSpace: "nowrap" }}>{CURRENCY_SYMBOL}</span>
      <input
        value={val}
        onChange={(e) => handlePriceChange(e.target.value, fallback, onChangeFn)}
        onFocus={(e) => e.currentTarget.select()}
        type="text" inputMode="decimal" placeholder="0.00"
        style={{ flex: 1, padding: "6px 8px", fontSize: 13, border: "none", outline: "none", background: "#fff", color: "#303030", width: 65, minWidth: 65 }}
      />
    </div>
  );

  const renderRow = (row: VariantRow, idx: number) => {
    const displayName = row.combination.join("، ") || "—";
    const priceInvalid = !isValidPositivePrice(row.price) || variantPriceExceedsOriginal(row);
    const saleInvalid = !isValidPositivePrice(row.salePrice);
    return (
      <tr key={row.combination.join("|") || idx} style={{ background: selected.has(idx) ? "#f0f6ff" : "#fff", transition: "background .1s" }}
        onMouseEnter={(e) => { if (!selected.has(idx)) e.currentTarget.style.background = "#f8f9fa"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = selected.has(idx) ? "#f0f6ff" : "#fff"; }}>
        <td style={{ ...cell, padding: "8px 12px" }} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected.has(idx)} onChange={() => toggleOne(idx)} style={{ cursor: "pointer", width: 15, height: 15 }} />
        </td>
        <td style={cell} onClick={(e) => e.stopPropagation()}>
          <SmallImagePicker image={row.image} onPickFile={(f) => onAddImage(f, (img) => updateRow(idx, "image", img))} onRemove={() => updateRow(idx, "image", null)} />
        </td>
        <td style={{ ...cell, fontSize: 14, fontWeight: 600, color: "#303030", paddingLeft: 10 }}>{displayName}</td>
        <td style={cell} onClick={(e) => e.stopPropagation()}>{priceCellInput(row.salePrice, (v) => updateRow(idx, "salePrice", v), saleInvalid, pricingDefaults.salePrice)}</td>
        <td style={cell} onClick={(e) => e.stopPropagation()}>{priceCellInput(row.price, (v) => updateRow(idx, "price", v), priceInvalid, pricingDefaults.price)}</td>
        <td style={cell} onClick={(e) => e.stopPropagation()}>{priceCellInput(row.cost, (v) => updateRow(idx, "cost", v), false, pricingDefaults.cost)}</td>
        <td style={cell} onClick={(e) => e.stopPropagation()}>
          <input value={row.quantity} type="number" min="0" placeholder="0" onChange={(e) => updateRow(idx, "quantity", parseInt(e.target.value) || 0)} onFocus={(e) => e.currentTarget.select()} style={{ ...S.inp, fontSize: 13, width: 55, textAlign: "center" }} />
        </td>
        <td style={cell} onClick={(e) => e.stopPropagation()}>
          <input value={row.sku} onChange={(e) => updateRow(idx, "sku", e.target.value)} style={{ ...S.inp, fontSize: 13 }} placeholder="-" />
        </td>
        <td style={{ ...cell, textAlign: "center" }} onClick={(e) => e.stopPropagation()}><Toggle checked={row.active} onChange={(v) => updateRow(idx, "active", v)} /></td>
        <td style={{ ...cell, textAlign: "center" }}><IconBtn onClick={() => setEditingIdx(idx)} title="تعديل"><EditIcon /></IconBtn></td>
      </tr>
    );
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#303030" }}>{variants.length} Variants</span>
          {selected.size > 0 && (
            <button onClick={() => setShowEditSelected(true)} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer", borderRadius: 7, padding: "4px 10px", fontWeight: 600, background: "#303030", color: "#fff", border: "none" }}>
              <EditIcon /> Edit selected ({selected.size})
            </button>
          )}
        </div>
        <button onClick={() => setShowBulk(true)} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, cursor: "pointer", borderRadius: 7, padding: "5px 10px", fontWeight: 500, border: "none", background: "none", color: "#458fff" }}>
          <EditIcon /> Bulk Edit
        </button>
      </div>
      <div style={{ border: "1px solid #e3e3e3", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...colHdr, width: 36, padding: "10px 12px" }}><input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ cursor: "pointer", width: 15, height: 15 }} /></th>
                <th style={{ ...colHdr, width: 44 }}></th>
                <th style={colHdr}>اسم</th><th style={colHdr}>السعر الأصلي</th><th style={colHdr}>سعر</th>
                <th style={colHdr}>تكلفة المنتج</th>
                <th style={colHdr}>الكمية</th><th style={colHdr}>تعريف</th>
                <th style={{ ...colHdr, textAlign: "center" }}>نشط</th><th style={{ ...colHdr, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>{variants.map((row, idx) => renderRow(row, idx))}</tbody>
          </table>
        </div>
      </div>
      {showBulk && <BulkEditModal variants={variants} pricingDefaults={pricingDefaults} onSave={(rows) => { onChange(rows); setShowBulk(false); }} onCancel={() => setShowBulk(false)} />}
      {editingIdx !== null && <VariantEditModal variant={variants[editingIdx]} pricingDefaults={pricingDefaults} onSave={(row) => { onChange(variants.map((v, i) => (i === editingIdx ? row : v))); setEditingIdx(null); }} onCancel={() => setEditingIdx(null)} onPickImage={onAddImage} />}
      {showEditSelected && <EditSelectedModal selectedRows={variants.filter((_, i) => selected.has(i))} pricingDefaults={pricingDefaults} onSave={(rows) => { const arr = [...selected].sort((a, b) => a - b); const next = [...variants]; rows.forEach((r, ri) => { next[arr[ri]] = r; }); onChange(next); setShowEditSelected(false); setSelected(new Set()); }} onCancel={() => setShowEditSelected(false)} />}
    </>
  );
}

/* ─── VariantsSection (exported) ────────────────────────────────────────── */
function VariantsSection({ options, variants, onOptionsChange, onVariantsChange, onAddImage, allImages, pricingDefaults, onFirstGroupPriceChange }: {
  options: VariantOption[]; variants: VariantRow[]; allImages: ProductImage[];
  onOptionsChange: (opts: VariantOption[], vars: VariantRow[]) => void;
  onVariantsChange: (vars: VariantRow[]) => void;
  onAddImage: (file: File, cb: (img: ProductImage) => void) => void;
  pricingDefaults: VariantPriceDefaults;
  onFirstGroupPriceChange?: (price: string | null) => void;
}) {
  const [addingNew, setAddingNew] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overDragIdx, setOverDragIdx] = useState<number | null>(null);
  const setOptions = (next: VariantOption[]) => onOptionsChange(next, syncVariants(next, variants, pricingDefaults));
  const canAddMore = options.length < PRESET_OPTION_NAMES.length;

  // suppress unused warning
  void allImages;

  return (
    <div>
      <span style={S.sectionTitle}>Options & Variants</span>
      <div style={{ border: "1px solid #e3e3e3", borderRadius: 10, marginBottom: 16, overflow: "visible", position: "relative" }}>
        {options.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6d7175", padding: "10px 16px", background: "#f9fafb", borderBottom: "1px solid #e3e3e3", textTransform: "uppercase", letterSpacing: "0.04em", borderRadius: "10px 10px 0 0" }}>Options</div>
            {options.map((opt, idx) => (
              <div key={opt.name || `opt-${idx}`} draggable
                onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnter={(e) => { e.preventDefault(); if (dragIdx !== null && idx !== dragIdx) setOverDragIdx(idx); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx) return; const next = [...options]; const [m] = next.splice(dragIdx, 1); next.splice(idx, 0, m); setOptions(next); setDragIdx(null); setOverDragIdx(null); }}
                onDragEnd={() => { setDragIdx(null); setOverDragIdx(null); }}
                onClick={() => setEditingIdx(idx)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: idx > 0 ? "1px solid #f1f1f1" : "none", opacity: dragIdx === idx ? 0.4 : 1, background: overDragIdx === idx ? "#f0f6ff" : "#fff", cursor: "pointer", transition: "background .15s" }}>
                <span onClick={(e) => e.stopPropagation()}><DragHandle /></span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#303030", minWidth: 52, flexShrink: 0 }}>{opt.name || "—"}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, flex: 1 }}>
                  {opt.values.filter(Boolean).map((v) => (
                    <span key={v} style={{ padding: "3px 10px", fontSize: 12, fontWeight: 500, borderRadius: 99, border: "1px solid #d9d9d9", color: "#303030", background: "#f7f7f7", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {isColorOptionName(opt.name) && (
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: opt.colors?.[normalizeColorKey(v)] ?? getPresetHex(v) ?? "#cccccc", border: "1px solid rgba(0,0,0,.15)", flexShrink: 0 }} />
                      )}
                      {v}
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  <IconBtn onClick={(e) => { e.stopPropagation(); setEditingIdx(idx); }} title="تعديل"><EditIcon /></IconBtn>
                  <IconBtn onClick={(e) => { e.stopPropagation(); setOptions(options.filter((_, i) => i !== idx)); }} danger title="حذف"><TrashIcon /></IconBtn>
                </div>
              </div>
            ))}
          </>
        )}
        {addingNew && (
          <div style={{ padding: 14, borderTop: options.length > 0 ? "1px solid #e3e3e3" : "none" }}>
            <AddOptionForm onDone={(opt) => { setOptions([...options, opt]); setAddingNew(false); }} onCancel={() => setAddingNew(false)} existingNames={options.map((o) => o.name)} />
          </div>
        )}
        {!addingNew && canAddMore && (
          <div style={{ padding: "10px 16px", background: options.length > 0 ? "#fafafa" : "#fff", borderTop: options.length > 0 ? "1px solid #f1f1f1" : "none", borderRadius: options.length > 0 ? "0 0 10px 10px" : 10 }}>
            <button onClick={() => setAddingNew(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#458fff", fontSize: 13, fontWeight: 500, padding: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              أضف خيارًا آخر
            </button>
          </div>
        )}
      </div>
      {variants.length > 0 && <VariantsTable key={options.map((o) => o.name).join("|")} variants={variants} options={options} onChange={onVariantsChange} onAddImage={onAddImage} pricingDefaults={pricingDefaults} onFirstGroupPriceChange={onFirstGroupPriceChange} />}
      {editingIdx !== null && <EditOptionModal option={options[editingIdx]} existingNames={options.map((o) => o.name)} onSave={(opt) => { const next = [...options]; next[editingIdx] = opt; setOptions(next); setEditingIdx(null); }} onCancel={() => setEditingIdx(null)} />}
    </div>
  );
}

/* ─── TagsInput ──────────────────────────────────────────────────────────── */
function TagsInput({ tags, onChange, localAllTags, onLocalAllTagsChange }: {
  tags: Tag[]; onChange: (tags: Tag[]) => void;
  localAllTags: Tag[]; onLocalAllTagsChange: (tags: Tag[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { rect, recalc } = useDropdownPosition(open, ref);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selectedIds = new Set(tags.map((t) => t.id));
  const filtered = localAllTags.filter((t) => !selectedIds.has(t.id) && (!query || t.name.toLowerCase().includes(query.toLowerCase())));
  const showCreate = query.trim() !== "" && !localAllTags.find((t) => t.name.toLowerCase() === query.trim().toLowerCase());
  const openDrop = () => { recalc(); setOpen(true); };
  const addTag = (e: React.MouseEvent, tag: Tag) => { e.preventDefault(); onChange([...tags, tag]); setQuery(""); setTimeout(recalc, 0); };
  const removeTag = (id: string) => onChange(tags.filter((t) => t.id !== id));
  const createAndAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    const n: Tag = { id: newPendingId(), name: query.trim(), _pending: true };
    onLocalAllTagsChange([...localAllTags, n]);
    onChange([...tags, n]);
    setQuery(""); setTimeout(recalc, 0);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={() => { inputRef.current?.focus(); openDrop(); }}
        style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 36, padding: 6, borderRadius: 8, cursor: "text", alignItems: "center", border: `1px solid ${open ? "#458fff" : "#c9cccf"}`, background: "#fff", boxShadow: open ? "0 0 0 2px rgba(69,143,255,.2)" : "none" }}>
        {tags.map((tag) => (
          <span key={tag.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5, background: "#f1f1f1", border: "1px solid #d9d9d9", fontSize: 13, color: "#303030" }}>
            {tag.name}
            <button onMouseDown={(e) => { e.preventDefault(); removeTag(tag.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#8c9196", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); openDrop(); }} onFocus={openDrop}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !query && tags.length) removeTag(tags[tags.length - 1].id);
            if (e.key === "Enter" && query.trim()) {
              e.preventDefault();
              if (showCreate) createAndAdd(e as unknown as React.MouseEvent);
              else if (filtered.length > 0) { onChange([...tags, filtered[0]]); setQuery(""); setTimeout(recalc, 0); }
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={tags.length ? "" : "Add tags…"}
          style={{ flex: 1, minWidth: 80, border: "none", outline: "none", fontSize: 13, background: "transparent", color: "#303030", fontFamily: "inherit" }} />
      </div>
      {open && rect && (
        <div style={{ ...S.drop, top: rect.bottom + 4, left: rect.left, width: rect.width }}>
          {filtered.map((t) => (
            <button key={t.id} onMouseDown={(e) => addTag(e, t)} style={S.dropItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>{t.name}</button>
          ))}
          {showCreate && (
            <button onMouseDown={createAndAdd} style={{ ...S.dropItem, color: "#458fff", borderTop: filtered.length > 0 ? "1px solid #f1f1f1" : "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>+ Create "{query.trim()}"</button>
          )}
          {filtered.length === 0 && !showCreate && (
            <div style={{ padding: "12px", fontSize: 13, color: "#8c9196", textAlign: "center" }}>No tags found</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── CollectionsInput ───────────────────────────────────────────────────── */
function CollectionsInput({ collections, onChange, localAllCollections, onLocalAllCollectionsChange }: {
  collections: Collection[]; onChange: (v: Collection[]) => void;
  localAllCollections: Collection[]; onLocalAllCollectionsChange: (v: Collection[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { rect, recalc } = useDropdownPosition(open, ref);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selectedIds = new Set(collections.map((c) => c.id));
  const filtered = localAllCollections.filter((c) => !selectedIds.has(c.id) && (!query || c.name.toLowerCase().includes(query.toLowerCase())));
  const showCreate = query.trim() !== "" && !localAllCollections.find((c) => c.name.toLowerCase() === query.trim().toLowerCase());
  const openDrop = () => { recalc(); setOpen(true); };
  const addCollection = (e: React.MouseEvent, c: Collection) => { e.preventDefault(); onChange([...collections, c]); setQuery(""); setTimeout(recalc, 0); };
  const removeCollection = (id: string) => onChange(collections.filter((c) => c.id !== id));
  const createAndAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    const n: Collection = { id: newPendingId(), name: query.trim(), _pending: true };
    onLocalAllCollectionsChange([...localAllCollections, n]);
    onChange([...collections, n]);
    setQuery(""); setTimeout(recalc, 0);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={() => { inputRef.current?.focus(); openDrop(); }}
        style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 36, padding: 6, borderRadius: 8, cursor: "text", alignItems: "center", border: `1px solid ${open ? "#458fff" : "#c9cccf"}`, background: "#fff", boxShadow: open ? "0 0 0 2px rgba(69,143,255,.2)" : "none" }}>
        {collections.map((c) => (
          <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5, background: "#f1f1f1", border: "1px solid #d9d9d9", fontSize: 13, color: "#303030" }}>
            {c.name}
            <button onMouseDown={(e) => { e.preventDefault(); removeCollection(c.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#8c9196", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); openDrop(); }} onFocus={openDrop}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !query && collections.length) removeCollection(collections[collections.length - 1].id);
            if (e.key === "Enter" && query.trim()) {
              e.preventDefault();
              if (showCreate) createAndAdd(e as unknown as React.MouseEvent);
              else if (filtered.length > 0) { onChange([...collections, filtered[0]]); setQuery(""); setTimeout(recalc, 0); }
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={collections.length ? "" : "Add to collection…"}
          style={{ flex: 1, minWidth: 80, border: "none", outline: "none", fontSize: 13, background: "transparent", color: "#303030", fontFamily: "inherit" }} />
      </div>
      {open && rect && (
        <div style={{ ...S.drop, top: rect.bottom + 4, left: rect.left, width: rect.width }}>
          {filtered.map((c) => (
            <button key={c.id} onMouseDown={(e) => addCollection(e, c)} style={S.dropItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>{c.name}</button>
          ))}
          {showCreate && (
            <button onMouseDown={createAndAdd} style={{ ...S.dropItem, color: "#458fff", borderTop: filtered.length > 0 ? "1px solid #f1f1f1" : "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>+ Create "{query.trim()}"</button>
          )}
          {filtered.length === 0 && !showCreate && (
            <div style={{ padding: "12px", fontSize: 13, color: "#8c9196", textAlign: "center" }}>No collections found</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── ProductTypeInput ───────────────────────────────────────────────────── */
function ProductTypeInput({ selectedType, onChange, localTypes, onLocalTypesChange }: {
  selectedType: ProductType | null; onChange: (v: ProductType | null) => void;
  localTypes: ProductType[]; onLocalTypesChange: (types: ProductType[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { rect, recalc } = useDropdownPosition(open, ref);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = localTypes.filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase()));
  const showCreate = query.trim() !== "" && !localTypes.find((t) => t.name.toLowerCase() === query.trim().toLowerCase());
  const openDrop = () => { recalc(); setOpen(true); };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={() => { inputRef.current?.focus(); openDrop(); }}
        style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 36, padding: 6, borderRadius: 8, cursor: "text", alignItems: "center", border: `1px solid ${open ? "#458fff" : "#c9cccf"}`, background: "#fff", boxShadow: open ? "0 0 0 2px rgba(69,143,255,.2)" : "none" }}>
        {selectedType && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5, background: "#f1f1f1", border: "1px solid #d9d9d9", fontSize: 13, color: "#303030" }}>
            {selectedType.name}
            <button onMouseDown={(e) => { e.preventDefault(); onChange(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#8c9196", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        )}
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); openDrop(); }} onFocus={openDrop}
          placeholder={selectedType ? "" : "Search or create…"}
          style={{ flex: 1, minWidth: 80, border: "none", outline: "none", fontSize: 13, background: "transparent", color: "#303030", fontFamily: "inherit" }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      </div>
      {open && rect && (
        <div style={{ ...S.drop, top: rect.bottom + 4, left: rect.left, width: rect.width }}>
          {filtered.map((t) => (
            <button key={t.id} onMouseDown={(e) => { e.preventDefault(); onChange(t); setQuery(""); setOpen(false); }}
              style={{ ...S.dropItem, background: selectedType?.id === t.id ? "#f0f6ff" : "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = selectedType?.id === t.id ? "#f0f6ff" : "none")}>{t.name}</button>
          ))}
          {showCreate && (
            <button onMouseDown={(e) => {
              e.preventDefault();
              const n: ProductType = { id: newPendingId(), name: query.trim(), _pending: true };
              onLocalTypesChange([...localTypes, n]); onChange(n); setQuery(""); setOpen(false);
            }} style={{ ...S.dropItem, color: "#458fff", borderTop: filtered.length > 0 ? "1px solid #f1f1f1" : "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>+ Create "{query.trim()}"</button>
          )}
          {filtered.length === 0 && !showCreate && (
            <div style={{ padding: "12px", fontSize: 13, color: "#8c9196", textAlign: "center" }}>No types found</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── CategoryPicker ─────────────────────────────────────────────────────── */
const LEAF_CATEGORIES = new Set(["Gift Cards", "Uncategorized", "Bundles"]);

function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { rect, recalc } = useDropdownPosition(open, ref);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const openDrop = () => { recalc(); setParent(null); setSearch(""); setOpen(true); };
  const filtered = parent
    ? CATEGORY_TREE[parent] || []
    : TOP_CATEGORIES.filter((c) => c.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={openDrop} style={{ ...S.inp, display: "flex", alignItems: "center", cursor: "pointer", color: value ? "#303030" : "#6d7175" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="2" style={{ marginRight: 6, flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{value || "Search categories"}</span>
      </div>
      {open && rect && (
        <div style={{ ...S.drop, top: rect.bottom + 4, left: rect.left, width: rect.width, maxHeight: 280 }}>
          {!parent ? (
            <div style={{ padding: "8px 8px 4px" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", borderRadius: 6, border: "1px solid #e3e3e3", background: "#f1f1f1" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="2" style={{ marginRight: 6 }}>
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories"
                  style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, flex: 1 }} />
              </div>
            </div>
          ) : (
            <button onClick={() => setParent(null)}
              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid #e3e3e3", cursor: "pointer", fontSize: 13, color: "#303030", fontWeight: 500 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Back
            </button>
          )}
          <div style={{ overflowY: "auto", maxHeight: 220 }}>
            {filtered.map((cat) => {
              // فئة رئيسية (مش جوه submenu) ومش من الفئات اللي بتتختار مباشرة → تفتح submenu
              const isDrillable = !parent && !LEAF_CATEGORIES.has(cat) && CATEGORY_TREE[cat]?.length > 0;
              return (
                <button key={cat} onClick={() => { if (isDrillable) setParent(cat); else { onChange(cat); setOpen(false); } }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 14px", background: "none", border: "none", borderTop: "1px solid #f1f1f1", cursor: "pointer", fontSize: 13, color: "#303030", textAlign: "left" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                  <span>{cat}</span>
                  {isDrillable && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>}
                </button>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: "16px", fontSize: 13, color: "#8c9196", textAlign: "center" }}>No results</div>}
          </div>
        </div>
      )}
    </div>
  );
}

interface LinkModalState { show: boolean; url: string; text: string; }
interface VideoModalState { show: boolean; url: string; }

/* ─── RichTextEditor ─────────────────────────────────────────────────────── */
export function RichTextEditor({ value, onChange, onUploadingChange }: { value: string; onChange: (v: string) => void; onUploadingChange?: (n: number) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [codeView, setCodeView] = useState(false);
  const [htmlValue, setHtmlValue] = useState(value);
  const [blockType, setBlockType] = useState("p");
  const [linkModal, setLinkModal] = useState<LinkModalState>({ show: false, url: "", text: "" });
  const [videoModal, setVideoModal] = useState<VideoModalState>({ show: false, url: "" });
  const [colorPicker, setColorPicker] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const codePreRef = useRef<HTMLPreElement>(null);
  const codeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumsRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastSyncedValueRef = useRef<string>(value);
  /* عداد الصور اللي لسه بترفع على R2 جوه الوصف — بنبلغ الأب (ProductForm)
     بيه عشان يمنع الحفظ لحد ما الرفع يخلص، بالظبط زي ما بيحصل مع صور المنتج
     وصور الفارينت. */
  const uploadingCountRef = useRef(0);
  const bumpUploading = (delta: number) => {
    uploadingCountRef.current = Math.max(0, uploadingCountRef.current + delta);
    onUploadingChange?.(uploadingCountRef.current);
  };

  const forceRepaint = () => {
    const el = wrapperRef.current;
    if (!el) return;
    el.style.transform = "translateZ(0)";
    void el.offsetHeight;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!el) return;
        el.style.transform = "";
        void el.offsetHeight;
      });
    });
  };

  const escHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const findTagEnd = (code: string, from: number): number => {
    let i = from + 1, inD = false, inS = false;
    while (i < code.length) {
      const c = code[i];
      if (!inS && c === '"') { inD = !inD; }
      else if (!inD && c === "'") { inS = !inS; }
      else if (!inD && !inS && c === ">") return i;
      i++;
    }
    return -1;
  };

  const colorizeTag = (raw: string): string => {
    if (raw.startsWith("<!--"))
      return `<span style="color:#6a9955">${escHtml(raw)}</span>`;
    if (/^<!doctype/i.test(raw))
      return `<span style="color:#569cd6">${escHtml(raw)}</span>`;
    const m = raw.match(/^(<\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?>)$/);
    if (!m) return `<span style="color:#808080">${escHtml(raw)}</span>`;
    const [, slash, tag, attrStr, close] = m;
    const coloredAttrs = attrStr.replace(
      /(\s+)([\w:-]+)(?:(=)(?:"([^"]*)")|(?:=)(?:'([^']*)'))?/g,
      (_, sp, name, eq, dq, sq) => {
        if (eq !== undefined) {
          const val = dq ?? sq ?? "";
          return `${sp}<span style="color:#9cdcfe">${name}</span>` +
            `<span style="color:#d4d4d4">=</span>` +
            `<span style="color:#ce9178">"${escHtml(val)}"</span>`;
        }
        return `${sp}<span style="color:#9cdcfe">${name}</span>`;
      }
    );
    return (
      `<span style="color:#808080">${escHtml(slash)}</span>` +
      `<span style="color:#4ec9b0">${tag}</span>` +
      coloredAttrs +
      `<span style="color:#808080">${escHtml(close)}</span>`
    );
  };

  const highlightHtml = (code: string): string => {
    let out = "", i = 0;
    while (i < code.length) {
      if (code[i] === "<") {
        if (code.startsWith("<!--", i)) {
          const end = code.indexOf("-->", i + 4);
          const slice = end === -1 ? code.slice(i) : code.slice(i, end + 3);
          out += colorizeTag(slice);
          i += slice.length;
        } else {
          const end = findTagEnd(code, i);
          if (end === -1) { out += escHtml(code.slice(i)); break; }
          out += colorizeTag(code.slice(i, end + 1));
          i = end + 1;
        }
      } else {
        const nxt = code.indexOf("<", i);
        const text = nxt === -1 ? code.slice(i) : code.slice(i, nxt);
        out += escHtml(text);
        i += text.length;
      }
    }
    return out;
  };

  const formatHtml = (html: string): string => {
    const VOID   = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
    const INLINE = new Set(["a","abbr","b","bdi","bdo","br","cite","code","data","dfn","em","i","kbd","mark","q","rp","rt","ruby","s","samp","small","span","strong","sub","sup","time","u","var","wbr"]);
    type Tok = { kind: "tag" | "text" | "comment"; val: string };
    const tokens: Tok[] = [];
    let i = 0;
    while (i < html.length) {
      if (html[i] === "<") {
        if (html.startsWith("<!--", i)) {
          const e = html.indexOf("-->", i + 4);
          const s = e === -1 ? html.slice(i) : html.slice(i, e + 3);
          tokens.push({ kind: "comment", val: s });
          i += s.length;
        } else {
          const e = findTagEnd(html, i);
          if (e === -1) { tokens.push({ kind: "text", val: html.slice(i) }); break; }
          tokens.push({ kind: "tag", val: html.slice(i, e + 1) });
          i = e + 1;
        }
      } else {
        const nxt = html.indexOf("<", i);
        const text = (nxt === -1 ? html.slice(i) : html.slice(i, nxt)).trim();
        if (text) tokens.push({ kind: "text", val: text });
        i += nxt === -1 ? html.length - i : nxt - i;
      }
    }
    let indent = 0;
    const blockStack: string[] = [];
    const lines: string[] = [];
    for (const tok of tokens) {
      if (tok.kind !== "tag") {
        lines.push("  ".repeat(indent) + tok.val);
        continue;
      }
      const isClose  = tok.val.startsWith("</");
      const tagName  = (tok.val.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/) || [])[1]?.toLowerCase() ?? "";
      const isSelf   = tok.val.endsWith("/>") || VOID.has(tagName);
      const isInline = INLINE.has(tagName);
      const isDoctype = /^<!doctype/i.test(tok.val);
      if (isDoctype || isSelf || isInline) {
        lines.push("  ".repeat(indent) + tok.val);
      } else if (isClose) {
        if (blockStack.length && blockStack[blockStack.length - 1] === tagName) {
          blockStack.pop();
          indent = Math.max(0, indent - 1);
        }
        lines.push("  ".repeat(indent) + tok.val);
      } else {
        lines.push("  ".repeat(indent) + tok.val);
        blockStack.push(tagName);
        indent++;
      }
    }
    return lines.join("\n");
  };

  const syncCodeScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    if (codePreRef.current) { codePreRef.current.scrollTop = t.scrollTop; codePreRef.current.scrollLeft = t.scrollLeft; }
    if (lineNumsRef.current) lineNumsRef.current.scrollTop = t.scrollTop;
  };

  const [activeFormats, setActiveFormats] = useState({
    bold: false, italic: false, underline: false, strikeThrough: false,
    justifyLeft: false, justifyCenter: false, justifyRight: false, justifyFull: false,
    insertUnorderedList: false, insertOrderedList: false,
  });

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current); }
  };

  const cleanHtml = (html: string) =>
    html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(ul|ol|div|p)[^>]*>(\s|&nbsp;)*<\/\1>/gi, "").trim();

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    syncValue();
    setTimeout(updateToolbarState, 0);
  };

  const syncValue = () => {
    if (!editorRef.current) return;
    const isEmpty = (editorRef.current.textContent || "").trim() === "" && !editorRef.current.querySelector("img,video,iframe");
    if (isEmpty) {
      if (editorRef.current.innerHTML !== "<p><br></p>") {
        editorRef.current.innerHTML = "<p><br></p>";
        const range = document.createRange();
        range.selectNodeContents(editorRef.current);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setBlockType("p");
      lastSyncedValueRef.current = "";
      onChange("");
      return;
    }
    const cleaned = cleanHtml(editorRef.current.innerHTML);
    lastSyncedValueRef.current = cleaned;
    onChange(cleaned);
};

  const detectBlockType = (): string => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return "p";
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1) { const tag = (node as HTMLElement).tagName.toLowerCase(); if (["h1", "h2", "h3", "blockquote", "p"].includes(tag)) return tag; }
      node = node.parentNode;
    }
    return "p";
  };

  const updateToolbarState = useCallback(() => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor || !editorRef.current.contains(anchor)) return;
    try {
      setActiveFormats({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strikeThrough: document.queryCommandState("strikeThrough"),
        justifyLeft: document.queryCommandState("justifyLeft"),
        justifyCenter: document.queryCommandState("justifyCenter"),
        justifyRight: document.queryCommandState("justifyRight"),
        justifyFull: document.queryCommandState("justifyFull"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        insertOrderedList: document.queryCommandState("insertOrderedList"),
      });
    } catch { /* ignore detached selection errors */ }
    setBlockType(detectBlockType());
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", updateToolbarState);
    return () => document.removeEventListener("selectionchange", updateToolbarState);
  }, [updateToolbarState]);

  const handleFocus = () => {
    document.execCommand("defaultParagraphSeparator", false, "p");
    if (editorRef.current && (editorRef.current.textContent || "").trim() === "" && !editorRef.current.querySelector("img,video,iframe")) {
      editorRef.current.innerHTML = "<p><br></p>";
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges(); sel?.addRange(range);
      setBlockType("p");
    }
  };

  /* One-time: paint the initial value into the DOM on mount. */
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Re-sync whenever `value` changes from OUTSIDE the editor itself
     (Discard, loading an existing product, programmatic resets, ...). */
    useEffect(() => {
    if (value === lastSyncedValueRef.current) return;
    if (editorRef.current) editorRef.current.innerHTML = value;
    setHtmlValue(formatHtml(value));
    lastSyncedValueRef.current = value;
  }, [value]);

  const applyBlockType = (type: string) => {
    setBlockType(type);
    restoreRange();
    editorRef.current?.focus();
    document.execCommand("formatBlock", false, type);
    syncValue();
    setTimeout(updateToolbarState, 0);
  };

  const insertLink = () => { saveRange(); const sel = window.getSelection(); setLinkModal({ show: true, url: "", text: sel?.toString() || "" }); };
  const confirmLink = () => {
    restoreRange(); editorRef.current?.focus();
    if (linkModal.text && !window.getSelection()?.toString()) {
      document.execCommand("insertHTML", false, `<a href="${linkModal.url}" target="_blank" style="color:#458fff;text-decoration:underline">${linkModal.text}</a>`);
    } else {
      document.execCommand("createLink", false, linkModal.url);
      editorRef.current?.querySelectorAll("a")?.forEach((a) => { a.target = "_blank"; a.style.color = "#458fff"; });
    }
    syncValue(); setLinkModal({ show: false, url: "", text: "" });
  };

  /**
   * FIX (صور الوصف مش بتتحفظ): كانت الدالة دي بترسم صورة بـ blob: URL محلي
   * فقط وما كانتش بترفعها على R2 خالص، رغم إن uploadToR2 متعرفة ومستوردة
   * أصلاً في نفس الملف. رابط blob: مرتبط بالجلسة الحالية للمتصفح فقط —
   * بمجرد ما تقفل الصفحة أو تعمل reload، الرابط بيموت والصورة تختفي من
   * الوصف تمامًا (سواء وقت العرض في المتجر أو وقت فتح صفحة التعديل تاني).
   * دلوقتي بنرفع الصورة فعليًا على R2 فور اختيارها، مع placeholder شفاف
   * شوية لحد ما الرفع يخلص، وبنبلغ الأب بعدد الصور اللي لسه بترفع عشان
   * يمنع الحفظ في الوقت ده (زي صور المنتج وصور الفارينت بالظبط).
   */
  const insertImage = (file: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return;
    if (file.size > MAX_IMAGE_SIZE) return;

    const localUrl = URL.createObjectURL(file);
    const tempId = `up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    editorRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      `<img src="${localUrl}" alt="${file.name}" data-uploading="${tempId}" style="max-width:100%;border-radius:6px;margin:4px 0;opacity:.5" />`
    );
    syncValue();

    bumpUploading(1);
    uploadToR2(file, 'products')
      .then(({ url }) => {
        const img = editorRef.current?.querySelector(`img[data-uploading="${tempId}"]`) as HTMLImageElement | null;
        if (img) {
          img.src = url;
          img.style.opacity = "1";
          img.removeAttribute("data-uploading");
        }
        syncValue();
      })
      .catch(() => {
        const img = editorRef.current?.querySelector(`img[data-uploading="${tempId}"]`) as HTMLImageElement | null;
        if (img) {
          img.style.outline = "2px solid #d72c0d";
          img.removeAttribute("data-uploading");
        }
      })
      .finally(() => {
        bumpUploading(-1);
      });
  };

  const insertVideo = () => { saveRange(); setVideoModal({ show: true, url: "" }); };
  const confirmVideo = () => {
    restoreRange(); editorRef.current?.focus();
    const url = videoModal.url.trim();
    let embedHtml = "";
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      const id = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1];
      if (id) embedHtml = `<div style="margin:8px 0"><iframe width="560" height="315" src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen style="max-width:100%;border-radius:8px"></iframe></div>`;
    } else if (url.match(/\.(mp4|webm|ogg)$/i)) {
      embedHtml = `<div style="margin:8px 0"><video controls style="max-width:100%;border-radius:8px"><source src="${url}" /></video></div>`;
    } else {
      embedHtml = `<div style="margin:8px 0"><iframe src="${url}" frameborder="0" allowfullscreen style="max-width:100%;width:560px;height:315px;border-radius:8px"></iframe></div>`;
    }
    document.execCommand("insertHTML", false, embedHtml);
    syncValue(); setVideoModal({ show: false, url: "" });
  };

  const sanitizePastedHtml = (html: string): string => {
    const BLOCKED = new Set(["font-size", "font-family", "line-height", "mso-font-size", "mso-line-height", "mso-font-family", "background", "background-color", "background-image", "mso-background", "mso-highlight"]);
    const normStyle = (s: string) => s.split(";").map((p) => p.trim()).filter((p) => { const prop = p.split(":")[0]?.trim().toLowerCase() || ""; return prop && !BLOCKED.has(prop); }).join("; ");
    return html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|meta|link|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<(script|style|meta|link)[^>]*>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "")
      .replace(/\sclass="[^"]*"/gi, "").replace(/\sclass='[^']*'/gi, "")
      .replace(/\s(bgcolor|background)="[^"]*"/gi, "").replace(/\s(bgcolor|background)='[^']*'/gi, "")
      .replace(/\sstyle="([^"]*)"/gi, (_, s) => { const c = normStyle(s); return c ? ` style="${c}"` : ""; })
      .replace(/\sstyle='([^']*)'/gi, (_, s) => { const c = normStyle(s); return c ? ` style='${c}'` : ""; })
      .trim();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    editorRef.current?.focus();
    if (html) document.execCommand("insertHTML", false, sanitizePastedHtml(html));
    else if (text) document.execCommand("insertText", false, text);
    syncValue(); setTimeout(updateToolbarState, 0);
  };

  const COLORS = ["#000000", "#303030", "#d72c0d", "#e67e22", "#f1c40f", "#1a9c3e", "#3498db", "#9b59b6", "#e91e63", "#ffffff", "#888888", "#c0392b", "#d35400", "#f39c12", "#27ae60", "#2980b9", "#8e44ad", "#ff5722"];

  const toolbarBtn = (onAction: () => void, title: string, active?: boolean, children?: React.ReactNode) => (
    <button type="button" title={title} tabIndex={-1}
      onMouseDown={(e) => { e.preventDefault(); onAction(); }}
      style={{ padding: "3px 6px", fontSize: 13, background: active ? "#e8f0fe" : "none", border: active ? "1px solid #b8d4ff" : "1px solid transparent", cursor: "pointer", borderRadius: 4, color: active ? "#458fff" : "#303030", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 26, height: 26, transition: "background .12s", outline: "none" }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "#f1f1f1"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "none"; }}>
      {children}
    </button>
  );

  const Divider = () => <div style={{ width: 1, height: 18, background: "#e3e3e3", margin: "0 2px", flexShrink: 0 }} />;

  return (
    <div ref={wrapperRef} style={{ border: "1px solid #c9cccf", borderRadius: 7, overflow: "visible", position: "relative", background: "#fff", isolation: "isolate" }}>
      {/* Toolbar */}
      <div data-rte-toolbar style={{ borderBottom: "1px solid #e3e3e3", background: "#f9fafb", borderRadius: "7px 7px 0 0" }}>
        {/* Row 1 */}
        <div style={{ display: "flex", alignItems: "center", gap: 1, padding: "4px 6px", flexWrap: "wrap" }}>
          <select value={blockType} onMouseDown={() => saveRange()} onChange={(e) => applyBlockType(e.target.value)}
            style={{ fontSize: 12, border: "1px solid #d9d9d9", borderRadius: 4, padding: "2px 6px", background: "#fff", cursor: "pointer", color: "#303030", marginRight: 4, height: 26, outline: "none" }}>
            <option value="p">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="blockquote">Quote</option>
          </select>
          <Divider />
          {toolbarBtn(() => exec("bold"), "Bold", activeFormats.bold, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /></svg>)}
          {toolbarBtn(() => exec("italic"), "Italic", activeFormats.italic, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></svg>)}
          {toolbarBtn(() => exec("underline"), "Underline", activeFormats.underline, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" /><line x1="4" y1="21" x2="20" y2="21" /></svg>)}
          {/* Color picker */}
          <div style={{ position: "relative" }}>
            {toolbarBtn(() => { saveRange(); setColorPicker((p) => !p); }, "Font Color", colorPicker,
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>A</span>
                <span style={{ width: 13, height: 3, background: "#d72c0d", borderRadius: 1, marginTop: 1 }} />
              </span>)}
            {colorPicker && (
              <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 9999, background: "#fff", border: "1px solid #e3e3e3", borderRadius: 8, padding: 8, boxShadow: "0 4px 16px rgba(0,0,0,.15)", display: "grid", gridTemplateColumns: "repeat(9, 20px)", gap: 3, marginTop: 4 }}>
                {COLORS.map((c) => (
                  <button key={c} type="button" title={c} tabIndex={-1}
                    onMouseDown={(e) => { e.preventDefault(); restoreRange(); exec("foreColor", c); setColorPicker(false); }}
                    style={{ width: 20, height: 20, borderRadius: 3, background: c, border: c === "#ffffff" ? "1px solid #ccc" : "none", cursor: "pointer", outline: "none" }} />
                ))}
              </div>
            )}
          </div>
          <Divider />
          {toolbarBtn(() => exec("justifyLeft"), "Align Left", activeFormats.justifyLeft, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg>)}
          {toolbarBtn(() => exec("justifyCenter"), "Center", activeFormats.justifyCenter, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>)}
          {toolbarBtn(() => exec("justifyRight"), "Align Right", activeFormats.justifyRight, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></svg>)}
          {toolbarBtn(() => exec("justifyFull"), "Justify", activeFormats.justifyFull, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>)}
          <Divider />
          {toolbarBtn(insertLink, "Insert Link", false, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>)}
          {toolbarBtn(() => imageInputRef.current?.click(), "Insert Image", false, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>)}
          <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ""; }} />
          {toolbarBtn(insertVideo, "Insert Video", false, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>)}
          <Divider />
          {toolbarBtn(() => exec("strikeThrough"), "Strikethrough", activeFormats.strikeThrough, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" y1="12" x2="20" y2="12" /></svg>)}
          {toolbarBtn(() => exec("removeFormat"), "Clear Formatting", false, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M13 4 8 20" /><line x1="22" y1="2" x2="2" y2="22" /></svg>)}
          <div style={{ marginLeft: "auto" }}>
            {toolbarBtn(() => {
              if (!codeView) {
                setHtmlValue(formatHtml(value));
              } else {
                const safeHtml = sanitizePastedHtml(htmlValue);
                if (editorRef.current) editorRef.current.innerHTML = safeHtml;
                const cleaned = cleanHtml(safeHtml);
                lastSyncedValueRef.current = cleaned;
                onChange(cleaned);
              }
              setCodeView((p) => !p);
              forceRepaint();
            }, "HTML Code View", codeView, <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>)}
          </div>
        </div>
        {/* Row 2 — lists */}
        <div style={{ display: "flex", alignItems: "center", gap: 1, padding: "3px 6px 4px", borderTop: "1px solid #f0f0f0" }}>
          {toolbarBtn(() => exec("insertUnorderedList"), "Bullet List", activeFormats.insertUnorderedList, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></svg>)}
          {toolbarBtn(() => exec("insertOrderedList"), "Numbered List", activeFormats.insertOrderedList, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></svg>)}
          {toolbarBtn(() => exec("indent"), "Indent", false, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /><polyline points="7 10 11 12 7 14" /><line x1="11" y1="12" x2="21" y2="12" /></svg>)}
          {toolbarBtn(() => exec("outdent"), "Outdent", false, <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /><polyline points="11 10 7 12 11 14" /><line x1="7" y1="12" x2="21" y2="12" /></svg>)}
        </div>
      </div>

      {/* Editor area */}
      <div style={{ display: codeView ? "none" : "block" }}>
        <div key="visual-editor" ref={editorRef} contentEditable suppressContentEditableWarning
          onInput={syncValue} onKeyUp={syncValue} onMouseUp={syncValue} onFocus={handleFocus} onPaste={handlePaste}
          style={{ height: 200, overflowY: "auto", overflowX: "hidden", resize: "none", padding: "12px 14px", outline: "none", fontSize: 15, lineHeight: 1.75, color: "#242424", background: "#fff", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif', wordBreak: "break-word", overflowWrap: "break-word" }}
        />
      </div>

      {codeView && (
        <div key="code-view" style={{ borderRadius: "0 0 7px 7px", overflow: "hidden", background: "#1e1e1e" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "#252526", borderBottom: "1px solid #333" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#569cd6", fontFamily: "monospace", letterSpacing: "0.06em" }}>HTML</span>
            <span style={{ flex: 1 }} />
            <button type="button" tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); setHtmlValue((v) => formatHtml(v)); }}
              style={{ fontSize: 11, padding: "2px 9px", borderRadius: 4, background: "#333", color: "#9cdcfe", border: "1px solid #444", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>
              ⇥ Format
            </button>
            <button type="button" tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                const safeHtml = sanitizePastedHtml(htmlValue);
                if (editorRef.current) editorRef.current.innerHTML = safeHtml;
                const cleaned = cleanHtml(safeHtml);
                lastSyncedValueRef.current = cleaned;
                onChange(cleaned);
                setCodeView(false);
                forceRepaint();
              }}
              style={{ fontSize: 11, padding: "2px 9px", borderRadius: 4, background: "#1a9c3e", color: "#fff", border: "none", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>
              ✓ Apply
            </button>
          </div>
          <div style={{ display: "flex", height: 380 }}>
            <div ref={lineNumsRef} style={{ width: 44, padding: "12px 6px 12px 0", fontSize: 13, fontFamily: "'Cascadia Code','Fira Code',Consolas,monospace", lineHeight: 1.6, color: "#4a4a4a", textAlign: "right", background: "#1e1e1e", userSelect: "none", overflowY: "hidden", flexShrink: 0, boxSizing: "border-box", borderRight: "1px solid #2d2d2d" }}>
              {htmlValue.split("\n").map((_, i) => (
                <div key={i} style={{ paddingRight: 8 }}>{i + 1}</div>
              ))}
            </div>
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
              <pre ref={codePreRef}
                style={{ position: "absolute", inset: 0, margin: 0, padding: "12px 12px 12px 10px", fontSize: 13, fontFamily: "'Cascadia Code','Fira Code',Consolas,monospace", lineHeight: 1.6, color: "#d4d4d4", background: "transparent", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowY: "scroll", overflowX: "hidden", pointerEvents: "none", boxSizing: "border-box" }}
                dangerouslySetInnerHTML={{ __html: highlightHtml(htmlValue) + "\n" }}
              />
              <textarea ref={codeTextareaRef} value={htmlValue}
                onChange={(e) => setHtmlValue(e.target.value)}
                onScroll={syncCodeScroll}
                spellCheck={false} autoCorrect="off" autoCapitalize="off"
                style={{ position: "absolute", inset: 0, padding: "12px 12px 12px 10px", fontSize: 13, fontFamily: "'Cascadia Code','Fira Code',Consolas,monospace", lineHeight: 1.6, color: "transparent", caretColor: "#fff", background: "transparent", border: "none", outline: "none", resize: "none", width: "100%", height: "100%", boxSizing: "border-box", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowY: "scroll", overflowX: "hidden" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "3px 10px 3px 54px", background: "#007acc", fontSize: 11, color: "#fff", fontFamily: "monospace" }}>
            <span>Lines: {htmlValue.split("\n").length}</span>
            <span>Chars: {htmlValue.length}</span>
          </div>
        </div>
      )}

      {/* Link Modal */}
      {linkModal.show && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setLinkModal({ show: false, url: "", text: "" }); }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 400, boxShadow: "0 8px 40px rgba(0,0,0,.18)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Insert Link</h3>
              <button onClick={() => setLinkModal({ show: false, url: "", text: "" })} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#8c9196" }}>×</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>URL</label>
              <input value={linkModal.url} onChange={(e) => setLinkModal((p) => ({ ...p, url: e.target.value }))} placeholder="https://example.com" autoFocus style={{ ...S.inp }} onKeyDown={(e) => { if (e.key === "Enter") confirmLink(); }} />
            </div>
            {!window.getSelection()?.toString() && (
              <div style={{ marginBottom: 14 }}>
                <label style={S.label}>Link Text</label>
                <input value={linkModal.text} onChange={(e) => setLinkModal((p) => ({ ...p, text: e.target.value }))} placeholder="Click here" style={{ ...S.inp }} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setLinkModal({ show: false, url: "", text: "" })} style={{ padding: "7px 16px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#fff", color: "#303030", border: "1px solid #c9cccf" }}>Cancel</button>
              <button onClick={confirmLink} disabled={!linkModal.url.trim()} style={{ padding: "7px 16px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#458fff", color: "#fff", border: "none", fontWeight: 600, opacity: linkModal.url.trim() ? 1 : 0.5 }}>Insert</button>
            </div>
          </div>
        </div>
      )}

      {/* Video Modal */}
      {videoModal.show && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setVideoModal({ show: false, url: "" }); }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 420, boxShadow: "0 8px 40px rgba(0,0,0,.18)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Insert Video</h3>
              <button onClick={() => setVideoModal({ show: false, url: "" })} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#8c9196" }}>×</button>
            </div>
            <div style={{ marginBottom: 6 }}>
              <label style={S.label}>Video URL</label>
              <input value={videoModal.url} onChange={(e) => setVideoModal((p) => ({ ...p, url: e.target.value }))} placeholder="https://youtube.com/watch?v=… or .mp4 URL" autoFocus style={{ ...S.inp }} onKeyDown={(e) => { if (e.key === "Enter") confirmVideo(); }} />
            </div>
            <p style={{ fontSize: 12, color: "#8c9196", margin: "0 0 14px" }}>Supports YouTube, direct .mp4/.webm links</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setVideoModal({ show: false, url: "" })} style={{ padding: "7px 16px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#fff", color: "#303030", border: "1px solid #c9cccf" }}>Cancel</button>
              <button onClick={confirmVideo} disabled={!videoModal.url.trim()} style={{ padding: "7px 16px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#458fff", color: "#fff", border: "none", fontWeight: 600, opacity: videoModal.url.trim() ? 1 : 0.5 }}>Insert</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

/* ─── MediaSection ───────────────────────────────────────────────────────── */
function MediaSection({ images, onChange }: { images: ProductImage[]; onChange: (updater: ProductImage[] | ((prev: ProductImage[]) => ProductImage[])) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileDragCounter = useRef(0);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  /**
   * FIX (رفع عدة صور مع بعض — بعض الصور بتفضل "لودينج" من غير ما ترفع
   * فعليًا): كان كل استدعاء لـ onChange بعد ما رفعة تخلص بيتحسب بناءً على
   * imagesRef.current، وده كان بيتحدث بس بعد ما الـ useEffect يشتغل —
   * يعني فيه فجوة توقيت بين لحظة ما onChange بتتنادى ولحظة ما imagesRef
   * فعليًا بيعكس آخر تحديث.
   *
   * لو صورتين خلصوا رفع قريب جدًا من بعض:
   *  1) صورة A تخلص → onChange(imagesRef.current.map(...)) → الـ state
   *     يتحدث بصورة A، لكن imagesRef لسه القديمة (الـ effect لسه ما
   *     اشتغلش).
   *  2) صورة B تخلص فورًا بعدها → بتحسب الـ array بتاعها من imagesRef
   *     القديمة (اللي متعرفش حاجة عن تحديث A) → onChange(newArray) ده
   *     بيرجع يمسح (overwrite) تحديث A بالكامل.
   *  3) النتيجة: صورة A تفضل uploading:true للأبد رغم إنها اترفعت فعليًا
   *     على R2 بنجاح.
   *
   * الحل: onChange بقى بيقبل "updater function" زي setState(prev => ...)
   * بدل array جاهز — كده كل تحديث بيتراكم فوق أحدث state فعليًا وقت
   * التنفيذ (setForm((f) => ...)) مش وقت إنشاء الـ closure، ومفيش أي
   * فرصة لتحديث يمسح تحديث تاني مهما كان توقيت انتهاء كل رفعة.
   */
  const removeImage = (index: number) => {
    onChange((prev) => prev.filter((_, i) => i !== index));
  };

  const process = useCallback((files: File[]) => {
    const errs: string[] = [];
    const placeholders: ProductImage[] = [];
    files.forEach((file) => {
      const isImg = ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVid = file.type === "video/mp4";
      if (!isImg && !isVid) { errs.push(`"${file.name}" — نوع الملف غير مسموح به. المسموح: .png, .jpg, .mp4`); return; }
      if (isImg && file.size > MAX_IMAGE_SIZE) { errs.push(`"${file.name}" — الصورة تتجاوز الحد الأقصى (10 ميجا)`); return; }
      if (isVid && file.size > MAX_VIDEO_SIZE) { errs.push(`"${file.name}" — الفيديو يتجاوز الحد الأقصى (50 ميجا)`); return; }
      placeholders.push({ url: URL.createObjectURL(file), alt: file.name, file, type: isVid ? "video" : "image", uploading: true });
    });
    setErrors(errs);
    if (placeholders.length === 0) return;

    onChange((prev) => [...prev, ...placeholders]);

    placeholders.forEach((ph) => {
      uploadToR2(ph.file as File, 'products')
        .then(({ url, key }) => {
          onChange((prev) => prev.map((img) =>
            img.url === ph.url ? { url, key, alt: ph.alt, type: ph.type, uploading: false } : img
          ));
        })
        .catch(() => {
          onChange((prev) => prev.map((img) =>
            img.url === ph.url ? { ...img, uploading: false, uploadError: true } : img
          ));
        });
    });
  }, [onChange]);

  const onZoneDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); fileDragCounter.current++; if (e.dataTransfer.types.includes("Files")) setIsDraggingFile(true); };
  const onZoneDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); fileDragCounter.current--; if (fileDragCounter.current === 0) setIsDraggingFile(false); };
  const onZoneDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const onZoneDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingFile(false); fileDragCounter.current = 0; process(Array.from(e.dataTransfer.files)); };

  const onThumbDragStart = (e: React.DragEvent, idx: number) => {
    setDraggingIdx(idx); e.dataTransfer.effectAllowed = "move";
    const ghost = document.createElement("div"); ghost.style.cssText = "position:fixed;top:-200px;width:1px;height:1px;"; document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0); setTimeout(() => document.body.removeChild(ghost), 0);
  };
  const onThumbDragEnter = (e: React.DragEvent, idx: number) => { e.preventDefault(); if (draggingIdx !== null && idx !== draggingIdx) setOverIdx(idx); };
  const onThumbDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onThumbDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault(); if (draggingIdx === null || draggingIdx === dropIdx) return;
    const r = [...images]; const [m] = r.splice(draggingIdx, 1); r.splice(dropIdx, 0, m);
    onChange(r); setDraggingIdx(null); setOverIdx(null);
  };
  const onThumbDragEnd = () => { setDraggingIdx(null); setOverIdx(null); };

  return (
    <div>
      <label style={S.label}>الوسائط</label>
      {errors.map((err, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#fff4f4", border: "1px solid #ffc9c9", borderRadius: 7, marginBottom: 4, fontSize: 12, color: "#d72c0d" }}>
          <span>⚠ {err}</span>
          <button onClick={() => setErrors((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#d72c0d", fontSize: 16, padding: "0 2px" }}>×</button>
        </div>
      ))}
      <div onDragEnter={onZoneDragEnter} onDragLeave={onZoneDragLeave} onDragOver={onZoneDragOver} onDrop={onZoneDrop}
        onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${isDraggingFile ? "#458fff" : "#c9cccf"}`, borderRadius: 10, padding: "32px 20px", textAlign: "center", background: isDraggingFile ? "#f0f6ff" : "#fafafa", cursor: "pointer", transition: "all .2s", position: "relative" }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: isDraggingFile ? "#d6e8ff" : "#f1f1f1", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", transition: "background .2s" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isDraggingFile ? "#458fff" : "#6d7175"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: isDraggingFile ? "#458fff" : "#303030", marginBottom: 4 }}>
          {isDraggingFile ? "أفلِت الملفات هنا" : "اسحب الصور أو الفيديو وأفلِتها هنا، أو انقر لاختيارها"}
        </div>
        <div style={{ fontSize: 12, color: "#6d7175", lineHeight: 1.7 }}>
          <span>الحجم الأقصى: <strong>10 ميجا</strong> (صور), <strong>50 ميجا</strong> (فيديو)</span><br />
          <span>الأنواع المسموحة: <strong>.png, .jpg, .mp4</strong></span>
        </div>
        {isDraggingFile && <div style={{ position: "absolute", inset: 0, borderRadius: 10, background: "rgba(69,143,255,.06)", pointerEvents: "none" }} />}
      </div>
      <input ref={fileRef} type="file" multiple accept=".png,.jpg,.webp,.jpeg,.mp4,image/png,image/webp,image/jpeg,video/mp4" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) process(Array.from(e.target.files)); e.target.value = ""; }} />
      {images.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "#8c9196", marginTop: 12, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" />
              <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" />
            </svg>
            اسحب الصور لإعادة الترتيب — الأولى هي الصورة المميزة
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {images.map((img, index) => (
              <div key={img.url + index} draggable
                onDragStart={(e) => onThumbDragStart(e, index)}
                onDragEnter={(e) => onThumbDragEnter(e, index)}
                onDragOver={onThumbDragOver}
                onDrop={(e) => onThumbDrop(e, index)}
                onDragEnd={onThumbDragEnd}
                style={{ width: 110, height: 110, borderRadius: 8, overflow: "hidden", position: "relative", border: overIdx === index ? "2px dashed #458fff" : `2px solid ${index === 0 ? "#303030" : "#e3e3e3"}`, background: "#f1f1f1", flexShrink: 0, cursor: "grab", opacity: draggingIdx === index ? 0.35 : 1, transform: overIdx === index && draggingIdx !== index ? "scale(1.04)" : "scale(1)", transition: "opacity .15s, transform .15s, border-color .15s" }}>
                <div style={{ position: "absolute", top: 5, left: 5, zIndex: 2, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, opacity: 0.7, pointerEvents: "none" }}>
                  {[0, 1, 2, 3].map((d) => <div key={d} style={{ width: 3, height: 3, borderRadius: "50%", background: "#fff", boxShadow: "0 0 2px rgba(0,0,0,.6)" }} />)}
                </div>
                {img.type === "video"
                  ? <video src={img.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
                  : <img src={img.url} alt={img.alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  {img.uploading && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#458fff" strokeWidth="2" style={{ animation: "spin .8s linear infinite" }}>
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    </div>
                  )}
                  {img.uploadError && (
                    <div style={{ position: "absolute", bottom: 5, left: 5, right: 5, background: "#d72c0d", color: "#fff", fontSize: 10, borderRadius: 4, padding: "2px 4px", textAlign: "center", zIndex: 2 }}>فشل الرفع</div>
                  )}
                <button type="button" onClick={(e) => { e.stopPropagation(); removeImage(index); }}
                  style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 5, border: "none", background: "rgba(0,0,0,.65)", color: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, zIndex: 3 }}>×</button>
                {index === 0 && <div style={{ position: "absolute", left: 5, bottom: 5, padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 11, fontWeight: 500, zIndex: 2 }}>مميز</div>}
                {img.type === "video" && <div style={{ position: "absolute", right: 5, bottom: 5, padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 11, display: "flex", alignItems: "center", gap: 3, zIndex: 2 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3" /></svg>فيديو
                </div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── SeoListingSection ─────────────────────────────────────────────────── */

const SEO_TITLE_MAX = 70;
const SEO_DESC_MAX = 320;
const SEO_LISTING_PREVIEW_LEN = 160;

function SeoListingSection({
  title, description, price, urlHandle, seoTitle, seoDescription, onChange, showPrice,
}: {
  title: string; description: string; price: string; urlHandle: string;
  seoTitle: string; seoDescription: string;
  onChange: (seoTitle: string, seoDescription: string) => void;
  showPrice: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(seoTitle);
  const [draftDesc, setDraftDesc] = useState(seoDescription);

  const plainDesc = stripHtml(description);
  const displayTitle = (seoTitle || title).trim();
  const displayDesc = (seoDescription || plainDesc).trim();

  useEffect(() => {
    if (editing && !seoTitle) {
      setDraftTitle(title);
    }
  }, [title, editing, seoTitle]);

  useEffect(() => {
    if (editing && !seoDescription) {
      setDraftDesc(stripHtml(description).slice(0, SEO_LISTING_PREVIEW_LEN));
    }
  }, [description, editing, seoDescription]);

  const startEdit = () => {
    setDraftTitle(seoTitle || title);
    setDraftDesc(seoDescription || plainDesc.slice(0, SEO_LISTING_PREVIEW_LEN));
    setEditing(true);
  };

  const titleOver = draftTitle.length > SEO_TITLE_MAX;
  const descOver  = draftDesc.length  > SEO_DESC_MAX;
  const save   = () => { onChange(draftTitle.trim(), draftDesc.trim()); setEditing(false); };
  const cancel = () => setEditing(false);

  const titleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = titleOver ? "#d72c0d" : "#458fff";
    e.target.style.boxShadow   = titleOver ? "0 0 0 2px rgba(215,44,13,.2)" : "0 0 0 2px rgba(69,143,255,.2)";
  };
  const descFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.target.style.borderColor = descOver ? "#d72c0d" : "#458fff";
    e.target.style.boxShadow   = descOver ? "0 0 0 2px rgba(215,44,13,.2)" : "0 0 0 2px rgba(69,143,255,.2)";
  };
  const titleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = titleOver ? "#d72c0d" : "#c9cccf";
    e.target.style.boxShadow   = "none";
  };
  const descBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.target.style.borderColor = descOver ? "#d72c0d" : "#c9cccf";
    e.target.style.boxShadow   = "none";
  };

  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={S.sectionTitle}>Search engine listing</span>
        {!editing && (
          <button onClick={startEdit} type="button"
            style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "#458fff", fontSize: 13, fontWeight: 500, padding: 0 }}>
            <EditIcon /> Edit
          </button>
        )}
      </div>

      {!editing && !title.trim() ? (
        <p style={{ fontSize: 13, color: "#6d7175", margin: 0, lineHeight: 1.5 }}>
          Add a title and description to see how this product might appear in a search engine listing
        </p>
      ) : !editing ? (
        <div style={{ padding: "10px 12px", border: "1px solid #e3e3e3", borderRadius: 6, background: "#fafafa" }}>
          <div style={{ fontSize: 12, color: "#006621", marginBottom: 2 }}>My Store 6</div>
          <div style={{ fontSize: 12, color: "#006621", marginBottom: 4, wordBreak: "break-all" }}>
            https://kgdfq8-dq.myshopify.com{" › "}products{urlHandle.trim() ? ` › ${urlHandle.trim()}` : ""}
          </div>
          {displayTitle && (
            <div style={{ fontSize: 15, color: "#1a0dab", fontWeight: 400, marginBottom: 4, lineHeight: 1.3 }}>
              {displayTitle.slice(0, SEO_TITLE_MAX)}{displayTitle.length > SEO_TITLE_MAX ? "…" : ""}
            </div>
          )}
          {displayDesc && (
            <div style={{ fontSize: 13, color: "#545454", lineHeight: 1.5, marginBottom: 6 }}>
              {displayDesc.slice(0, SEO_LISTING_PREVIEW_LEN)}{displayDesc.length > SEO_LISTING_PREVIEW_LEN ? "…" : ""}
            </div>
          )}
          {showPrice && (
            <div style={{ fontSize: 13, color: "#303030", fontWeight: 700 }}>{formatCurrency(price)}</div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Page title</label>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={title || "Page title"}
              style={{ ...S.inp, borderColor: titleOver ? "#d72c0d" : "#c9cccf" }}
              onFocus={titleFocus}
              onBlur={titleBlur}
            />
            <p style={{ fontSize: 11, color: titleOver ? "#d72c0d" : "#8c9196", fontWeight: titleOver ? 600 : 400, margin: "4px 0 0" }}>
              {draftTitle.length} of {SEO_TITLE_MAX} characters used
              {titleOver && ` — ${draftTitle.length - SEO_TITLE_MAX} over limit`}
            </p>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Meta description</label>
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Meta description"
              rows={4}
              style={{ ...S.inp, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, borderColor: descOver ? "#d72c0d" : "#c9cccf" }}
              onFocus={descFocus}
              onBlur={descBlur}
            />
            <p style={{ fontSize: 11, color: descOver ? "#d72c0d" : "#8c9196", fontWeight: descOver ? 600 : 400, margin: "4px 0 0" }}>
              {draftDesc.length} of {SEO_DESC_MAX} characters used
              {descOver && ` — ${draftDesc.length - SEO_DESC_MAX} over limit`}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} type="button" style={{ padding: "7px 16px", fontSize: 13, fontWeight: 600, borderRadius: 7, cursor: "pointer", background: "#303030", color: "#fff", border: "none" }}>Save</button>
            <button onClick={cancel} type="button" style={{ padding: "7px 16px", fontSize: 13, borderRadius: 7, cursor: "pointer", background: "#fff", color: "#303030", border: "1px solid #c9cccf" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── ProductForm ────────────────────────────────────────────────────────── */
const EMPTY_FORM: ProductFormState = {
  title: "", description: "", url_handle: "", status: "active",
  product_type: null, tags: [], collections: [], price: "", compare_at_price: "",
  cost_per_item: "", charge_tax: true, track_inventory: true,
  quantity: 0, sku: "", barcode: "", continue_selling: false,
  category: "", options: [], images: [], variants: [],
  seo_title: "", seo_description: "",
};

function formSnapshot(f: ProductFormState) {
  return {
    ...f,
    images: f.images.map(({ file: _f, ...rest }) => rest),
    variants: f.variants.map((v) => ({
      ...v,
      image: v.image ? { url: v.image.url, alt: v.image.alt, type: v.image.type } : null,
    })),
  };
}

export default function ProductForm({ productId }: { productId?: string }) {

  const [loadingProduct, setLoadingProduct] = useState(!!productId)

  const [handleError, setHandleError] = useState("");

  const handleRef = useRef<HTMLDivElement>(null);

  const params = useParams();
  /**
   * FIX: المسار الفعلي بتاع صفحة التعديل هو
   * /stores-building/products/{id}/edit — من غير أي segment لاسم المتجر
   * خالص، فـ params?.storeSlug كانت هترجع undefined دايمًا. الباك اند
   * بيحدد المتجر أصلاً من المستخدم المسجل دخوله، مش من الرابط، فبنجيب
   * slug المتجر من استجابة الـ API نفسها (بعد الحفظ أو بعد تحميل منتج
   * موجود) بدل ما نعتمد على route param مش موجود من الأساس.
   */
  const [storeSlug, setStoreSlug] = useState('');

  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState<ProductFormState>(EMPTY_FORM);
  

  const isDirty = JSON.stringify(formSnapshot(form)) !== JSON.stringify(formSnapshot(savedForm));

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [firstGroupPrice, setFirstGroupPrice] = useState<string | null>(null);
  const [priceTouched, setPriceTouched] = useState(false);
  const [compareTouched, setCompareTouched] = useState(false);
  const [costTouched, setCostTouched] = useState(false);
  const [error, setError] = useState("");
  const [localTypes, setLocalTypes] = useState<ProductType[]>([]);
  const [localAllTags, setLocalAllTags] = useState<Tag[]>([]);
  const [localAllCollections, setLocalAllCollections] = useState<Collection[]>([]);

  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [handleEdited, setHandleEdited] = useState(false);
  const [titleError, setTitleError] = useState(false);
  /* FIX: عداد صور الوصف اللي لسه بترفع على R2 — بيتحدث من جوه
     RichTextEditor عن طريق onUploadingChange، وبنستخدمه في handleSave
     بالظبط زي صور المنتج وصور الفارينت عشان منسمحش بالحفظ لحد ما يخلص. */
  const [descImagesUploading, setDescImagesUploading] = useState(0);
  /* لينك المنتج المباشر (يُستخدم مع حالة "Unlisted" وأيضًا يفيد أي حالة
     تانية زي معاينة سريعة). window مش موجودة وقت الـ SSR، فبنجيب origin
     المتصفح فعليًا بعد الـ mount بس عشان منعملش hydration mismatch. */
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const [linkCopied, setLinkCopied] = useState(false);

  /* refs for scroll-to-error */
  const titleRef    = useRef<HTMLDivElement>(null);
  const pricingRef  = useRef<HTMLDivElement>(null);
  const variantsRef = useRef<HTMLDivElement>(null);

  const [navBlock, setNavBlock] = useState<string | null>(null);
  const [discardShake, setDiscardShake] = useState(false);
  const origPushRef = useRef<typeof history.pushState | null>(null);

  const triggerDiscardShake = () => {
    setDiscardShake(true);
    setTimeout(() => setDiscardShake(false), 600);
  };

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    if (!productId) return

    let cancelled = false

    const fetchProduct = async () => {
      setLoadingProduct(true)
      try {
        const { data } = await api.get(`/stores/products/${productId}`)
        if (cancelled) return

        const hasOptions = (data.options?.length || 0) > 0

        const loadedForm: ProductFormState = {
          title: data.title || '',
          description: data.description || '',
          url_handle: data.handle || '',
          status: (data.status || 'DRAFT').toLowerCase(),
          product_type: data.productType
            ? { id: data.productType.id.toString(), name: data.productType.name }
            : null,
          tags: (data.tags || []).map((t: any) => ({
            id: t.tag.id.toString(),
            name: t.tag.name,
          })),
          collections: (data.collections || []).map((c: any) => ({
            id: c.collection.id.toString(),
            name: c.collection.name,
            image_url: c.collection.image_url || undefined,
          })),
          price: Number(data.variants?.[0]?.price) > 0 ? String(data.variants[0].price) : '',
          compare_at_price: Number(data.variants?.[0]?.compare_at_price) > 0 ? String(data.variants[0].compare_at_price) : '',
          cost_per_item: Number(data.variants?.[0]?.cost_per_item) > 0 ? String(data.variants[0].cost_per_item) : '',
          charge_tax: data.charge_tax ?? true,
          track_inventory: data.variants?.[0]?.track_inventory ?? true,
          quantity: data.variants?.[0]?.inventory_qty || 0,
          sku: data.variants?.[0]?.sku || '',
          barcode: data.variants?.[0]?.barcode || '',
          continue_selling: data.variants?.[0]?.continue_selling ?? false,
          category: data.category || '',
          options: (data.options || []).map((o: any) => ({
            name: o.name,
            values: (o.values || []).map((v: any) => v.value),
            colors: o.colors || undefined,           // ← جديد، كان ناقص
            displayType: o.display_type || "buttons", // ← جديد
          })),
          images: (data.images || []).map((img: any) => ({
            url: img.url,
            alt: img.alt || '',
            key: img.key || undefined,
            type: 'image' as const,
          })),
          /**
           * FIX #1 (صورة الفارينت بتختفي عند فتح صفحة التعديل):
           * كان الكود بيحط image: null دايمًا هنا بدل ما يقرأ v.image_url /
           * v.image_key الراجعين من الباك اند فعليًا. دلوقتي بنبني object
           * الصورة من البيانات الحقيقية لو موجودة.
           */
          variants: hasOptions
            ? (data.variants || []).map((v: any) => ({
                id: v.id?.toString(),
                combination: [v.option1, v.option2, v.option3].filter(Boolean),
                price: Number(v.price) > 0 ? String(v.price) : '',
                salePrice: Number(v.compare_at_price) > 0 ? String(v.compare_at_price) : '',
                cost: Number(v.cost_per_item) > 0 ? String(v.cost_per_item) : '',
                quantity: v.inventory_qty || 0,
                sku: v.sku || '',
                barcode: v.barcode || '',
                image: v.image_url
                  ? { url: v.image_url, key: v.image_key || undefined, alt: '', type: 'image' as const }
                  : null,
                active: true,
              }))
            : [],
          seo_title: data.seo_title || '',
          seo_description: data.seo_desc || '',
        }



        setForm(loadedForm)
        setSavedForm(loadedForm)
        setStoreSlug(data.store?.slug || '')
        setPriceTouched(true)
        setCompareTouched(true)
        setCostTouched(true)
        if (loadedForm.sku || loadedForm.barcode) {
          setShowMoreDetails(true)
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.response?.data?.message ?? 'فشل تحميل بيانات المنتج')
        }
      } finally {
        if (!cancelled) setLoadingProduct(false)
      }
    }

    fetchProduct()
    return () => { cancelled = true }
  }, [productId])

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href === "") return;
      e.preventDefault();
      e.stopPropagation();
      setNavBlock(href);
      triggerDiscardShake();
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [isDirty]);

  useEffect(() => {
    api.get('/stores/collections').then(({ data }) => {
      const fetched = (data || []).map((c: any) => ({ id: c.id.toString(), name: c.name, image_url: c.image_url || undefined }));
      setLocalAllCollections((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        return [...prev, ...fetched.filter((c: Collection) => !existingIds.has(c.id))];
      });
    }).catch(() => {});
  }, []);

  const set = (key: keyof ProductFormState, val: unknown) => setForm((f) => ({ ...f, [key]: val }));
  const iFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = "#458fff"; e.target.style.boxShadow = "0 0 0 2px rgba(69,143,255,.2)";
  };
  const iBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = "#c9cccf"; e.target.style.boxShadow = "none";
  };

  const handleAddImage = useCallback((file: File, cb: (img: ProductImage) => void) => {
    const localUrl = URL.createObjectURL(file);
    cb({ url: localUrl, alt: file.name, file, type: "image", uploading: true });

    uploadToR2(file, "variants")
      .then(({ url, key }) => {
        console.log("SUCCESS", file.name);
        cb({
          url,
          alt: file.name,
          type: "image",
          key,
          uploading: false,
        });
      })
      .catch((err) => {
        console.error("FAILED", file.name, err);

        cb({
          url: localUrl,
          alt: file.name,
          type: "image",
          uploading: false,
          uploadError: true,
        });
      });
  }, []);

  /**
   * FIX: بيستقبل إما array جاهزة أو "updater function" (زي
   * setState(prev => ...)) جاية من MediaSection، وبيطبقها على أحدث
   * form.images فعليًا وقت التنفيذ عن طريق الـ functional form بتاع
   * setForm — ده اللي بيمنع تحديثات الصور المتزامنة من مسح بعضها.
   */
  const handleImagesChange = useCallback(
    (updater: ProductImage[] | ((prev: ProductImage[]) => ProductImage[])) => {
      setForm((f) => ({
        ...f,
        images: typeof updater === "function"
          ? (updater as (prev: ProductImage[]) => ProductImage[])(f.images)
          : updater,
      }));
    },
    []
  );

  const handleDiscard = () => {
    setForm(savedForm);
    setFirstGroupPrice(null);
    setPriceTouched(false);
    setCompareTouched(false);
    setCostTouched(false);
    setHandleEdited(false);
    setTitleError(false);
    setError("");
  };

 const handleSave = async () => {
  if (!form.title.trim()) {
    setTitleError(true);
    setTimeout(() => titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    return;
  }
  const finalHandle = form.url_handle.trim()
    ? form.url_handle.trim()
    : (productId ? savedForm.url_handle : toHandle(form.title.trim()));
  // if (!finalHandle) {
  //   setHandleError("من فضلك أدخل رابط صحيح للمنتج (حروف إنجليزية أو أرقام فقط)");
  //   setTimeout(() => handleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  //   return;
  // }
  // setHandleError("");
  const anyImagesUploading =
  form.images.some((i) => i.uploading) ||
  form.variants.some((v) => v.image?.uploading) ||
  descImagesUploading > 0;
  if (anyImagesUploading) {
    setError('من فضلك انتظر حتى ينتهي رفع الصور');
    return;
  }

  if (hasPricingError) {
    setPriceTouched(true); setCompareTouched(true); setCostTouched(true);
    const scrollTarget = form.variants.length > 0 ? variantsRef : pricingRef;
    setTimeout(() => scrollTarget.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    return;
  }
  setTitleError(false);
  setSaving(true)
  try {
    let product_type_id: string | null = null
    if (form.product_type?.name) {
      const { data } = await api.post('/stores/products/product-types', {
        name: form.product_type.name,
      })
      product_type_id = data.id
    }

    const tag_ids = await Promise.all(
      form.tags.map(t =>
        api.post('/stores/products/tags', { name: t.name }).then(r => r.data.id)
      )
    )
    const collection_ids = await Promise.all(
      form.collections.map(c =>
        api.post('/stores/products/collections', { name: c.name }).then(r => r.data.id)
      )
    )

    const sharedPayload = {
      title: form.title.trim(),
      description: form.description,
      status: form.status.toUpperCase(),
      product_type_id,
      tag_ids,
      collection_ids,
      seo_title: form.seo_title || null,
      seo_desc: form.seo_description || null,
      category: form.category || null,
      charge_tax: form.charge_tax,
      price: form.variants.length === 0
      ? (form.price.trim() !== "" ? form.price : null)
      : undefined,
      compare_at_price: form.variants.length === 0
        ? (form.compare_at_price.trim() !== "" ? form.compare_at_price : null)
        : undefined,
      cost_per_item: form.variants.length === 0
      ? (form.cost_per_item.trim() !== "" ? form.cost_per_item : null)
      : undefined,
      track_inventory: form.track_inventory,
      inventory_qty: form.variants.length === 0 ? form.quantity : undefined,
      sku: form.variants.length === 0 ? (form.sku || null) : undefined,
      barcode: form.variants.length === 0 ? (form.barcode || null) : undefined,
      continue_selling: form.continue_selling,
      images: form.images
      .filter(img => !img.url.startsWith('blob:') && !img.uploadError)
      .map((img, i) => ({ url: img.url, key: img.key || null, alt: img.alt, position: i })),
      options: form.options
      .filter(o => o.name && o.values.filter(Boolean).length > 0)
      .map((opt, i) => ({
        name: opt.name,
        position: i,
        values: opt.values.filter(Boolean),
        colors: opt.colors && Object.keys(opt.colors).length > 0 ? opt.colors : undefined,
        display_type: opt.displayType || "buttons",
      })),
    }

    
    let res;

    if (productId) {
      // ── UPDATE existing product ──────────────────────────────────────
      res = await api.put(`/stores/products/${productId}`, {
        ...sharedPayload,
        handle: finalHandle,   // ← ضيف السطر ده
        variants: form.variants.map((v, i) => ({
          id: v.id,
          title: v.combination.join(' / ') || 'Default Title',
          price: v.price.trim() !== "" ? v.price : null,
          compare_at_price: v.salePrice || null,
          cost_per_item: v.cost || null,
          inventory_qty: v.quantity,
          sku: v.sku || null,
          barcode: v.barcode || null,
          combination: v.combination,
          position: i,
          /**
           * FIX #2 (صورة الفارينت بتتمسح عند التعديل): كان الـ payload بتاع
           * التحديث ناقص image_url و image_key تمامًا (موجودين في CREATE
           * بس)، فالسيرفر ما كانش بياخد أي صورة فارينت جديدة/معدَّلة عند أي
           * حفظ لمنتج موجود بالفعل.
           */
          image_url: v.image?.url && !v.image.url.startsWith('blob:') ? v.image.url : null,
          image_key: v.image?.key || null,
        })),
      });
    } else {
      // ── CREATE new product ───────────────────────────────────────────
      res = await api.post('/stores/products', {
        ...sharedPayload,
        store_slug: storeSlug,
        handle: form.url_handle || toHandle(form.title.trim()),
        variants: form.variants.map((v, i) => ({
          title: v.combination.join(' / ') || 'Default Title',
          price: v.price.trim() !== "" ? v.price : null,
          compare_at_price: v.salePrice || null,
          cost_per_item: v.cost || null,
          inventory_qty: v.quantity,
          sku: v.sku || null,
          barcode: v.barcode || null,
          track_inventory: form.track_inventory,
          continue_selling: form.continue_selling,
          combination: v.combination,
          position: i,
          image_url:
            v.image?.url && !v.image.url.startsWith('blob:')
              ? v.image.url
              : null,
          image_key: v.image?.key || null,
        })),
      });
    }

    const savedProductId = res.data.id;
    if (res.data.store?.slug) setStoreSlug(res.data.store.slug)

    await Promise.all([
      ...form.images
        .filter((i) => i.key)
        .map((i) => confirmUpload(i.key!, 'product', savedProductId)),
      ...form.variants
        .filter((v) => v.image?.key)
        .map((v) =>
          confirmUpload(v.image!.key!, 'variant', savedProductId)
        ),
    ]);

    const formWithFinalHandle = { ...form, url_handle: finalHandle };
    setForm(formWithFinalHandle);
    setSavedForm(formWithFinalHandle);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
    
  } catch (err: any) {
    if (!err?.silent) setError(err?.response?.data?.message ?? err?.message ?? 'Failed to save')
  } finally {
    setSaving(false)
  }
};

  const priceVal = parseFloat(form.price);
  const compareVal = parseFloat(form.compare_at_price);
  const costVal = parseFloat(form.cost_per_item);
  const hasDiscount = form.price && form.compare_at_price && compareVal > priceVal && priceVal > 0;
  const discountPct = hasDiscount ? Math.round((1 - priceVal / compareVal) * 100) : 0;

  const priceErrorRaw = form.variants.length > 0 ? "" :
    form.price.trim() === "" ? "" :
    isNaN(priceVal) || priceVal <= 0 ? "السعر يجب أن يكون أكبر من صفر" : "";

  const compareErrorRaw = form.variants.length > 0 ? "" :
    form.compare_at_price.trim() === "" ? "من فضلك أدخل السعر الأصلي قبل الخصم" :
    isNaN(compareVal) || compareVal <= 0 ? "القيمة غير صحيحة" :
    (!priceErrorRaw && form.price.trim() !== "" && compareVal <= priceVal) ? "يجب أن يكون أكبر من سعر البيع" : "";

  const costErrorRaw = form.variants.length > 0 ? "" :
    form.cost_per_item.trim() === "" ? "" :
    isNaN(costVal) || costVal < 0 ? "القيمة غير صحيحة" : "";

  const priceError = priceTouched ? priceErrorRaw : "";
  const compareError = compareTouched ? compareErrorRaw : "";
  const costError = costTouched ? costErrorRaw : "";

  const hasVariantPriceMismatch = form.variants.some(variantPriceMismatch);
  const hasPricingError = !!priceErrorRaw || !!compareErrorRaw || !!costErrorRaw || hasVariantPriceMismatch;

  const variantPricingDefaults: VariantPriceDefaults = {
    price: form.price,
    salePrice: form.compare_at_price,
    cost: form.cost_per_item,
  };

  const hasVariants = form.variants.length > 0;
  const seoPrice = hasVariants
    ? (form.variants[0]?.salePrice || form.variants[0]?.price || "")
    : (form.compare_at_price || form.price);
  const seoPriceNum = parseFloat(seoPrice);
  const seoShowPrice = seoPrice.trim() !== "" && !isNaN(seoPriceNum) && seoPriceNum >= 0;

  /**
   * لينك المنتج المباشر — بيشتغل سواء المنتج Active أو Unlisted (المنتج
   * الـ Unlisted مش بيظهر في صفحة المنتجات العادية، لكن أي حد معاه اللينك
   * ده بالظبط يقدر يفتح صفحته). لو المنتج لسه ما اتحفظش بـ handle، بنعرض
   * حالة placeholder بدل لينك ناقص.
   * ملحوظة: نمط الرابط هنا "/store/{slug}/products/{handle}" افتراضي —
   * لو الراوت الفعلي عندك مختلف، غيّر السطر ده بس.
   */
  const directProductLink = form.url_handle && storeSlug
    ? `${origin}/store/${storeSlug}/products/${form.url_handle}`
    : '';

  const copyDirectLink = async () => {
    if (!directProductLink) return;
    try {
      await navigator.clipboard.writeText(directProductLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard API ممكن تفشل (صلاحيات المتصفح) — نتجاهل بصمت، الرابط
         لسه ظاهر للمستخدم يقدر يعمله select يدوي. */
    }
  };

  if (loadingProduct) {
    return (
      <div style={{ ...S.body, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", gap: 10, color: "#6d7175", fontSize: 13 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#458fff" strokeWidth="2" style={{ animation: "spin .8s linear infinite" }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>جارِ تحميل بيانات المنتج...</span>
        <style>{`@keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }`}</style>
      </div>
    );
  }

  return (
    <div style={S.body}>
      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes shake { 0%,100%{transform:translateX(0)} 15%{transform:translateX(-6px)} 30%{transform:translateX(6px)} 45%{transform:translateX(-5px)} 60%{transform:translateX(5px)} 75%{transform:translateX(-3px)} 90%{transform:translateX(3px)} }
        * { box-sizing:border-box }
        input[type=number]::-webkit-inner-spin-button { opacity:0 }
        input[type=number]:hover::-webkit-inner-spin-button { opacity:1 }
        ::-webkit-scrollbar { width:6px; height:6px }
        ::-webkit-scrollbar-thumb { background:#d0d0d0; border-radius:4px }
        [contenteditable][data-placeholder]:empty::before { content:attr(data-placeholder); color:#aaa; pointer-events:none; font-style:italic; }
        [contenteditable] { caret-color: #303030; }
        [contenteditable] * { max-width:100%; font-size:inherit; font-family:inherit; line-height:inherit; }
        [contenteditable] p, [contenteditable] h1, [contenteditable] h2, [contenteditable] h3, [contenteditable] blockquote, [contenteditable] ul, [contenteditable] ol { display:block; box-sizing:border-box; }
        [contenteditable] > *:first-child { margin-top:0; }
        [contenteditable] > *:last-child { margin-bottom:0; }
        [contenteditable] p { margin:.5em 0; }
        [contenteditable] h1 { font-size:1.8em !important; font-weight:700; line-height:1.3; margin:.6em 0 .4em; }
        [contenteditable] h2 { font-size:1.4em !important; font-weight:700; line-height:1.3; margin:.6em 0 .4em; }
        [contenteditable] h3 { font-size:1.15em !important; font-weight:700; line-height:1.3; margin:.6em 0 .4em; }
        [contenteditable] ul { list-style:disc; padding-left:24px; padding-right:0; margin:.4em 0; }
        [contenteditable] ol { list-style:decimal; padding-left:24px; padding-right:0; margin:.4em 0; }
        [contenteditable] li { margin:.2em 0; }
        [contenteditable] blockquote { border-left:4px solid #458fff; background:#f0f6ff; padding:10px 14px; border-radius:0 6px 6px 0; margin:.6em 0; color:#303030; font-style:normal; }
        [contenteditable] a { color:#458fff; text-decoration:underline; }
        [contenteditable] img { max-width:100%; border-radius:6px; }
        [contenteditable] hr { border:none; border-top:2px solid #e3e3e3; margin:.8em 0; }
        [contenteditable] table { border-collapse:collapse; width:100%; margin:.6em 0; }
        [contenteditable] table td, [contenteditable] table th { border:1px solid #c9cccf; padding:7px 10px; font-size:inherit; vertical-align:top; }
        [contenteditable] table th { background:#f3f4f5; font-weight:700; text-align:right; }
        [contenteditable] table tr:nth-child(even) td { background:#fafafa; }
        [contenteditable] table tr:hover td { background:#f0f6ff; }
        [data-rte-toolbar] button:focus { outline: none; }
      `}</style>

      {navBlock && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#1a1a1a" }}>لديك تغييرات غير محفوظة</h2>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "#6d7175", lineHeight: 1.6 }}>إذا غادرت الصفحة الآن ستفقد كل التعديلات التي أجريتها.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setNavBlock(null)}
                style={{ padding: "9px 24px", borderRadius: 8, border: "1px solid #c9cccf", background: "#fff", color: "#1a1a1a", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                ابقَ في الصفحة
              </button>
              <button
                onClick={() => {
                  const dest = navBlock!;
                  setNavBlock(null);
                  handleDiscard();
                  if (origPushRef.current) {
                    origPushRef.current(null, "", dest);
                    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
                  } else {
                    window.location.assign(dest);
                  }
                }}
                style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: "#d72c0d", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                تجاهل التعديلات والمغادرة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={S.topbar}>
        {form.url_handle && storeSlug ? (
          <a
            href={directProductLink}
            target="_blank"
            rel="noreferrer"
            style={{
              marginRight: "auto", display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 7,
              color: "#458fff", background: "#fff", border: "1px solid #c9cccf", textDecoration: "none",
            }}
            title="هيفتح صفحة المنتج في تاب جديد — بيشتغل بس لو المنتج Active أو Unlisted ومحفوظ فعلاً"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
            </svg>
            معاينة المنتج
          </a>
        ) : (
          /**
           * FIX (تشخيص): بدل ما الزرار يختفي بصمت لو أي شرط ناقص، بنوضح
           * السبب بالظبط — إما مفيش handle للمنتج لسه، أو مفيش storeSlug
           * جاي من الراوت أصلاً (يعني params.storeSlug مش موجودة في
           * المسار الحالي).
           */
          <span
            style={{ marginRight: "auto", fontSize: 12, color: "#8c9196", display: "inline-flex", alignItems: "center", gap: 6 }}
            title={`url_handle="${form.url_handle}" | storeSlug="${storeSlug}"`}
          >
            {!form.url_handle
              ? "⚠ هيظهر لينك المعاينة بعد ما تحفظ المنتج"
              : "⚠ مش لاقي اسم المتجر (storeSlug) من مسار الصفحة"}
          </span>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isDirty && (
            <button
              onClick={handleDiscard}
              style={{
                padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 7,
                cursor: "pointer", background: "#2a2a2a", color: "#fff", border: "1px solid #424242",
                animation: discardShake ? "shake 0.6s ease" : "none",
              }}>
              Discard
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !isDirty}
            style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 7, cursor: isDirty && !saving ? "pointer" : "default", background: isDirty ? "#fff" : "#f1f1f1", color: isDirty ? "#1a1a1a" : "#aaa", border: "none", display: "flex", alignItems: "center", gap: 6, transition: "background .15s, color .15s" }}>
            {saving && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin .8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>}
            Save
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 240px", gap: 12, alignItems: "start" }}>
        {/* Left column */}
        <div style={{ maxWidth: '100%' }}>
          {saveSuccess && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, marginBottom: 10, fontSize: 13, color: "#15803d" }}>
              <span>✓</span>
              <span>تم حفظ المنتج بنجاح</span>
            </div>
          )}
          {error && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "#fff4f4", border: "1px solid #ffc9c9", borderRadius: 8, marginBottom: 10, fontSize: 13, color: "#d72c0d" }}>
              <span>⚠ {error}</span>
              <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#d72c0d" }}>×</button>
            </div>
          )}

          {/* Title & Description */}
          <div ref={titleRef} style={S.card}>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Title</label>
              <div style={{ position: "relative" }}>
                <input value={form.title}
                  onChange={(e) => {
                    const t = e.target.value;
                    setForm((f) => {
                      const shouldAutoSync = !handleEdited && !containsArabic(t);
                      return { ...f, title: t, url_handle: shouldAutoSync ? toHandle(t) : f.url_handle };
                    });
                    if (titleError) setTitleError(false);
                  }}
                  onFocus={(e) => { if (!titleError) iFocus(e); }}
                  onBlur={(e) => { if (!titleError) iBlur(e); }}
                  placeholder="Short sleeve t-shirt"
                  style={{
                    ...S.inp,
                    paddingRight: titleError ? 34 : 10,
                    borderColor: titleError ? "#d72c0d" : "#c9cccf",
                    boxShadow: titleError ? "0 0 0 2px rgba(215,44,13,.15)" : "none",
                  }} />
                {titleError && (
                  <span style={{ position: "absolute", top: "50%", right: 10, transform: "translateY(-50%)", display: "flex" }}>
                    <ErrorIcon />
                  </span>
                )}
              </div>
              {titleError && (
                <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 5 }}>⚠ أضف اسم المنتج</div>
              )}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Description</label>
              <RichTextEditor
                value={form.description}
                onChange={(v) => set("description", v)}
                onUploadingChange={setDescImagesUploading}
              />
            </div>
            <div>
              <label style={S.label}>URL handle</label>
              <div style={{ display: "flex", alignItems: "center", border: "1px solid #c9cccf", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
                <span style={{ padding: "0 8px", color: "#6d7175", fontSize: 13, background: "#f6f6f7", borderRight: "1px solid #c9cccf", whiteSpace: "nowrap", lineHeight: "32px" }}>products/</span>
                <input value={form.url_handle}
                  onChange={(e) => {
                    setHandleEdited(true);
                    // يمنع كتابة العربي أو أي رمز غير مسموح أثناء الكتابة نفسها
                    const cleaned = e.target.value
                      .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, "")
                      .replace(/[^a-zA-Z0-9\s-]+/g, "");
                    set("url_handle", cleaned);
                  }}
                  onBlur={(e) => {
                    const cleaned = toHandle(e.target.value);
                    // الرابط مينفعش يبقى فاضي: لو فاضي بعد التنظيف، يرجع فورًا لآخر
                    // قيمة محفوظة، أو يتولّد من العنوان لو المنتج لسه جديد
                    set("url_handle", cleaned || savedForm.url_handle || toHandle(form.title.trim()));
                    iBlur(e);
                  }}
                  placeholder="short-sleeve-t-shirt"
                  style={{ ...S.inp, border: "none", boxShadow: "none", borderRadius: 0, flex: 1, paddingLeft: 8 }} />
              </div>
              <p style={{ fontSize: 12, color: "#6d7175", margin: "4px 0 0" }}>حروف إنجليزية وأرقام وشرطات فقط — لو سبته فاضي هيرجع لآخر قيمة تلقائيًا فور ما تخرج من الحقل</p>
            </div>
          </div>

          {/* Media */}
          <div style={S.card}>
            <MediaSection images={form.images} onChange={handleImagesChange} />
          </div>

          {/* Category */}
          <div style={S.card}>
            <label style={S.label}>Category</label>
            <CategoryPicker  value={form.category} onChange={(v) => set("category", v)} />
            <p style={{ fontSize: 12, color: "#6d7175", margin: "6px 0 0" }}>Determines tax rates and adds metafields</p>
          </div>

          {/* Pricing */}
          {<div ref={pricingRef} style={S.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={S.sectionTitle}>Pricing</span>
              {hasDiscount && <span style={{ fontSize: 12, fontWeight: 700, color: "#1a9c3e", background: "#e6f4ea", borderRadius: 99, padding: "3px 10px", whiteSpace: "nowrap" }}>{discountPct}% off</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Original price <span style={{ fontSize: 11, fontWeight: 400, color: "#8c9196", marginLeft: 4 }}>(before discount)</span></label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#6d7175", fontSize: 13, pointerEvents: "none" }}>{CURRENCY_SYMBOL}</span>
                  <input type="number" value={form.compare_at_price} onChange={(e) => { set("compare_at_price", e.target.value); setCompareTouched(true); setPriceTouched(true); }} placeholder="0.00" min="0" step="0.01"
                    style={{ ...S.inp, paddingLeft: 38, fontSize: 15, fontWeight: 600, borderColor: compareError ? "#d72c0d" : "#c9cccf" }}
                    onFocus={(e) => { e.target.style.borderColor = compareError ? "#d72c0d" : "#458fff"; e.target.style.boxShadow = compareError ? "0 0 0 2px rgba(215,44,13,.15)" : "0 0 0 2px rgba(69,143,255,.2)"; }}
                    onBlur={(e) => { setCompareTouched(true); e.target.style.borderColor = compareError ? "#d72c0d" : "#c9cccf"; e.target.style.boxShadow = "none"; }} />
                </div>
                {compareError && <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 5 }}>⚠ {compareError}</div>}
              </div>
              <div>
                <label style={S.label}>Sale price <span style={{ fontSize: 11, fontWeight: 400, color: "#8c9196", marginLeft: 4 }}>(selling price, optional)</span></label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#1a9c3e", fontSize: 13, pointerEvents: "none" }}>{CURRENCY_SYMBOL}</span>
                  <input type="number" value={form.price} onChange={(e) => { set("price", e.target.value); setPriceTouched(true); setCompareTouched(true); }} placeholder="0.00" min="0" step="0.01"
                    style={{ ...S.inp, paddingLeft: 38, fontSize: 15, fontWeight: 600, borderColor: priceError ? "#d72c0d" : hasDiscount ? "#1a9c3e" : "#c9cccf" }}
                    onFocus={(e) => { e.target.style.borderColor = priceError ? "#d72c0d" : "#1a9c3e"; e.target.style.boxShadow = priceError ? "0 0 0 2px rgba(215,44,13,.15)" : "0 0 0 2px rgba(26,156,62,.18)"; }}
                    onBlur={(e) => { setPriceTouched(true); e.target.style.borderColor = priceError ? "#d72c0d" : hasDiscount ? "#1a9c3e" : "#c9cccf"; e.target.style.boxShadow = "none"; }} />
                </div>
                {priceError && <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 5 }}>⚠ {priceError}</div>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={S.label}>Cost per item <span style={{ fontSize: 11, fontWeight: 400, color: "#8c9196", marginLeft: 4 }}>(for margin calculation only)</span></label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#6d7175", fontSize: 13, pointerEvents: "none" }}>{CURRENCY_SYMBOL}</span>
                  <input type="number" value={form.cost_per_item} onChange={(e) => { set("cost_per_item", e.target.value); setCostTouched(true); }} placeholder="0.00" min="0" step="0.01"
                    style={{ ...S.inp, paddingLeft: 38, fontSize: 15, fontWeight: 600, borderColor: costError ? "#d72c0d" : "#c9cccf" }}
                    onFocus={(e) => { e.target.style.borderColor = costError ? "#d72c0d" : "#458fff"; e.target.style.boxShadow = costError ? "0 0 0 2px rgba(215,44,13,.15)" : "0 0 0 2px rgba(69,143,255,.2)"; }}
                    onBlur={(e) => { setCostTouched(true); e.target.style.borderColor = costError ? "#d72c0d" : "#c9cccf"; e.target.style.boxShadow = "none"; }} />
                </div>
                {costError && <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 5 }}>⚠ {costError}</div>}
              </div>
              <div>
                <label style={S.label}>Profit</label>
                <div style={{ ...S.inp, display: "flex", alignItems: "center", background: "#f9fafb", color: "#303030", fontWeight: 600, fontSize: 15 }}>
                  {(() => {
                    const p = parseFloat(form.price);
                    const c = parseFloat(form.cost_per_item);
                    if (isNaN(p) || isNaN(c)) return <span style={{ color: "#8c9196", fontWeight: 400, fontSize: 13 }}>—</span>;
                    const profit = p - c;
                    const margin = p > 0 ? Math.round((profit / p) * 100) : 0;
                    return <span style={{ color: profit >= 0 ? "#1a9c3e" : "#d72c0d" }}>{CURRENCY_SYMBOL}{profit.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 400, color: "#8c9196" }}>({margin}%)</span></span>;
                  })()}
                </div>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer", width: "fit-content" }}>
              <Toggle checked={form.charge_tax} onChange={(v) => set("charge_tax", v)} />
              <span style={{ fontWeight: 500, color: "#303030" }}>Charge tax on this product</span>
            </label>
          </div>}

          {/* Inventory */}
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={S.sectionTitle}>Inventory</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                Inventory tracked <Toggle checked={form.track_inventory} onChange={(v) => set("track_inventory", v)} />
              </label>
            </div>

            {/* Location + Quantity — يظهر بس لو مفيش variants وبيتم تتبع المخزون */}
            {form.track_inventory && form.variants.length === 0 && (
              <div style={{ border: "1px solid #e3e3e3", borderRadius: 7, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", padding: "8px 12px", background: "#f9fafb", borderBottom: "1px solid #e3e3e3" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#6d7175" }}>Location</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#6d7175" }}>Quantity</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", padding: "10px 12px", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 13 }}>Shop location</span>
                  <input type="number" value={form.quantity} onChange={(e) => set("quantity", parseInt(e.target.value) || 0)}
                    onFocus={(e) => { e.target.select(); iFocus(e); }} onBlur={iBlur}
                    style={{ ...S.inp, width: 80, textAlign: "right" }} min="0" placeholder="0" />
                </div>
              </div>
            )}

            {/* SKU / Barcode — يظهر بس لو مفيش variants (لأنهم بقوا لكل variant لوحده) */}
            {form.variants.length === 0 && (
              <div style={{ border: "1px solid #e3e3e3", borderRadius: 7, overflow: "hidden", marginBottom: 14 }}>
                <button type="button" onClick={() => setShowMoreDetails((v) => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#458fff", fontWeight: 500, borderBottom: showMoreDetails ? "1px solid #f1f1f1" : "none", textAlign: "left" }}>
                  <Chevron up={showMoreDetails} /> More details
                </button>
                {showMoreDetails && (
                  <div style={{ padding: "14px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ ...S.label, fontSize: 12, color: "#6d7175", fontWeight: 400, marginBottom: 3 }}>SKU (Stock Keeping Unit)</label>
                      <input value={form.sku} onChange={(e) => set("sku", e.target.value)} onFocus={iFocus} onBlur={iBlur} style={S.inp} placeholder="e.g. SHIRT-RED-M" />
                    </div>
                    <div>
                      <label style={{ ...S.label, fontSize: 12, color: "#6d7175", fontWeight: 400, marginBottom: 3 }}>Barcode (ISBN, UPC, GTIN, etc.)</label>
                      <input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} onFocus={iFocus} onBlur={iBlur} style={S.inp} placeholder="e.g. 123456789" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Sell when out of stock — ظاهر دايمًا طول ما فيه تتبع مخزون، بغض النظر عن الـ variants */}
            {form.track_inventory && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", border: "1px solid #e3e3e3", borderRadius: 8, background: "#fafafa" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#303030", marginBottom: 2 }}>Sell when out of stock</div>
                  <div style={{ fontSize: 12, color: "#6d7175" }}>{form.continue_selling ? "Continue selling when out of stock" : "Stop selling when out of stock"}</div>
                </div>
                <Toggle checked={form.continue_selling} onChange={(v) => set("continue_selling", v)} />
              </div>
            )}
          </div>

          {/* Variants */}
          <div ref={variantsRef} style={S.card}>
            <VariantsSection
              options={form.options} variants={form.variants} allImages={form.images}
              onOptionsChange={(opts, vars) => setForm((f) => {
                const collapsedToNone = opts.length === 0 && vars.length === 0 && f.variants.length > 0;
                if (!collapsedToNone) return { ...f, options: opts, variants: vars };
                const last = f.variants[0];
                return {
                  ...f,
                  options: opts,
                  variants: vars,
                  price: f.price.trim() !== "" ? f.price : (last.price || f.price),
                  compare_at_price: f.compare_at_price.trim() !== "" ? f.compare_at_price : (last.salePrice || f.compare_at_price),
                  cost_per_item: f.cost_per_item.trim() !== "" ? f.cost_per_item : (last.cost || f.cost_per_item),
                  quantity: last.quantity ?? f.quantity,
                  sku: f.sku.trim() !== "" ? f.sku : (last.sku || f.sku),
                  barcode: f.barcode.trim() !== "" ? f.barcode : (last.barcode || f.barcode),
                };
              })}
              onVariantsChange={(vars) => set("variants", vars)}
              onAddImage={handleAddImage}
              pricingDefaults={variantPricingDefaults}
              onFirstGroupPriceChange={setFirstGroupPrice}
            />
          </div>

          {/* Search engine listing */}
          <SeoListingSection
            title={form.title}
            description={form.description}
            price={seoPrice}
            urlHandle={form.url_handle}
            seoTitle={form.seo_title}
            seoDescription={form.seo_description}
            onChange={(t, d) => setForm((f) => ({ ...f, seo_title: t, seo_description: d }))}
            showPrice={seoShowPrice}
          />
        </div>

        {/* Right column */}
        <div>
          <div style={S.card}>
            <label style={{ ...S.label, marginBottom: 8 }}>Status</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)} onFocus={iFocus} onBlur={iBlur} style={{ ...S.inp, cursor: "pointer" }}>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="unlisted">Unlisted</option>
              <option value="archived">Archived</option>
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: form.status === "active" ? "#1a9c3e" : form.status === "unlisted" ? "#8b5cf6" : "#faad49",
              }} />
              <span style={{ fontSize: 12, color: "#6d7175" }}>
                {form.status === "active"
                  ? "Live in your store"
                  : form.status === "unlisted"
                  ? "Hidden from your product list — only visible via its direct link"
                  : "Hidden from customers"}
              </span>
            </div>

            {form.status === "unlisted" && (
              <div style={{ marginTop: 12, padding: 12, background: "#f9fafb", border: "1px solid #e3e3e3", borderRadius: 8 }}>
                <label style={{ ...S.label, fontSize: 11, marginBottom: 6 }}>رابط المنتج المباشر</label>
                {directProductLink ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid #c9cccf", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
                      <input readOnly value={directProductLink} onFocus={(e) => e.target.select()}
                        style={{ flex: 1, padding: "6px 8px", fontSize: 12, border: "none", outline: "none", background: "transparent", color: "#303030", minWidth: 0 }} />
                      <button type="button" onClick={copyDirectLink}
                        style={{ padding: "6px 10px", fontSize: 12, fontWeight: 600, color: linkCopied ? "#1a9c3e" : "#458fff", background: "none", border: "none", borderLeft: "1px solid #e3e3e3", cursor: "pointer", whiteSpace: "nowrap" }}>
                        {linkCopied ? "✓ اتنسخ" : "نسخ"}
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: "#6d7175", margin: "6px 0 0" }}>
                      شارك اللينك ده مع اللي عايز يشوف المنتج — مش هيظهر في صفحة منتجاتك العادية.
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 12, color: "#8c9196", margin: 0 }}>
                    احفظ المنتج الأول عشان يتحدد له لينك مباشر.
                  </p>
                )}
              </div>
            )}
          </div>
          <div style={S.card}>
            <label style={{ ...S.label, marginBottom: 8 }}>Product type</label>
            <ProductTypeInput selectedType={form.product_type} onChange={(v) => set("product_type", v)} localTypes={localTypes} onLocalTypesChange={setLocalTypes} />
          </div>
          <div style={S.card}>
            <label style={{ ...S.label, marginBottom: 8 }}>Tags</label>
            <TagsInput tags={form.tags} onChange={(v) => set("tags", v)} localAllTags={localAllTags} onLocalAllTagsChange={setLocalAllTags} />
          </div>
          <div style={S.card}>
            <label style={{ ...S.label, marginBottom: 8 }}>Collections</label>
            <CollectionsInput
              collections={form.collections}
              onChange={(v) => set("collections", v)}
              localAllCollections={localAllCollections}
              onLocalAllCollectionsChange={setLocalAllCollections}
            />
          </div>
        </div>
      </div>
    </div>
  );
}