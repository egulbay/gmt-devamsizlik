-- ============================================================================
-- GMT Takip — Migration 012  (Bağlantılar ve Panolar · düzeltme)
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
--
-- SORUN: Yalnızca TEK BİR PANOYA davet edilen kişi (çalışma alanının üyesi
-- değil) panoyu hiç göremiyordu. Panolar alanların altında listelendiği için,
-- alanın adı görünmeyince pano da ekranda hiçbir yere oturamıyordu.
--
-- ÇÖZÜM: İçindeki bir panoya erişimi olan kişi, o alanın SATIRINI (yalnızca
-- adını) görebilsin. Alanın diğer panoları yine görünmez: pano listesi
-- boards tablosunun kendi kuralından geçiyor ve o kural değişmedi.
-- ============================================================================
drop policy if exists "ws read" on public.workspaces;
create policy "ws read" on public.workspaces
  for select using (
    public.workspace_role(id, auth.uid()) is not null
    or exists (
      select 1 from public.boards b
       where b.workspace_id = workspaces.id
         and b.deleted = false
         and public.board_role(b.id, auth.uid()) is not null
    )
  );
