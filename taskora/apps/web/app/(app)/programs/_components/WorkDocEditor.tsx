"use client";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { useEffect } from "react";
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Quote, Code, ListPlus } from "lucide-react";
import { mentionSuggestion } from "./mentionSuggestion";

/**
 * TipTap rich-text editor for a Workspace Document (D2). StarterKit gives
 * headings, lists, bold/italic, quote, code, plus markdown input rules
 * (type "# " / "- " / "> "). Slash menu, @-mentions, AI, and uploads are
 * follow-up slices (D3 / D4 / §8); this is the core writing surface.
 */
export function WorkDocEditor({
  value,
  editable,
  onChange,
  onPromote,
}: {
  value: unknown;
  editable: boolean;
  onChange: (json: unknown) => void;
  // D5: promote the current selection (or current line) to a task.
  onPromote?: (text: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Write the plan… type “# ” for a heading, “- ” for a list, “@” to link.",
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
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  // Keep editability in sync if the caller's permission resolves after mount.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  return (
    <div className="workdoc-content">
      {editable && editor && <Toolbar editor={editor} onPromote={onPromote} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, onPromote }: { editor: Editor; onPromote?: (text: string) => void }) {
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

  const Btn = ({
    on,
    active,
    label,
    children,
  }: {
    on: () => void;
    active: boolean;
    label: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={on}
      className={`p-1.5 rounded-md hover:bg-mist transition-colors ${
        active ? "bg-mist text-ocean" : "text-fg-muted"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="sticky top-0 z-10 flex items-center gap-0.5 flex-wrap border-b border-pebble bg-white/90 backdrop-blur px-1 py-1 mb-2">
      <Btn label="Bold" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="w-4 h-4" />
      </Btn>
      <Btn label="Italic" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="w-4 h-4" />
      </Btn>
      <span className="w-px h-5 bg-pebble mx-1" />
      <Btn label="Heading 1" active={editor.isActive("heading", { level: 1 })} on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="w-4 h-4" />
      </Btn>
      <Btn label="Heading 2" active={editor.isActive("heading", { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="w-4 h-4" />
      </Btn>
      <span className="w-px h-5 bg-pebble mx-1" />
      <Btn label="Bullet list" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="w-4 h-4" />
      </Btn>
      <Btn label="Numbered list" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="w-4 h-4" />
      </Btn>
      <Btn label="Quote" active={editor.isActive("blockquote")} on={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="w-4 h-4" />
      </Btn>
      <Btn label="Code block" active={editor.isActive("codeBlock")} on={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code className="w-4 h-4" />
      </Btn>
      {onPromote && (
        <>
          <span className="w-px h-5 bg-pebble mx-1" />
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
    </div>
  );
}
