"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * 篩選 state → URL query 同步(shallow)。
 *
 * 為什麼不用 router.replace:這些頁的篩選都是純 client 過濾,
 * router.replace 會重跑 server page(全表撈 / 全案件 stats),每勾一個
 * checkbox 打一次 DB 太貴。window.history.replaceState 有跟 Next router
 * 整合,useSearchParams 會同步。
 *
 * 為什麼要同步進 URL:每列都是連到明細的 Link,點進去再返回,
 * 核對到一半的篩選不能歸零。
 *
 * @param params 鍵值 map;值為空字串表示從 URL 移除該鍵
 * @param debounceMs >0 時延遲寫入(打字即濾的搜尋框用,避免每個字元都 replace)
 */
export function useSyncFiltersToUrl(
  params: Record<string, string>,
  debounceMs = 0,
) {
  const sp = useSearchParams();
  const pathname = usePathname();
  // params 是 caller 每次 render 新建的 object literal,用序列化字串當
  // effect dep 才不會每次 render 都重跑
  const serialized = JSON.stringify(params);

  useEffect(() => {
    const write = () => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(
        JSON.parse(serialized) as Record<string, string>,
      )) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (next.toString() === sp.toString()) return;
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    };
    if (debounceMs > 0) {
      const t = setTimeout(write, debounceMs);
      return () => clearTimeout(t);
    }
    write();
    // 刻意不把 sp 放 deps:replaceState 後 useSearchParams 會同步,
    // 放進去會多跑一輪 no-op;瀏覽器返回鍵改 URL 時也不該被 state 蓋回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, debounceMs, pathname]);
}
