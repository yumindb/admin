import type { FieldChange } from "@/lib/log-diff";

/**
 * 送出後編輯的前後對照(原文小字 + 刪除線 → 新值)。
 *
 * 業主要求「不用到非常顯眼但是要可以看到改了什麼」,所以一律小字、
 * 原文用刪除線淡色,新值用正常字色。日誌詳情頁與簽核頁共用同一個呈現。
 */
export function RevisionDiffRows({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="space-y-2">
      {changes.map((c) => (
        <div key={c.field}>
          <p className="text-xs font-medium text-primary/80">
            {c.label}
            {c.summary && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                — {c.summary}
              </span>
            )}
          </p>
          <ul className="mt-1 space-y-1">
            {c.rows.map((row, i) => (
              <li key={i} className="text-xs leading-relaxed">
                {row.label && (
                  <span className="text-muted-foreground">{row.label}：</span>
                )}
                <span className="text-muted-foreground/70 line-through">
                  {row.before}
                </span>
                <span className="mx-1.5 text-muted-foreground/60">→</span>
                <span className="text-foreground">{row.after}</span>
              </li>
            ))}
            {!!c.more && (
              <li className="text-xs text-muted-foreground/70">
                …另外 {c.more} 項變動沒有列出
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
