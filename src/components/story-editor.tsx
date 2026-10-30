"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { StoryContent } from "@/db/schema";
import { fromEditorContent, toEditorContent } from "@/lib/editor-content";
import { countStoryText, lengthError, MAX_TEXT_LENGTH, submissionContent } from "@/lib/submission";
import { StoryText } from "./story-text";

type Props = { slug: string; minLength: number; maxLength: number; initial?: { id: string; revision: number; title: string; content: StoryContent } };

function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    let allowLeave = false;
    const guard = crypto.randomUUID();
    const url = window.location.href;
    window.history.pushState({ ...window.history.state, grelqaGuard: guard }, "", url);
    const question = () => window.confirm("Есть несохранённые изменения. Уйти без сохранения?");
    const unload = (event: BeforeUnloadEvent) => { if (!allowLeave) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = new URL(link.href);
      if (target.pathname === location.pathname && target.search === location.search && target.origin === location.origin) return;
      if (question()) allowLeave = true;
      else { event.preventDefault(); event.stopPropagation(); }
    };
    const pop = (event: PopStateEvent) => {
      if (allowLeave) return;
      event.stopImmediatePropagation();
      if (question()) { allowLeave = true; window.history.back(); }
      else window.history.pushState({ ...window.history.state, grelqaGuard: guard }, "", url);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop, true);
      if (!allowLeave && window.history.state?.grelqaGuard === guard && window.location.href === url) window.history.back();
    };
  }, [dirty]);
}

export function StoryEditor({ slug, minLength, maxLength, initial }: Props) {
  const [title, setTitle] = useState(initial?.title || "");
  const [content, setContent] = useState<StoryContent>(initial?.content || [{ type: "paragraph", children: [] }]);
  const [saved, setSaved] = useState({ id: initial?.id, revision: initial?.revision, snapshot: JSON.stringify({ title: initial?.title || "", content: initial?.content || [{ type: "paragraph", children: [] }] }) });
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ blockquote: false, bulletList: false, code: false, codeBlock: false, heading: false, horizontalRule: false, listItem: false, listKeymap: false, orderedList: false, strike: false, underline: false, link: false, trailingNode: false })],
    content: toEditorContent(initial?.content || [{ type: "paragraph", children: [] }]),
    editorProps: { attributes: { role: "textbox", "aria-label": "Текст рассказа", "aria-multiline": "true", class: "prose-editor" } },
    onUpdate: ({ editor }) => setContent(fromEditorContent(editor.getJSON())),
  });
  const selection = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive("bold") || false, italic: editor?.isActive("italic") || false }) });
  const dirty = JSON.stringify({ title, content }) !== saved.snapshot;
  useUnsavedWarning(dirty);
  useEffect(() => { editor?.setEditable(!busy); }, [editor, busy]);
  const length = countStoryText(content);
  const invalidLength = lengthError(length, minLength, maxLength) || (length > MAX_TEXT_LENGTH ? "Превышен технический предел текста." : undefined);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    if (!title.trim() || Array.from(title.trim()).length > 200) { setMessage("Название: от 1 до 200 знаков."); return; }
    let normalized: StoryContent;
    try { normalized = submissionContent(content); } catch (error) { setMessage((error as Error).message); return; }
    if (invalidLength) { setMessage(invalidLength); return; }
    setBusy(true);
    const snapshot = JSON.stringify({ title, content });
    try {
      const response = await fetch("/api/stories/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, title, content: normalized, id: saved.id, revision: saved.revision }) });
      const result = await response.json();
      setMessage(result.message || "Не удалось сохранить работу.");
      if (response.ok) setSaved({ id: result.id, revision: result.revision, snapshot });
    } catch { setMessage("Ошибка сети. Текст остаётся в редакторе; попробуйте сохранить снова."); }
    finally { setBusy(false); }
  }

  return <form className="story-form" onSubmit={save}>
    <label>Название (до 200 знаков)<input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={400} disabled={busy} /></label>
    <div className="editor-toolbar" role="toolbar" aria-label="Форматирование текста">
      <button type="button" disabled={!editor || busy} aria-pressed={selection?.bold} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>Полужирный</strong></button>
      <button type="button" disabled={!editor || busy} aria-pressed={selection?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>Курсив</em></button>
      <button type="button" disabled={busy} aria-pressed={preview} onClick={() => setPreview(!preview)}>Предпросмотр</button>
    </div>
    <p className="muted">Enter — новый абзац; Shift+Enter — перевод строки. Ctrl/Cmd+B — полужирный, Ctrl/Cmd+I — курсив.</p>
    <div hidden={preview}><EditorContent editor={editor} /></div>
    {preview && <section className="story-preview" aria-label="Предварительный просмотр"><h2>{title || "Без названия"}</h2><StoryText content={content} /></section>}
    <p className="story-counter" aria-live="polite">{new Intl.NumberFormat("ru-RU").format(length)} знаков с пробелами</p>
    <p className="muted">Минимум: {minLength || "не ограничен"}. Максимум: {maxLength || "не ограничен"}. Подсчёт временный: кодовые точки Unicode, два перевода строки между абзацами, без заголовка и разметки.</p>
    {invalidLength && <p role="status">{invalidLength}</p>}
    <div className="editor-actions"><button className="button" disabled={busy || !editor || Boolean(invalidLength)} type="submit">{busy ? "Сохранение…" : "Сохранить работу"}</button><span className="muted">{dirty ? "Есть несохранённые изменения" : "Изменений нет"}</span></div>
    {message && <p role="status" className="auth-message">{message}</p>}
    {saved.id && <Link className="text-link" href={`/account/my-stories/${saved.id}`}>Посмотреть сохранённую работу →</Link>}
    <noscript>Для редактора требуется JavaScript.</noscript>
  </form>;
}
