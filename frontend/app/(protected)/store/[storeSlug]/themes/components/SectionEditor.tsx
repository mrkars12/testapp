"use client";

import { useState } from "react";
import { ThemeSection } from "../page";
import { Image, X, Plus, Trash2, ChevronDown, ChevronUp, Smartphone } from "lucide-react";

interface SectionEditorProps {
  section: ThemeSection;
  onChange: (updates: Partial<ThemeSection>) => void;
}

const SECTION_EDITORS: Record<string, React.FC<any>> = {
  hero:                HeroSectionEditor,
  slideshow:           SlideshowSectionEditor,
  featured_collection: FeaturedCollectionEditor,
  product_grid:        ProductGridEditor,
  text_banner:         TextBannerEditor,
  newsletter:          NewsletterEditor,
  rich_text:           RichTextEditor,
};

export default function SectionEditor({ section, onChange }: SectionEditorProps) {
  const EditorComponent = SECTION_EDITORS[section.type];

  if (!EditorComponent) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-500">No editor for this section type.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900 mb-2">{section.name}</h3>
        <input
          type="text"
          value={section.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none"
          placeholder="Section name"
        />
      </div>
      <EditorComponent
        settings={section.settings}
        onChange={(settings: any) => onChange({ settings })}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-600">{label}</span>
      <button
        onClick={onToggle}
        className={`relative w-11 h-6 rounded-full transition-colors ${value ? "bg-blue-600" : "bg-gray-200"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function SegmentGroup<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>}
      <div className="flex gap-1.5 flex-wrap">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 py-2 border rounded-lg text-xs font-medium transition-colors min-w-0 ${
              value === o.value
                ? "border-blue-500 bg-blue-50 text-blue-600"
                : "border-gray-200 hover:border-gray-300 text-gray-600"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero Section Editor
// ─────────────────────────────────────────────────────────────────────────────
function HeroSectionEditor({ settings, onChange }: any) {
  const update = (key: string, value: any) => onChange({ ...settings, [key]: value });

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input type="text" value={settings.title || ""} onChange={(e) => update("title", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
        <input type="text" value={settings.subtitle || ""} onChange={(e) => update("subtitle", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Button Text</label>
          <input type="text" value={settings.buttonText || ""} onChange={(e) => update("buttonText", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Button Link</label>
          <input type="text" value={settings.buttonLink || ""} onChange={(e) => update("buttonLink", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" dir="ltr" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Background Image</label>
        <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center hover:border-blue-400 transition-colors">
          {settings.imageUrl ? (
            <div className="relative">
              <img src={settings.imageUrl} alt="" className="w-full h-32 object-cover rounded-lg" />
              <button onClick={() => update("imageUrl", "")}
                className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full hover:bg-red-600">
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="py-4">
              <Image size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Enter image URL below</p>
            </div>
          )}
        </div>
        <input type="url" dir="ltr" placeholder="https://..." value={settings.imageUrl || ""}
          onChange={(e) => update("imageUrl", e.target.value)}
          className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Overlay Opacity ({Math.round((settings.overlayOpacity || 0.4) * 100)}%)
        </label>
        <input type="range" min="0" max="1" step="0.05" value={settings.overlayOpacity || 0.4}
          onChange={(e) => update("overlayOpacity", parseFloat(e.target.value))}
          className="w-full accent-blue-600" />
      </div>
      <SegmentGroup label="Text Alignment" value={settings.textAlignment || "center"} onChange={(v) => update("textAlignment", v)}
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]} />
      <SegmentGroup label="Height" value={settings.height || "medium"} onChange={(v) => update("height", v)}
        options={[
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
        ]} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slideshow Section Editor  — full controls + 5 slider styles
// ─────────────────────────────────────────────────────────────────────────────
function SlideshowSectionEditor({ settings, onChange }: any) {
  const [expandedSlide, setExpandedSlide] = useState<string | null>(settings.slides?.[0]?.id ?? null);
  const [mobileTabs, setMobileTabs] = useState<Record<string, boolean>>({});

  const update = (key: string, value: any) => onChange({ ...settings, [key]: value });

  const updateSlide = (id: string, patch: any) => {
    onChange({
      ...settings,
      slides: (settings.slides || []).map((s: any) => s.id === id ? { ...s, ...patch } : s),
    });
  };

  const addSlide = () => {
    const newSlide = {
      id: `slide-${Date.now()}`,
      imageUrl: "",
      mobileImageUrl: "",
      title: "Slide Title",
      subtitle: "Slide description",
      buttonText: "Shop Now",
      buttonLink: "/",
      buttonStyle: "filled",
    };
    onChange({ ...settings, slides: [...(settings.slides || []), newSlide] });
    setExpandedSlide(newSlide.id);
  };

  const removeSlide = (id: string) => {
    const updated = (settings.slides || []).filter((s: any) => s.id !== id);
    onChange({ ...settings, slides: updated });
    if (expandedSlide === id) setExpandedSlide(updated[0]?.id ?? null);
  };

  const moveSlide = (id: string, dir: "up" | "down") => {
    const slides = [...(settings.slides || [])];
    const idx = slides.findIndex((s: any) => s.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === slides.length - 1) return;
    const swap = dir === "up" ? idx - 1 : idx + 1;
    [slides[idx], slides[swap]] = [slides[swap], slides[idx]];
    onChange({ ...settings, slides });
  };

  const slides: any[] = settings.slides || [];
  const sliderStyle: string = settings.sliderStyle || "classic";

  const SLIDER_STYLES = [
    { value: "classic",   label: "Classic Hero",    desc: "Side arrows + dots (e.g. phoenix-sports)" },
    { value: "cinematic", label: "Cinematic Fade",  desc: "Counter + vertical dots (e.g. luxury-fashion)" },
    { value: "split",     label: "Split Screen",    desc: "Image + text side by side" },
    { value: "kenburns",  label: "Ken Burns",       desc: "Slow zoom + thumbnails (e.g. nature-kids)" },
    { value: "thumbnail", label: "Thumbnail Strip", desc: "Gallery with scrollable thumbnail row" },
    { value: "spotlight", label: "Spotlight Carousel", desc: "Spaced peek cards + autoplay (e.g. kids-club)" },
  ];

  // Recommended image dimensions per slider style (desktop + mobile).
  // Shown in the upload fields so merchants upload correctly-sized art.
  const SLIDER_IMAGE_SPECS: Record<string, {
    ratio: string; desktop: string; mobile: string; note: string;
  }> = {
    classic:   { ratio: "12:5",  desktop: "1920 × 800 px",  mobile: "1080 × 1350 px", note: "Wide hero banner — keep key content centered." },
    cinematic: { ratio: "16:9",  desktop: "1920 × 1080 px", mobile: "1080 × 1920 px", note: "Full-bleed cinematic frame — high-resolution works best." },
    split:     { ratio: "1:1",   desktop: "1080 × 1080 px", mobile: "1080 × 900 px",  note: "Only half the screen shows the image — use a square crop." },
    kenburns:  { ratio: "16:9",  desktop: "1920 × 1080 px", mobile: "1080 × 1920 px", note: "Slow zoom crops the edges — leave safe margins." },
    thumbnail: { ratio: "16:9",  desktop: "1600 × 900 px",  mobile: "1080 × 1350 px", note: "Also used as the thumbnail — keep the subject clear." },
    spotlight: { ratio: "3:2",   desktop: "1500 × 1000 px", mobile: "1080 × 1350 px", note: "Shown as a rounded card with side peeks — keep the subject centred." },
  };
  const imageSpec = SLIDER_IMAGE_SPECS[sliderStyle] || SLIDER_IMAGE_SPECS.classic;

  return (
    <div className="space-y-5">

      {/* ══ Slider Style ══ */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Slider Style</h4>
        <div className="grid grid-cols-1 gap-2">
          {SLIDER_STYLES.map((st) => (
            <button
              key={st.value}
              onClick={() => update("sliderStyle", st.value)}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                sliderStyle === st.value
                  ? "border-blue-500 bg-blue-50 shadow-sm"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              }`}
            >
              <span className={`mt-1 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                sliderStyle === st.value ? "border-blue-500 bg-blue-500" : "border-gray-300"
              }`} />
              <div className="min-w-0">
                <p className={`text-sm font-medium ${sliderStyle === st.value ? "text-blue-700" : "text-gray-800"}`}>
                  {st.label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{st.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* ══ Slides ══ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-900">Slides</h4>
          <button onClick={addSlide} disabled={slides.length >= 10}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-40">
            <Plus size={14} /> Add Slide
          </button>
        </div>

        {/* Recommended image size for the selected slider style */}
        <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2">
          <p className="text-xs font-medium text-blue-700">
            Recommended image size for “{SLIDER_STYLES.find((s) => s.value === sliderStyle)?.label}”
          </p>
          <p className="text-xs text-blue-600/90 mt-0.5">
            🖥 Desktop {imageSpec.desktop} ({imageSpec.ratio}) · 📱 Mobile {imageSpec.mobile}
          </p>
          <p className="text-xs text-blue-500/70 mt-0.5">{imageSpec.note}</p>
        </div>

        <div className="space-y-2">
          {slides.map((slide: any, idx: number) => (
            <div key={slide.id}
              className={`border rounded-xl overflow-hidden ${expandedSlide === slide.id ? "border-blue-400 shadow-sm" : "border-gray-200"}`}>

              {/* Slide header row */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-white">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => moveSlide(slide.id, "up")} disabled={idx === 0}
                    className="text-gray-300 hover:text-gray-500 disabled:opacity-20">
                    <ChevronUp size={12} />
                  </button>
                  <button onClick={() => moveSlide(slide.id, "down")} disabled={idx === slides.length - 1}
                    className="text-gray-300 hover:text-gray-500 disabled:opacity-20">
                    <ChevronDown size={12} />
                  </button>
                </div>
                {slide.imageUrl ? (
                  <img src={slide.imageUrl} alt="" className="w-10 h-8 object-cover rounded-md border shrink-0"
                    onError={(e) => (e.currentTarget.style.display = "none")} />
                ) : (
                  <div className="w-10 h-8 rounded-md border bg-gray-100 flex items-center justify-center shrink-0">
                    <Image size={14} className="text-gray-400" />
                  </div>
                )}
                <button className="flex-1 text-left min-w-0"
                  onClick={() => setExpandedSlide(expandedSlide === slide.id ? null : slide.id)}>
                  <p className="text-sm font-medium text-gray-800 truncate">{slide.title || `Slide ${idx + 1}`}</p>
                  <p className="text-xs text-gray-400">Slide {idx + 1}</p>
                </button>
                <button onClick={() => removeSlide(slide.id)} disabled={slides.length <= 1}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-20 shrink-0">
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Expanded editor */}
              {expandedSlide === slide.id && (
                <div className="px-3 pb-4 pt-2 border-t bg-gray-50/50 space-y-3">

                  {/* Desktop / Mobile image tabs */}
                  <div>
                    <div className="flex gap-1 mb-2">
                      <button
                        onClick={() => setMobileTabs((p) => ({ ...p, [slide.id]: false }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          !mobileTabs[slide.id] ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-500"
                        }`}>
                        🖥 Desktop
                      </button>
                      <button
                        onClick={() => setMobileTabs((p) => ({ ...p, [slide.id]: true }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1 ${
                          mobileTabs[slide.id] ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-500"
                        }`}>
                        <Smartphone size={11} /> Mobile
                      </button>
                    </div>

                    {!mobileTabs[slide.id] ? (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Desktop Image
                          <span className="text-blue-500 font-normal ml-1">
                            — recommended {imageSpec.desktop} ({imageSpec.ratio})
                          </span>
                        </label>
                        <div className="flex gap-2">
                          <input type="url" dir="ltr" value={slide.imageUrl || ""}
                            onChange={(e) => updateSlide(slide.id, { imageUrl: e.target.value })}
                            placeholder="https://..."
                            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:border-blue-400 outline-none" />
                          {slide.imageUrl && (
                            <button onClick={() => updateSlide(slide.id, { imageUrl: "" })}
                              className="p-2 text-gray-400 hover:text-red-500 border border-gray-200 rounded-lg">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                        {slide.imageUrl && (
                          <img src={slide.imageUrl} alt="" className="mt-2 w-full h-24 object-cover rounded-lg border"
                            onError={(e) => (e.currentTarget.style.display = "none")} />
                        )}
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1 flex-wrap">
                          <Smartphone size={11} /> Mobile Image
                          <span className="text-blue-500 font-normal ml-1">
                            — recommended {imageSpec.mobile}
                          </span>
                          <span className="text-gray-400 font-normal ml-1">— optional</span>
                        </label>
                        <p className="text-xs text-gray-400 mb-2">
                          If left empty, the desktop image is used automatically.
                        </p>
                        <div className="flex gap-2">
                          <input type="url" dir="ltr" value={slide.mobileImageUrl || ""}
                            onChange={(e) => updateSlide(slide.id, { mobileImageUrl: e.target.value })}
                            placeholder="https://... (portrait image)"
                            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:border-blue-400 outline-none" />
                          {slide.mobileImageUrl && (
                            <button onClick={() => updateSlide(slide.id, { mobileImageUrl: "" })}
                              className="p-2 text-gray-400 hover:text-red-500 border border-gray-200 rounded-lg">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                        {slide.mobileImageUrl && (
                          <img src={slide.mobileImageUrl} alt=""
                            className="mt-2 w-20 h-32 object-cover rounded-lg border mx-auto block"
                            onError={(e) => (e.currentTarget.style.display = "none")} />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                    <input type="text" value={slide.title || ""}
                      onChange={(e) => updateSlide(slide.id, { title: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:border-blue-400 outline-none" />
                  </div>

                  {/* Subtitle */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subtitle</label>
                    <textarea value={slide.subtitle || ""}
                      onChange={(e) => updateSlide(slide.id, { subtitle: e.target.value })}
                      rows={2}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:border-blue-400 outline-none resize-none" />
                  </div>

                  {/* Button */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Button Text</label>
                      <input type="text" value={slide.buttonText || ""}
                        onChange={(e) => updateSlide(slide.id, { buttonText: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:border-blue-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Button Link</label>
                      <input type="text" dir="ltr" value={slide.buttonLink || ""}
                        onChange={(e) => updateSlide(slide.id, { buttonLink: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:border-blue-400 outline-none" />
                    </div>
                  </div>

                  {/* Button style */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Button Style</label>
                    <div className="flex gap-2">
                      {[{ value: "filled", label: "Filled" }, { value: "outline", label: "Outline" }].map((o) => (
                        <button key={o.value} onClick={() => updateSlide(slide.id, { buttonStyle: o.value })}
                          className={`flex-1 py-1.5 border rounded-lg text-xs font-medium transition-colors ${
                            slide.buttonStyle === o.value ? "border-blue-500 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-500 hover:border-gray-300"
                          }`}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* ══ Display Settings ══ */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-900">Display Settings</h4>

        {/* Height — hidden for Split (auto-sized) */}
        {sliderStyle !== "split" && (
          <SegmentGroup label="Height" value={settings.height || "large"} onChange={(v) => update("height", v)}
            options={[
              { value: "small",      label: "Small" },
              { value: "medium",     label: "Medium" },
              { value: "large",      label: "Large" },
              { value: "fullscreen", label: "Full Screen" },
            ]} />
        )}

        {/* Text Alignment — all on-image sliders (not Split which has its own half) */}
        {(sliderStyle === "classic" || sliderStyle === "kenburns" || sliderStyle === "cinematic" || sliderStyle === "thumbnail" || sliderStyle === "spotlight") && (
          <SegmentGroup label="Text Alignment" value={settings.textAlignment || "center"} onChange={(v) => update("textAlignment", v)}
            options={[
              { value: "right",  label: "Right" },
              { value: "center", label: "Center" },
              { value: "left",   label: "Left" },
            ]} />
        )}

        {/* Overlay Opacity — all styles except Split */}
        {sliderStyle !== "split" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Overlay Opacity ({Math.round((settings.overlayOpacity ?? 0.45) * 100)}%)
            </label>
            <input type="range" min={0} max={1} step={0.05} value={settings.overlayOpacity ?? 0.45}
              onChange={(e) => update("overlayOpacity", parseFloat(e.target.value))}
              className="w-full accent-blue-600" />
          </div>
        )}

      </div>

      <hr className="border-gray-100" />

      {/* ══ Content Style — per-slider customization ══════════════════════════
          Controls title size, subtitle size, button shape & color for the
          active slider style.  Elements with no text are never rendered
          (React conditional rendering, NOT display:none).                  */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-900">Content Style</h4>

        {/* Content vertical position — applies to ALL slider styles.
            Lets the merchant center the block (even a button with no text)
            over the image, or pin it to the top / bottom.                  */}
        <SegmentGroup
          label="Content Position"
          value={settings.verticalPosition || "center"}
          onChange={(v) => update("verticalPosition", v)}
          options={[
            { value: "top",    label: "Top" },
            { value: "center", label: "Center" },
            { value: "bottom", label: "Bottom" },
          ]}
        />

        {/* Title size */}
        <SegmentGroup
          label="Title Size"
          value={settings.titleSize || "lg"}
          onChange={(v) => update("titleSize", v)}
          options={[
            { value: "sm", label: "Small" },
            { value: "md", label: "Medium" },
            { value: "lg", label: "Large" },
            { value: "xl", label: "XL" },
          ]}
        />

        {/* Subtitle size */}
        <SegmentGroup
          label="Subtitle Size"
          value={settings.subtitleSize || "md"}
          onChange={(v) => update("subtitleSize", v)}
          options={[
            { value: "sm", label: "Small" },
            { value: "md", label: "Normal" },
            { value: "lg", label: "Large" },
          ]}
        />

        {/* Button shape */}
        <SegmentGroup
          label="Button Shape"
          value={settings.btnShape || "rounded"}
          onChange={(v) => update("btnShape", v)}
          options={[
            { value: "pill",    label: "Pill" },
            { value: "rounded", label: "Rounded" },
            { value: "square",  label: "Square" },
          ]}
        />

        {/* Button color — not shown for Cinematic (always uses border/ghost style) */}
        {sliderStyle !== "cinematic" && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Button Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings.btnColor || "#2563eb"}
                onChange={(e) => update("btnColor", e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0 p-0"
              />
              <span className="text-xs font-mono text-gray-400">{settings.btnColor || "#2563eb"}</span>
              {settings.btnColor && (
                <button
                  onClick={() => update("btnColor", "")}
                  className="ms-auto text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

        {/* Split-specific: text-half background + text color */}
        {sliderStyle === "split" && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Text Background</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.splitBgColor || "#f8f8f8"}
                  onChange={(e) => update("splitBgColor", e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                />
                <span className="text-xs font-mono text-gray-400">{settings.splitBgColor || "#f8f8f8"}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Text Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.splitTextColor || "#111111"}
                  onChange={(e) => update("splitTextColor", e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                />
                <span className="text-xs font-mono text-gray-400">{settings.splitTextColor || "#111111"}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <hr className="border-gray-100" />

      {/* ══ Autoplay ══ */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-900">Autoplay</h4>
        <Toggle label="Enable autoplay" value={settings.autoPlay ?? true}
          onToggle={() => update("autoPlay", !(settings.autoPlay ?? true))} />
        {(settings.autoPlay ?? true) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Slide duration ({((settings.autoPlaySpeed || 4000) / 1000).toFixed(1)}s)
            </label>
            <input type="range" min={2000} max={10000} step={500} value={settings.autoPlaySpeed || 4000}
              onChange={(e) => update("autoPlaySpeed", parseInt(e.target.value))}
              className="w-full accent-blue-600" />
          </div>
        )}
      </div>

      {/* ══ Transition effect — slide / fade (every full-image slider) ══ */}
      <>
        <hr className="border-gray-100" />
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Transition</h4>
          <SegmentGroup label="Transition effect"
            value={settings.transitionEffect || ((sliderStyle === "classic" || sliderStyle === "thumbnail" || sliderStyle === "spotlight") ? "slide" : "fade")}
            onChange={(v) => update("transitionEffect", v)}
            options={[
              { value: "slide", label: "Slide" },
              { value: "fade",  label: "Fade" },
            ]} />
          <p className="text-xs text-gray-400">
            {sliderStyle === "spotlight"
              ? "Slide يحرك البطاقات يميناً ويساراً · Fade يبدّلها في المكان بتلاشٍ."
              : "Slide moves the images left/right when changing slide; Fade changes them in place with no movement."}
          </p>
          {/* Slide direction — Spotlight Carousel only (Slide + Fade) */}
          {sliderStyle === "spotlight" && (
            <SegmentGroup label="Slide Direction"
              value={settings.slideDirection || "rtl"}
              onChange={(v) => update("slideDirection", v)}
              options={[
                { value: "rtl",    label: "← يمين لشمال" },
                { value: "ltr",    label: "شمال ليمين →" },
                { value: "center", label: "↔ شمال ويمين" },
              ]} />
          )}
        </div>
      </>

      {/* ══ Arrows — Classic, Ken Burns, Thumbnail ══ */}
      {(sliderStyle === "classic" || sliderStyle === "kenburns" || sliderStyle === "thumbnail" || sliderStyle === "spotlight") && (
        <>
          <hr className="border-gray-100" />
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">Arrows</h4>
            <Toggle label="Show arrows" value={settings.showArrows ?? true}
              onToggle={() => update("showArrows", !(settings.showArrows ?? true))} />
            {(settings.showArrows ?? true) && (
              <SegmentGroup label="Arrow style" value={settings.arrowStyle || "circle"} onChange={(v) => update("arrowStyle", v)}
                options={[
                  { value: "circle",  label: "Circle" },
                  { value: "square",  label: "Square" },
                  { value: "minimal", label: "Minimal" },
                ]} />
            )}
          </div>
        </>
      )}

      {/* ══ Navigation Indicators — works on EVERY slider style ══ */}
      <>
        <hr className="border-gray-100" />
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Navigation Indicators</h4>
          <Toggle label="Show indicators" value={settings.showDots ?? true}
            onToggle={() => update("showDots", !(settings.showDots ?? true))} />
          {(settings.showDots ?? true) && (
            <>
              <SegmentGroup label="Indicator style" value={settings.dotStyle || "circle"} onChange={(v) => update("dotStyle", v)}
                options={[
                  { value: "circle",    label: "Circles" },
                  { value: "line",      label: "Lines" },
                  { value: "number",    label: "Numbers" },
                  { value: "thumbnail", label: "Thumbnails" },
                  { value: "bar",       label: "Progress Bar" },
                  { value: "segments",  label: "Segmented Bar" },
                ]} />
              {/* Thumbnail strip alignment — only visible when thumbnail indicator is selected */}
              {settings.dotStyle === "thumbnail" && (
                <SegmentGroup label="Strip Position" value={settings.thumbnailStripAlign || "center"} onChange={(v) => update("thumbnailStripAlign", v)}
                  options={[
                    { value: "right",  label: "Right" },
                    { value: "center", label: "Center" },
                    { value: "left",   label: "Left" },
                  ]} />
              )}
              {settings.dotStyle === "segments" && (
                <>
                  <SegmentGroup label="Bar Width"
                    value={settings.segmentsWidth || "medium"}
                    onChange={(v) => update("segmentsWidth", v)}
                    options={[
                      { value: "narrow", label: "Narrow" },
                    ]} />
                  <p className="text-xs text-gray-400">
                    One bar per slide (stories-style) that fills as each slide plays — click any segment to jump.
                    {settings.autoPlay === false && " Enable Auto-play for the fill animation."}
                  </p>
                </>
              )}
              {settings.dotStyle === "bar" && (
                <>
                  <SegmentGroup label="Bar Width"
                    value={settings.barWidth || "medium"}
                    onChange={(v) => update("barWidth", v)}
                    options={[
                      { value: "narrow", label: "Narrow" },
                      { value: "medium", label: "Medium" },
                    ]} />
                  <p className="text-xs text-gray-400">
                    A single loading bar under the image that fills as each slide plays.
                    {settings.autoPlay === false && " Enable Auto-play for the fill animation."}
                  </p>
                </>
              )}
              {settings.dotStyle === "line" && (
                <SegmentGroup label="Fill style"
                  value={settings.linesAnim || "none"}
                  onChange={(v) => update("linesAnim", v)}
                  options={[
                    { value: "none",     label: "None" },
                    { value: "static",   label: "Static fill" },
                    { value: "animated", label: "Animated fill" },
                  ]} />
              )}
            </>
          )}
        </div>
      </>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Featured Collection Editor
// ─────────────────────────────────────────────────────────────────────────────
function FeaturedCollectionEditor({ settings, onChange }: any) {
  const update = (key: string, value: any) => onChange({ ...settings, [key]: value });
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input type="text" value={settings.title || ""} onChange={(e) => update("title", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Collection</label>
        <select value={settings.collectionId || ""} onChange={(e) => update("collectionId", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-500 outline-none">
          <option value="">Select a collection...</option>
          <option value="all">All Products</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Number of Products</label>
        <input type="number" min="1" max="12" value={settings.productsLimit || 4}
          onChange={(e) => update("productsLimit", parseInt(e.target.value))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Columns</label>
        <div className="flex gap-2">
          {[2, 3, 4].map((cols) => (
            <button key={cols} onClick={() => update("columns", cols)}
              className={`flex-1 py-2 border rounded-lg text-sm font-medium transition-colors ${
                settings.columns === cols ? "border-blue-500 bg-blue-50 text-blue-600" : "border-gray-200 hover:border-gray-300 text-gray-600"
              }`}>
              {cols}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Show price" value={settings.showPrice ?? true} onToggle={() => update("showPrice", !settings.showPrice)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Product Grid Editor
// ─────────────────────────────────────────────────────────────────────────────
function ProductGridEditor({ settings, onChange }: any) {
  const update = (key: string, value: any) => onChange({ ...settings, [key]: value });
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input type="text" value={settings.title || ""} onChange={(e) => update("title", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Collection</label>
        <select value={settings.collectionId || ""} onChange={(e) => update("collectionId", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-500 outline-none">
          <option value="">All Products</option>
          <option value="all">All</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Number of Products</label>
        <input type="number" min="1" max="24" value={settings.productsLimit || 8}
          onChange={(e) => update("productsLimit", parseInt(e.target.value))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Columns</label>
        <div className="flex gap-2">
          {[2, 3, 4].map((cols) => (
            <button key={cols} onClick={() => update("columns", cols)}
              className={`flex-1 py-2 border rounded-lg text-sm font-medium transition-colors ${
                settings.columns === cols ? "border-blue-500 bg-blue-50 text-blue-600" : "border-gray-200 hover:border-gray-300 text-gray-600"
              }`}>
              {cols}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Text Banner Editor
// ─────────────────────────────────────────────────────────────────────────────
function TextBannerEditor({ settings, onChange }: any) {
  const update = (key: string, value: any) => onChange({ ...settings, [key]: value });
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Text</label>
        <textarea value={settings.text || ""} onChange={(e) => update("text", e.target.value)} rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Background</label>
          <div className="flex items-center gap-2">
            <input type="color" value={settings.backgroundColor || "#000000"}
              onChange={(e) => update("backgroundColor", e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
            <span className="text-xs font-mono text-gray-500">{settings.backgroundColor}</span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Text Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={settings.textColor || "#ffffff"}
              onChange={(e) => update("textColor", e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
            <span className="text-xs font-mono text-gray-500">{settings.textColor}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Newsletter Editor
// ─────────────────────────────────────────────────────────────────────────────
function NewsletterEditor({ settings, onChange }: any) {
  const update = (key: string, value: any) => onChange({ ...settings, [key]: value });
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input type="text" value={settings.title || ""} onChange={(e) => update("title", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
        <input type="text" value={settings.subtitle || ""} onChange={(e) => update("subtitle", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Button Text</label>
        <input type="text" value={settings.buttonText || ""} onChange={(e) => update("buttonText", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rich Text Editor
// ─────────────────────────────────────────────────────────────────────────────
function RichTextEditor({ settings, onChange }: any) {
  const update = (key: string, value: any) => onChange({ ...settings, [key]: value });
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input type="text" value={settings.title || ""} onChange={(e) => update("title", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
        <textarea value={settings.content || ""} onChange={(e) => update("content", e.target.value)} rows={5}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none resize-none" />
      </div>
      <SegmentGroup label="Alignment" value={settings.alignment || "center"} onChange={(v) => update("alignment", v)}
        options={[
          { value: "left",   label: "Left" },
          { value: "center", label: "Center" },
          { value: "right",  label: "Right" },
        ]} />
    </div>
  );
}
