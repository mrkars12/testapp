'use client'

import { useState, useEffect, useRef, useCallback } from "react";

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
    zIndex: 500,
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