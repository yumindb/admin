-- ==========================================================================
-- Migration 2.16 — 「合約外」升等為「追加合約」(以合約為單位)
-- ==========================================================================
-- 為什麼:
--   2026-05-08 業主回饋:
--     舊模式「合約外」是工項層 — 每筆 case_work_items.item_type='extra' 各自獨立。
--     實務上,辦公室助理會把多筆「未簽約」工項一次選起來、做一份報價單(追加合約),
--     有 bundle 優惠價 — 整份合約金額 ≠ 工項單價總和。
--
--   舊 schema 沒有「合約」這層,bundle 優惠價無處放,也無法把多筆工項綁在一張報價單內。
--
-- 解法:
--   1. 新建 extra_contracts 表:每筆代表一份追加合約(報價單),含 bundle_price + signed_at + note
--   2. case_work_items 加 extra_contract_id FK → 指向所屬合約
--   3. 既有 item_type='extra' 的工項:每筆自動建一份單品項合約(bundle_price = total_price),
--      把 contract_signed_at / contract_note 搬到 extra_contracts 欄位
--   4. site_supervisor 在日誌不再看到 'extra'(屬已簽約合約,不該出現在日誌 picker);
--      仍可在「未簽約」picker 勾選未含合約的 case_work_items 'unsigned'
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等 (drop + create + 條件 update)。
-- 注意: alter type 不能在 transaction 中送多條 — 但這份只新建表 + 加欄位,沒動 enum。
-- ==========================================================================

-- 1. extra_contracts 表
create table if not exists public.extra_contracts (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.cases(id) on delete cascade,
  name            text not null,                    -- 合約名稱(例:「2026-05 雨遮追加報價單」)
  bundle_price    numeric(14, 2),                   -- bundle 優惠價(整份)。null = 無優惠,以工項總價為準
  note            text,                             -- 簽約備註(取代舊 contract_note)
  signed_at       timestamptz not null default now(),  -- 簽約時間
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists extra_contracts_case_idx on public.extra_contracts(case_id);
create index if not exists extra_contracts_signed_idx on public.extra_contracts(signed_at desc);

do $$ begin
  create trigger trg_extra_contracts_updated_at before update on public.extra_contracts
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

-- 2. case_work_items 加 extra_contract_id
alter table public.case_work_items
  add column if not exists extra_contract_id uuid
    references public.extra_contracts(id) on delete set null;

create index if not exists case_work_items_extra_contract_idx
  on public.case_work_items(extra_contract_id)
  where extra_contract_id is not null;

comment on column public.case_work_items.extra_contract_id is
  '所屬追加合約 id。僅 item_type=''extra'' 時應有值;item_type=''unsigned''/其他類型應為 null。';

-- 3. 既有資料搬移 — 把已 contract_signed_at 的 extra 工項變成單品項追加合約
do $$
declare
  r record;
  new_contract_id uuid;
begin
  for r in
    select id, case_id, name, total_price, contract_signed_at, contract_note, created_by
      from public.case_work_items
     where item_type = 'extra'
       and extra_contract_id is null
       and contract_signed_at is not null
  loop
    insert into public.extra_contracts (
      case_id, name, bundle_price, note, signed_at, created_by
    )
    values (
      r.case_id,
      coalesce(nullif(r.name, ''), '追加合約'),       -- 用工項名作合約名;空字串退回 '追加合約'
      r.total_price,                                 -- 沒有 bundle 折讓,bundle_price = 該品項複價
      r.contract_note,
      r.contract_signed_at,
      r.created_by
    )
    returning id into new_contract_id;

    update public.case_work_items
       set extra_contract_id = new_contract_id
     where id = r.id;
  end loop;
end $$;

-- 4. RLS — extra_contracts:office_staff / owner 可全寫;site_supervisor 只可讀。
alter table public.extra_contracts enable row level security;

drop policy if exists extra_contracts_read_all on public.extra_contracts;
create policy extra_contracts_read_all on public.extra_contracts
  for select
  to authenticated
  using (true);

drop policy if exists extra_contracts_write_office on public.extra_contracts;
create policy extra_contracts_write_office on public.extra_contracts
  for all
  to authenticated
  using (public.current_user_role() in ('office_staff', 'owner'))
  with check (public.current_user_role() in ('office_staff', 'owner'));

-- 通知 PostgREST 重整 schema cache(讓上面 policy 立刻生效)
notify pgrst, 'reload schema';

-- 5. 驗證
select 'extra_contracts rows', count(*) from public.extra_contracts;
select item_type, count(*) filter (where extra_contract_id is not null) as with_contract,
       count(*) filter (where extra_contract_id is null) as without_contract
  from public.case_work_items
  where item_type in ('extra', 'unsigned')
  group by item_type
  order by item_type;
