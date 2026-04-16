interface EntityRow {
  name: string;
  status: "done" | "in_progress" | "blocked" | "pending_decision";
  due_date: string;
  last_updated: string;
}

const STATUS_DOT: Record<string, string> = {
  done: "bg-green-500",
  in_progress: "bg-blue-500",
  blocked: "bg-taskora-red animate-pulse",
  pending_decision: "bg-purple-500",
};

export function EntityStatusMatrix({ entities }: { entities: EntityRow[] }) {
  return (
    <div className="mt-4 rounded-xl border border-pebble overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-mist">
          <tr>
            {["Building/Client", "Status", "Due", "Last Update", "Action"].map((h) => (
              <th key={h} className="text-left px-3 py-2 text-steel font-medium text-xs">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entities.map((e, i) => (
            <tr key={i} className="border-t border-pebble hover:bg-mist/50">
              <td className="px-3 py-3 font-medium text-midnight">{e.name}</td>
              <td className="px-3 py-3">
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[e.status]}`} />
                  <span className="capitalize text-xs text-midnight">{e.status.replace(/_/g, " ")}</span>
                </span>
              </td>
              <td className="px-3 py-3 text-steel text-xs">{e.due_date}</td>
              <td className="px-3 py-3 text-steel text-xs">{e.last_updated}</td>
              <td className="px-3 py-3">
                {e.status === "blocked" && (
                  <button className="text-xs text-taskora-red border border-red-200 px-2 py-1 rounded hover:bg-red-50">Unblock</button>
                )}
                {e.status === "in_progress" && (
                  <button className="text-xs text-ocean border border-ocean/30 px-2 py-1 rounded hover:bg-blue-50">Nudge</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
