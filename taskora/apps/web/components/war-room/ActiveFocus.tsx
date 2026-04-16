"use client";
import { EntityStatusMatrix } from "./EntityStatusMatrix";

export function ActiveFocus() {
  return (
    <div className="p-6">
      <div className="text-center py-16 text-steel">
        <p className="text-lg font-medium">Select a task from the Decision Queue</p>
        <p className="text-sm mt-2">The task details and entity status matrix will appear here.</p>
      </div>
      <EntityStatusMatrix entities={[]} />
    </div>
  );
}
