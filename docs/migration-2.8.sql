-- migration-2.8.sql
-- daily_logs.photos: 將舊格式 ["path1", "path2"] 轉成新格式 [{path, caption}, ...]
--
-- 背景:Phase 2.8 加入「每張照片可填說明」,photos 從 string[] 改為 LogPhoto[]。
-- DB 欄位是 jsonb,新舊格式都存得進去,但讀取時前端要做 normalize。
-- 跑這支 migration 後,所有舊紀錄會被一次性轉成新格式,讀取就不再依賴 normalizer。
--
-- 冪等(可重複跑):只處理還含有 string 元素的列。已轉換過的列會被跳過。

UPDATE daily_logs
SET photos = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(elem) = 'string'
        THEN jsonb_build_object('path', elem, 'caption', '')
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(photos) WITH ORDINALITY AS arr(elem, ord)
)
WHERE photos IS NOT NULL
  AND jsonb_array_length(photos) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(photos) elem
    WHERE jsonb_typeof(elem) = 'string'
  );

-- 驗證(跑完後可選用,確認沒漏轉)
-- SELECT id, photos
-- FROM daily_logs
-- WHERE photos IS NOT NULL
--   AND EXISTS (
--     SELECT 1 FROM jsonb_array_elements(photos) elem
--     WHERE jsonb_typeof(elem) = 'string'
--   );
-- → 應該回 0 列
