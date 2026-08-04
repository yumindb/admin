-- ==========================================================================
-- Migration 2.32 — 把照片 / 簽名欄位裡的 signed URL 收斂成 storage path
-- ==========================================================================
-- 用途:
--   上傳 action 回給前端的是 signed URL(要當場預覽),前端把它原樣塞回
--   `photos[].path` / `signature_url` 送出 → DB 存的是**帶 token 的完整 URL**。
--   2026-08-01 清查 production:daily_logs 424 張、field_reports 162 張、
--   log_approvals 64 筆簽名,**全部**都是 signed URL。
--
--   為什麼要修:
--     - 一張路徑從 ~40 bytes 變成 ~400 bytes(jsonb 白白肥十倍)
--     - 存的 token 幾小時後就失效,備份 / 匯出裡的值等同垃圾
--     - 任何「這兩筆是不是同一張照片」的比對都得先繞過 token
--       (log-diff 就因此誤報過「12 張全部被更換」)
--
--   程式端已在 server action 收斂(normalizePhotoPaths / signaturePath),
--   這支只處理既有資料。讀取端本來就吃兩種格式,所以跑不跑都不會壞,
--   跑了只會變乾淨。
--
-- 作法:
--   把 `https://<專案>.supabase.co/storage/v1/object/sign|public/<bucket>/<path>?token=...`
--   砍成 `<path>`。用 regexp 抓 `/object/(sign|public)/<bucket>/` 之後、`?` 之前那段。
--   非 http 開頭的(已經是 path)原樣不動 → 冪等,重跑無害。
--
-- 跑法:Supabase SQL Editor 貼上執行(整份一起)。冪等。
--
-- 安全設計(這支跟其他 migration 不同,它會大量改既有資料):
--   1. 整份包在單一 transaction 裡。
--   2. 動手前先把「照片元素總數」記進暫存表。
--   3. COMMIT 前自我檢查:元素數量必須完全一致、不能有空字串或 null 路徑、
--      也不能還殘留 http 開頭的值。任何一項不符就 RAISE EXCEPTION →
--      **整份自動 rollback,資料一個字都不會變**。
--   最壞情況是「這次沒清成功」,不會是「路徑被改壞、照片破圖」。
-- ==========================================================================

begin;

-- 共用:從任意輸入抽出 storage path。
--
-- 刻意**不指定 bucket**(用 `[^/]+` 吃掉那一段):早期實作簽名圖有 daily-photos /
-- signatures 混用的紀錄,綁死 bucket 名會有一部分轉不到。
--
-- Fail-safe:轉完如果還是 http 開頭(格式不如預期),就回原值不動 —
-- 最壞情況是「這筆沒被清乾淨」,不會變成壞路徑害照片顯示不出來。
create or replace function public.storage_path_from(input text)
returns text
language sql
immutable
as $$
  select case
    when input is null then null
    when input !~ '^https?://' then input
    else (
      select case
        when p = '' or p ~ '^https?://' then input   -- 認不得的格式 → 不動
        else p
      end
      from (
        select split_part(
                 regexp_replace(input, '^.*/object/(?:sign|public)/[^/]+/', ''),
                 '?', 1
               ) as p
      ) x
    )
  end;
$$;

-- --------------------------------------------------------------------------
-- 0. 先看再跑(可選):單獨執行這段,確認轉出來的 path 長得對再往下跑 UPDATE。
--
--   select p->>'path' as before,
--          public.storage_path_from(p->>'path') as after
--     from public.daily_logs, jsonb_array_elements(photos) p
--    where photos::text ~ '/object/(sign|public)/'
--    limit 5;
--
--   預期 after 長這樣:`c51b444c-5f92-42e5-9423-c5152813c850/1785242484443-lhj1fb.jpg`
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 0.5 動手前先記下「照片元素總數」,COMMIT 前要比對回來(防 jsonb_agg 掉元素)
-- --------------------------------------------------------------------------
create temp table _photo_counts_before on commit drop as
select
  (select count(*) from public.daily_logs, jsonb_array_elements(photos)
     where jsonb_typeof(photos) = 'array') as daily_logs_photos,
  (select count(*) from public.field_reports, jsonb_array_elements(photos)
     where jsonb_typeof(photos) = 'array') as field_reports_photos,
  (select count(*) from public.log_approvals
     where signature_url is not null) as signatures;

-- --------------------------------------------------------------------------
-- 1. daily_logs.photos — [{path, caption, original_path?}, ...]
-- --------------------------------------------------------------------------
update public.daily_logs
set photos = (
  select jsonb_agg(
    case
      when jsonb_typeof(p) = 'object' then
        p
          || jsonb_build_object(
               'path',
               public.storage_path_from(p->>'path')
             )
          || case
               when p ? 'original_path' then
                 jsonb_build_object(
                   'original_path',
                   public.storage_path_from(p->>'original_path')
                 )
               else '{}'::jsonb
             end
      -- 更早的資料是純字串陣列,一併轉成 path 字串
      else to_jsonb(public.storage_path_from(p #>> '{}'))
    end
    order by ord
  )
  from jsonb_array_elements(photos) with ordinality as t(p, ord)
)
where photos is not null
  and jsonb_typeof(photos) = 'array'
  and jsonb_array_length(photos) > 0
  and photos::text ~ '/object/(sign|public)/';   -- 只動真的含 URL 的列

-- --------------------------------------------------------------------------
-- 2. field_reports.photos — 同結構
-- --------------------------------------------------------------------------
update public.field_reports
set photos = (
  select jsonb_agg(
    case
      when jsonb_typeof(p) = 'object' then
        p
          || jsonb_build_object(
               'path',
               public.storage_path_from(p->>'path')
             )
          || case
               when p ? 'original_path' then
                 jsonb_build_object(
                   'original_path',
                   public.storage_path_from(p->>'original_path')
                 )
               else '{}'::jsonb
             end
      else to_jsonb(public.storage_path_from(p #>> '{}'))
    end
    order by ord
  )
  from jsonb_array_elements(photos) with ordinality as t(p, ord)
)
where photos is not null
  and jsonb_typeof(photos) = 'array'
  and jsonb_array_length(photos) > 0
  and photos::text ~ '/object/(sign|public)/';

-- --------------------------------------------------------------------------
-- 3. log_approvals.signature_url — 簽名圖(簽名快照本身不動,只改路徑寫法)
-- --------------------------------------------------------------------------
update public.log_approvals
set signature_url = public.storage_path_from(signature_url)
where signature_url is not null
  and signature_url ~ '^https?://';

-- --------------------------------------------------------------------------
-- 4. daily_log_revisions.snapshot.photos —— **不動**
--    那是「當時的原始快照」,審計紀錄就該保留當時存的值。
--    log-diff 比對照片時用「資料夾/檔名」當 key,跨兩種寫法都對得上。
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 5. COMMIT 前自我檢查 — 任何一項不符就整份 rollback
-- --------------------------------------------------------------------------
do $$
declare
  b record;
  a_dl bigint; a_fr bigint; a_sig bigint;
  bad bigint;
begin
  select * into b from _photo_counts_before;

  select count(*) into a_dl
    from public.daily_logs, jsonb_array_elements(photos)
   where jsonb_typeof(photos) = 'array';
  select count(*) into a_fr
    from public.field_reports, jsonb_array_elements(photos)
   where jsonb_typeof(photos) = 'array';
  select count(*) into a_sig
    from public.log_approvals where signature_url is not null;

  if a_dl <> b.daily_logs_photos then
    raise exception '照片數量對不上:daily_logs 原本 % 張,現在 % 張', b.daily_logs_photos, a_dl;
  end if;
  if a_fr <> b.field_reports_photos then
    raise exception '照片數量對不上:field_reports 原本 % 張,現在 % 張', b.field_reports_photos, a_fr;
  end if;
  if a_sig <> b.signatures then
    raise exception '簽名數量對不上:原本 % 筆,現在 % 筆', b.signatures, a_sig;
  end if;

  -- 路徑不能變成空的 / null(那會直接破圖)
  select count(*) into bad
    from public.daily_logs, jsonb_array_elements(photos) p
   where jsonb_typeof(photos) = 'array'
     and (p->>'path' is null or btrim(p->>'path') = '');
  if bad > 0 then
    raise exception 'daily_logs 有 % 張照片路徑變成空值', bad;
  end if;

  select count(*) into bad
    from public.field_reports, jsonb_array_elements(photos) p
   where jsonb_typeof(photos) = 'array'
     and (p->>'path' is null or btrim(p->>'path') = '');
  if bad > 0 then
    raise exception 'field_reports 有 % 張照片路徑變成空值', bad;
  end if;

  -- 路徑該長成 `資料夾/檔名`,不該還帶著網域
  select count(*) into bad
    from public.daily_logs, jsonb_array_elements(photos) p
   where jsonb_typeof(photos) = 'array' and p->>'path' ~ '^https?://';
  if bad > 0 then
    raise exception 'daily_logs 還有 % 張照片是完整網址', bad;
  end if;

  raise notice '自我檢查通過:daily_logs % 張、field_reports % 張、簽名 % 筆,數量與轉換都正確',
    a_dl, a_fr, a_sig;
end $$;

-- 清掉輔助函式:public schema 的 function 會被 PostgREST 當成 RPC 對外開放,
-- 這支只是 migration 的臨時工具,不留在正式 schema。
drop function if exists public.storage_path_from(text);

commit;

notify pgrst, 'reload schema';

-- 驗證:三個欄位應該都不再有 http 開頭的值
select 'daily_logs' as t, count(*) as still_url
  from public.daily_logs
  where photos::text ~ '/object/(sign|public)/'
union all
select 'field_reports', count(*)
  from public.field_reports
  where photos::text ~ '/object/(sign|public)/'
union all
select 'log_approvals', count(*)
  from public.log_approvals
  where signature_url ~ '^https?://';
