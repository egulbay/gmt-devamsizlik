-- ============================================================================
-- GMT Takip — Pano teşhis sorgusu (yalnızca OKUR, hiçbir şeyi değiştirmez)
-- Supabase paneli > SQL Editor > yapıştır > Run.
--
-- Üç bölüm döner:
--   1) Panolar ve her birindeki kart sayısı
--   2) Kartların kendisi (kim eklemiş, ne zaman)
--   3) Kimin hangi panoya/alana üyeliği var
-- ============================================================================
select 'PANOLAR' as bolum,
       b.name as ad,
       b.id::text as kimlik,
       (select count(*) from public.cards c where c.board_id = b.id and c.deleted = false)::text as kart_sayisi,
       b.created_at::text as tarih
  from public.boards b
 where b.deleted = false

union all

select 'KARTLAR',
       c.title,
       c.board_id::text,
       coalesce(p.display_name, c.created_by::text),
       c.created_at::text
  from public.cards c
  left join public.profiles p on p.user_id = c.created_by
 where c.deleted = false

union all

select 'ALAN UYELIGI',
       coalesce(p.display_name, wm.user_id::text),
       w.name,
       wm.role,
       wm.created_at::text
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  left join public.profiles p on p.user_id = wm.user_id

union all

select 'PANO UYELIGI',
       coalesce(p.display_name, bm.user_id::text),
       b.name,
       bm.role,
       bm.created_at::text
  from public.board_members bm
  join public.boards b on b.id = bm.board_id
  left join public.profiles p on p.user_id = bm.user_id

order by 1, 5;
