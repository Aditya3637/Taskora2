"use client";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
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
import { useEffect, useRef } from "react";
import {
  Bold, Italic, Heading1, Heading2, List, ListOrdered, ListChecks,
  Quote, Code, Lightbulb, Table as TableIcon, ListPlus, Paperclip,
} from "lucide-react";
import { mentionSuggestion } from "./mentionSuggestion";
import { AttachmentNode } from "./AttachmentNode";
import { CalloutNode } from "./CalloutNode";
import { SlashCommand } from "./slashCommand";
import { AiAssist, type AiResult } from "./AiAssist";

// What WorkDocPanel.uploadAttachment resolves to after sign → upload → record.
export type UploadedAttachment = { id: string; filename: string; mime_type: string; is_image: boolean };

const UPLOAD_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,.docx,.xlsx,.pptx,.csv,.txt";

/**
 * Workspace Document editor (D2 + the editor pass). TipTap surface with a
 * Notion-grade block set: headings, lists, to-do lists, quote, callout, toggle,
 * code, divider, tables, @-mentions, file/image attachments — inserted via the
 * "/" slash menu, markdown shortcuts, or the toolbar. Drag/paste uploads files.
 */
export function WorkDocEditor({
  value,
  editable,
  onChange,
  onPromote,
  onUpload,
  onAssist,
}: {
  value: unknown;
  editable: boolean;
  onChange: (json: unknown) => void;
  // D5: promote the current selection (or current line) to a task.
  onPromote?: (text: string) => void;
  // §8: sign → upload → record a file; returns the recorded attachment.
  onUpload?: (file: File) => Promise<UploadedAttachment | null>;
  // AI pass: run a ✨ action server-side and return the result.
  onAssist?: (action: string, selection: string) => Promise<AiResult>;
}) {
  // The paste/drop/slash handlers are configured once but need the live
  // onUpload + editor instance — reach them through refs.
  const onUploadRef = useRef(onUpload);
  useEffect(() => { onUploadRef.current = onUpload; }, [onUpload]);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openFilePicker = () => fileInputRef.current?.click();

  // Upload one or more files (picked, pasted, dropped, or via "/") and insert
  // an attachment node for each — the heart of the resistance-free flow.
  const uploadFiles = async (files: File[]) => {
    const up = onUploadRef.current;
    const ed = editorRef.current;
    if (!up || !ed || files.length === 0) return;
    for (const file of files) {
      const att = await up(file);
      if (att) {
        ed.chain().focus().insertContent({
          type: "attachment",
          attrs: { attachmentId: att.id, filename: att.filename, mime: att.mime_type, isImage: att.is_image },
        }).run();
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
        placeholder: "Write the plan… type “/” for blocks, “@” to link, or drop a file in.",
        // Only the very first empty block shows the hint, so callouts/cells stay clean.
        includeChildren: false,
      }),
      Mention.configure({
        HTMLAttributes: { class: "wd-mention" },
        // id is the "type:uuid" payload the backend reconciles into entity_links.
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        renderHTML: ({ node }) => ["span", { class: "wd-mention" }, `@${node.attrs.label ?? node.attrs.id}`],
        suggestion: mentionSuggestion(),
      }),
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
        if (files.length && onUploadRef.current) { event.preventDefault(); void uploadFiles(files); return true; }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (files.length && onUploadRef.current) { event.preventDefault(); void uploadFiles(files); return true; }
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
          accept={UPLOAD_ACCEPT}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploadFiles(files);
          }}
        />
      )}
      {editable && editor && <Toolbar editor={editor} onPromote={onPromote} onPickFile={onUpload ? openFilePicker : undefined} onAssist={onAssist} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  onPromote,
  onPickFile,
  onAssist,
}: {
  editor: Editor;
  onPromote?: (text: string) => void;
  onPickFile?: () => void;
  onAssist?: (action: string, selection: string) => Promise<AiResult>;
}) {
  // D5: promote selected text — or, if nothing is selected, the current line —
  // into a task under this initiative.
  const promote = () => {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    const text = empty
      ? (state.selection.$from.parent.textContent || "").trim()
      : state.doc.textBetween(from, to, " ").trim();
    if (text && onPromote) onPromote(text);
  };

  const Btn = ({ on, active, label, children }: {
    on: () => void; active: boolean; label: string; children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={on}
      className={`p-1.5 rounded-md hover:bg-mist transition-colors ${active ? "bg-mist text-ocean" : "text-fg-muted"}`}
    >
      {children}
    </button>
  );

  const Sep = () => <span className="w-px h-5 bg-pebble mx-1" />;

  return (
    <div className="sticky top-0 z-10 flex items-center gap-0.5 flex-wrap border-b border-pebble bg-white/90 backdrop-blur px-1 py-1 mb-3">
      <Btn label="Bold" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="w-4 h-4" />
      </Btn>
      <Btn label="Italic" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="w-4 h-4" />
      </Btn>
      <Sep />
      <Btn label="Heading 1" active={editor.isActive("heading", { level: 1 })} on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="w-4 h-4" />
      </Btn>
      <Btn label="Heading 2" active={editor.isActive("heading", { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="w-4 h-4" />
      </Btn>
      <Sep />
      <Btn label="Bullet list" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="w-4 h-4" />
      </Btn>
      <Btn label="Numbered list" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="w-4 h-4" />
      </Btn>
      <Btn label="To-do list" active={editor.isActive("taskList")} on={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks className="w-4 h-4" />
      </Btn>
      <Sep />
      <Btn label="Quote" active={editor.isActive("blockquote")} on={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="w-4 h-4" />
      </Btn>
      <Btn label="Callout" active={editor.isActive("callout")} on={() => editor.chain().focus().toggleCallout().run()}>
        <Lightbulb className="w-4 h-4" />
      </Btn>
      <Btn label="Table" active={editor.isActive("table")} on={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableIcon className="w-4 h-4" />
      </Btn>
      <Btn label="Code block" active={editor.isActive("codeBlock")} on={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code className="w-4 h-4" />
      </Btn>
      {onPickFile && (
        <>
          <Sep />
          <button
            type="button"
            title="Attach a file or image"
            aria-label="Attach a file or image"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPickFile}
            className="p-1.5 rounded-md hover:bg-mist text-fg-muted transition-colors"
          >
            <Paperclip className="w-4 h-4" />
          </button>
        </>
      )}
      {onPromote && (
        <>
          <Sep />
          <button
            type="button"
            title="Add selection (or current line) as a task"
            onMouseDown={(e) => e.preventDefault()}
            onClick={promote}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-fg-muted hover:bg-mist hover:text-ocean transition-colors"
          >
            <ListPlus className="w-4 h-4" /> Task
          </button>
        </>
      )}
      {onAssist && (
        <span className="ml-auto">
          <AiAssist editor={editor} onAssist={onAssist} onPromote={onPromote} />
        </span>
      )}
    </div>
  );
}
