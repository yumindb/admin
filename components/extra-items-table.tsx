/**
 * 唯讀展示 — 用在 log detail / approval detail。
 * 跟 ExtraItemsEditor 同構,但這個只渲染。
 */

export type ExtraTableCol<T> = {
  key: keyof T & string;
  label: string;
  align?: "left" | "right";
};

export function ExtraItemsTable<T extends Record<string, unknown>>({
  rows,
  cols,
}: {
  rows: T[];
  cols: ExtraTableCol<T>[];
}) {
  if (!rows.length) {
    return <p className="text-base text-muted-foreground">無</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
      <table className="min-w-full text-base">
        <thead>
          <tr className="bg-primary text-primary-foreground">
            {cols.map((c) => (
              <th
                key={c.key}
                className={`h-12 px-4 text-sm font-medium tracking-wider ${
                  c.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[#E0DCD6]">
              {cols.map((c) => {
                const v = row[c.key];
                return (
                  <td
                    key={c.key}
                    className={`h-14 px-4 align-top ${
                      c.align === "right"
                        ? "text-right tabular-nums"
                        : ""
                    }`}
                  >
                    {v === undefined || v === null || v === ""
                      ? "—"
                      : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
