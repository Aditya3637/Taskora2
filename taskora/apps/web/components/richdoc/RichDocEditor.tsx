"use client";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Details from "@tiptap/extension-details";
import DetailsSummary from "@tiptap/extension-details-summary";
import DetailsContent from "@tiptap/extension-details-content";
import ListKeymap from "@tiptap/extension-list-keymap";
import Image from "@tiptap/extension-image";
import { useEffect, useRef } from "react";
import { Bold, Italic, Heading1, Heading2, Quote, ListPlus, Rows3, Columns3, Trash2 } from "lucide-react";
import { AttachmentNode } from "./AttachmentNode";
import { CalloutNode } from "./CalloutNode";
import { SlashCommand } from "./slashCommand";
import { AiAssist, type AiResult } from "./AiAssist";

export type { AiResult };
// What an upload adapter resolves to after it has stored a file.
export type UploadedAttachment = { id: string; filename: string; mime_type: string; is_image: boolean };

const UPLOAD_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,.docx,.xlsx,.pptx,.csv,.txt";

/**
 * Shared rich-document editor — a Notion-grade TipTap surface (headings, lists,
 * to-do lists, quote, callout, toggle, code, divider, tables, attachments, and
 * an optional @-mention) inserted via the "/" slash menu, markdown shortcuts, or
 * the toolbar. Drag/paste uploads files.
 *
 * Surface-agnostic: the host injects behaviour via adapters — `onUpload`
 * (store a file), `onPromote` (turn a line into a task / checklist item),
 * `onAssist` (run an AI action), and `mention` (a TipTap suggestion config).
 * The Programs Work Doc and the Notebook are both thin wrappers over this.
 */
export function RichDocEditor({
  value,
  editable,
  onChange,
  onPromote,
  onUpload,
  onImageUpload,
  onAssist,
  mention,
  placeholder,
  promoteLabel,
  renderExtra,
}: {
  value: unknown;
  editable: boolean;
  onChange: (json: unknown) => void;
  // promote the current selection (or current line) — task, checklist item, etc.
  onPromote?: (text: string) => void;
  // store a file as an attachment (id-based node); omit to disable file uploads.
  onUpload?: (file: File) => Promise<UploadedAttachment | null>;
  // store an image and return its src (e.g. a data URL) for an inline image
  // node; takes precedence for image files. The Notebook uses this.
  onImageUpload?: (file: File) => Promise<{ src: string; alt?: string } | null>;
  // run a ✨ AI action server-side and return the result; omit to hide AI.
  onAssist?: (action: string, selection: string) => Promise<AiResult>;
  // a TipTap suggestion config for "@"; omit to disable mentions on this surface.
  mention?: unknown;
  placeholder?: string;
  // verb for the "promote a line" affordances (default "task").
  promoteLabel?: string;
  // host-injected toolbar control(s) — receives the live editor (e.g. the
  // Notebook's "Delegate" button). Keeps surface-specific actions out of here.
  renderExtra?: (editor: Editor) => React.ReactNode;
}) {
  // The paste/drop/slash handlers are configured once but need the live
  // adapters + editor instance — reach them through refs.
  const onUploadRef = useRef(onUpload);
  useEffect(() => { onUploadRef.current = onUpload; }, [onUpload]);
  const onImageUploadRef = useRef(onImageUpload);
  useEffect(() => { onImageUploadRef.current = onImageUpload; }, [onImageUpload]);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openFilePicker = () => fileInputRef.current?.click();

  // Upload one or more files (picked, pasted, dropped, or via "/") and insert
  // an attachment node for each — the heart of the resistance-free flow.
  const uploadFiles = async (files: File[]) => {
    const ed = editorRef.current;
    const up = onUploadRef.current;
    const img = onImageUploadRef.current;
    if (!ed || files.length === 0 || (!up && !img)) return;
    for (const file of files) {
      if (img && file.type.startsWith("image/")) {
        const r = await img(file);
        if (r) ed.chain().focus().insertContent({ type: "image", attrs: { src: r.src, alt: r.alt ?? null } }).run();
      } else if (up) {
        const att = await up(file);
        if (att) {
          ed.chain().focus().insertContent({
            type: "attachment",
            attrs: { attachmentId: att.id, filename: att.filename, mime: att.mime_type, isImage: att.is_image },
          }).run();
        }
      }
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      // Enter on an empty list/checklist item lifts out of the list (and
      // Backspace joins) — covers bullet, ordered, AND task lists. Without this
      // you can't exit a checklist except by toggling it off from the toolbar.
      ListKeymap,
      AttachmentNode,
      // Plain image node (data-URL friendly) — used by the Notebook's inline
      // images. Programs uploads go through AttachmentNode instead.
      Image.configure({ allowBase64: true, HTMLAttributes: { class: "wd-image" } }),
      CalloutNode,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      SlashCommand.configure({ onImage: openFilePicker }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write… type “/” for blocks, “@” to link, or drop a file in.",
        // Only the very first empty block shows the hint, so callouts/cells stay clean.
        includeChildren: false,
      }),
      // Mentions are opt-in per surface (the host supplies the suggestion config).
      ...(mention
        ? [Mention.configure({
            HTMLAttributes: { class: "wd-mention" },
            // id is the "type:uuid" payload the host reconciles (e.g. entity_links).
            renderText: ({ node }: any) => `@${node.attrs.label ?? node.attrs.id}`,
            renderHTML: ({ node }: any) => ["span", { class: "wd-mention", "data-mention-id": node.attrs.id }, `@${node.attrs.label ?? node.attrs.id}`],
            suggestion: mention as any,
          })]
        : []),
    ],
    content: value && typeof value === "object" && Object.keys(value as object).length ? (value as object) : "",
    editable,
    // Next.js SSR: don't render on the server to avoid hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "ProseMirror focus:outline-none min-h-[55vh] text-[15px] text-fg" },
      // Drag-drop or paste an image/file anywhere on the canvas to upload it.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.size > 0);
        if (files.length && (onUploadRef.current || onImageUploadRef.current)) { event.preventDefault(); void uploadFiles(files); return true; }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (files.length && (onUploadRef.current || onImageUploadRef.current)) { event.preventDefault(); void uploadFiles(files); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  // Keep editability in sync if the caller's permission resolves after mount.
  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  return (
    <div className="workdoc-content">
      {editable && (
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          // Image-only surfaces (e.g. the Notebook) restrict the picker to images.
          accept={onUpload ? UPLOAD_ACCEPT : "image/*"}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploadFiles(files);
          }}
        />
      )}
      {/* Formatting lives in a floating menu shown only on text selection —
          the page itself stays clean. Blocks come from the "/" menu. */}
      {editable && editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 120 }}
          className="wd-bubble"
          shouldShow={({ editor, state }) => !state.selection.empty && !editor.isActive("table")}
        >
          <FmtBtn label="Bold" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}><Bold className="w-4 h-4" /></FmtBtn>
          <FmtBtn label="Italic" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}><Italic className="w-4 h-4" /></FmtBtn>
          <span className="w-px h-5 bg-pebble/70 mx-0.5" />
          <FmtBtn label="Heading 1" active={editor.isActive("heading", { level: 1 })} on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="w-4 h-4" /></FmtBtn>
          <FmtBtn label="Heading 2" active={editor.isActive("heading", { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="w-4 h-4" /></FmtBtn>
          <FmtBtn label="Quote" active={editor.isActive("blockquote")} on={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="w-4 h-4" /></FmtBtn>
        </BubbleMenu>
      )}
      {/* Table controls — appear whenever the cursor is inside a table. */}
      {editable && editor && (
        <BubbleMenu
          editor={editor}
          pluginKey="tableMenu"
          tippyOptions={{ duration: 120, placement: "top" }}
          className="wd-bubble"
          shouldShow={({ editor }) => editor.isActive("table")}
        >
          <TblBtn label="Add row" on={() => editor.chain().focus().addRowAfter().run()}><Rows3 className="w-4 h-4" /> Row</TblBtn>
          <TblBtn label="Add column" on={() => editor.chain().focus().addColumnAfter().run()}><Columns3 className="w-4 h-4" /> Col</TblBtn>
          <span className="w-px h-5 bg-pebble/70 mx-0.5" />
          <TblBtn label="Delete row" on={() => editor.chain().focus().deleteRow().run()}><Rows3 className="w-4 h-4" />−</TblBtn>
          <TblBtn label="Delete column" on={() => editor.chain().focus().deleteColumn().run()}><Columns3 className="w-4 h-4" />−</TblBtn>
          <span className="w-px h-5 bg-pebble/70 mx-0.5" />
          <TblBtn label="Delete table" danger on={() => editor.chain().focus().deleteTable().run()}><Trash2 className="w-4 h-4" /></TblBtn>
        </BubbleMenu>
      )}
      {/* Signature actions — a quiet right-aligned row, not a full toolbar. */}
      {editable && editor && (onAssist || onPromote || renderExtra) && (
        <div className="flex items-center justify-end gap-1 mb-1 -mt-1">
          {onPromote && <PromoteButton editor={editor} onPromote={onPromote} label={promoteLabel} />}
          {renderExtra?.(editor)}
          {onAssist && <AiAssist editor={editor} onAssist={onAssist} onPromote={onPromote} promoteLabel={promoteLabel} />}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function FmtBtn({ on, active, label, children }: {
  on: () => void; active: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={on}
      className={`p-1.5 rounded-md transition-colors ${active ? "text-ocean bg-mist" : "text-fg-muted hover:bg-mist"}`}
    >
      {children}
    </button>
  );
}

function TblBtn({ on, label, danger, children }: {
  on: () => void; label: string; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={`flex items-center gap-0.5 px-1.5 py-1 rounded-md text-xs font-medium transition-colors ${
        danger ? "text-fg-muted hover:bg-red-50 hover:text-red-600" : "text-fg-muted hover:bg-mist hover:text-ocean"
      }`}
    >
      {children}
    </button>
  );
}

function PromoteButton({ editor, onPromote, label }: {
  editor: Editor; onPromote: (text: string) => void; label?: string;
}) {
  const promote = () => {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    const text = empty
      ? (state.selection.$from.parent.textContent || "").trim()
      : state.doc.textBetween(from, to, " ").trim();
    if (text) onPromote(text);
  };
  return (
    <button
      type="button"
      title={`Add selection (or current line) as a ${label ?? "task"}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={promote}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-fg-muted hover:bg-mist hover:text-ocean transition-colors capitalize"
    >
      <ListPlus className="w-4 h-4" /> {label ?? "Task"}
    </button>
  );
}
