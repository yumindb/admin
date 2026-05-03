-- ==========================================================================
-- Migration 2.12 — 公司名稱統一為三家正式公司名（hardcode 在 lib/companies.ts）
-- ==========================================================================
--
-- 背景：cases.company 原本 default '裕民'（POC 用），現在 UI 改為下拉選單
-- 鎖定 3 個值：銘毅工程企業有限公司 / 陸毅建築開發有限公司 / 裕民工務企業有限公司。
--
-- 這支腳本：
--   1. 把 cases.company = '裕民' 補成 '裕民工務企業有限公司'
--   2. profiles.company 同步補（若有）
--   3. default 改為 '裕民工務企業有限公司' 對齊新 UI
--
-- 冪等：可重複跑。
-- ==========================================================================

-- 1. 既有 cases 補正式名稱
update public.cases
   set company = '裕民工務企業有限公司'
 where company = '裕民';

-- 若你之前手動把某些案件設成 '陞毅建築開發有限公司'（typo 版），改成 '陸毅'
update public.cases
   set company = '陸毅建築開發有限公司'
 where company = '陞毅建築開發有限公司';

-- 2. profiles 同步
update public.profiles
   set company = '裕民工務企業有限公司'
 where company = '裕民';

-- 3. default 對齊
alter table public.cases    alter column company set default '裕民工務企業有限公司';
alter table public.profiles alter column company set default '裕民工務企業有限公司';

-- 4. 報告現況讓你確認（執行後 Supabase SQL Editor 會顯示）
select company, count(*) as cnt
  from public.cases
 group by company
 order by company;
