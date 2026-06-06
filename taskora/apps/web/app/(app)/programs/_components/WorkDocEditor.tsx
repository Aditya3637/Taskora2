"use client";
import { RichDocEditor, type UploadedAttachment, type AiResult } from "@/components/richdoc/RichDocEditor";
import { mentionSuggestion } from "./mentionSuggestion";

export type { UploadedAttachment };

/**
 * Programs Work Doc editor — a thin wrapper over the shared RichDocEditor that
 * injects the program-scoped @-mention search. Upload / promote / AI adapters
 * are passed straight through by WorkDocPanel.
 */
export function WorkDocEditor(props: {
  value: unknown;
  editable: boolean;
  onChange: (json: unknown) => void;
  onPromote?: (text: string) => void;
  onUpload?: (file: File) => Promise<UploadedAttachment | null>;
  onAssist?: (action: string, selection: string) => Promise<AiResult>;
}) {
  return <RichDocEditor {...props} mention={mentionSuggestion()} placeholder="Write the plan… type “/” for blocks, “@” to link, or drop a file in." />;
}
