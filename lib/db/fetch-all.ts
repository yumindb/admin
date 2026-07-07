/**
 * 突破 PostgREST 單次查詢 1000 筆上限的分頁撈取 helper。
 *
 * 為什麼:Supabase(PostgREST)預設 max-rows = 1000,超過的 rows 會被
 * 「默默截斷」— 不報錯。POC 期測試資料量小沒踩到;2026-07 上線前匯入真實
 * 標單(配電盤單一案件 1200+ 工項)後,案件列表 / 工項樹 / 日誌 picker
 * 全部靜默漏資料。所有「撈整個案件(或跨案件)的 case_work_items / daily_logs」
 * 查詢都必須走這支。
 *
 * 用法(query 必須有穩定排序,否則分頁會重複/漏列):
 *   const { data, error } = await fetchAllRows<Row>((from, to) =>
 *     supabase.from("case_work_items").select("*").eq("case_id", id)
 *       .order("sort_path", { ascending: true }).range(from, to),
 *   );
 */

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

const PAGE_SIZE = 1000;
// 安全上限:50 頁 = 5 萬列。超過表示資料形狀不對(或 query 沒排序在循環),
// 與其無限抓爆記憶體不如截斷 + 由 caller 顯示警告。
const MAX_PAGES = 50;

export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[]; error: { message: string } | null; truncated: boolean }> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await queryPage(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error, truncated: false };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { data: all, error: null, truncated: false };
  }
  return { data: all, error: null, truncated: true };
}
