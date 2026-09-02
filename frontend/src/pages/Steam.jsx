import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, useToast, LoadingBlock, EmptyState } from '../components/ui.jsx';
import { track } from '../utils/analytics.js';

function fmtHours(min) {
  if (!min) return '0h';
  const h = min / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

function avatarUrl(hash) {
  if (!hash) return null;
  return `https://media.steampowered.com/steamcommunity/public/images/avatars/${hash.slice(0, 2)}/${hash}.jpg`;
}

export default function Steam() {
  const toast = useToast();
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [library, setLibrary] = useState(null);
  const [steamId, setSteamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    try {
      const [s, l] = await Promise.all([api.get('/steam/status'), api.get('/steam/library')]);
      setStatus(s);
      setLibrary(l);
    } catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const link = async () => {
    track('steam_connect', { action: 'link' });
    setBusy(true);
    try {
      const r = await api.post('/steam/link', { steamId });
      toast.ok(`${t('steam.connected')} ${r.profile.profileName || 'Steam'} — ${r.imported} ${t('steam.gamesImported')}.`);
      if (r.note) toast.info(r.note);
      setSteamId('');
      await loadAll();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  const sync = async () => {
    track('steam_connect', { action: 'sync' });
    setBusy(true);
    try {
      const r = await api.post('/steam/sync');
      toast.ok(`${t('steam.synced')} — ${r.imported} ${t('steam.gamesImported')}.`);
      await loadAll();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  const unlink = async () => {
    if (!confirm(t('steam.confirmUnlink'))) return;
    setBusy(true);
    try {
      await api.post('/steam/unlink');
      toast.ok(t('steam.unlinked'));
      await loadAll();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="page"><LoadingBlock text={t('common.loading')} /></div>;

  const linked = status?.linked && status?.profile;
  const avatar = avatarUrl(status?.profile?.avatarHash);

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🟦 {t('steam.title')}</h1>
          <span className="sub">{t('steam.sub')}</span>
        </div>
        {linked && (
          <button className="btn btn-ghost btn-sm" onClick={unlink} disabled={busy}>{t('steam.unlink')}</button>
        )}
      </div>

      {!status?.enabled ? (
        <Card><EmptyState icon="🟦" title={t('steam.notConfigured')} text={t('steam.notConfiguredText')} /></Card>
      ) : !linked ? (
        <Card>
          <CardHead title={<>🔗 {t('steam.connectAccount')}</>} />
          <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '0 0 12px' }}>
            {t('steam.connectText1')} <code>https://steamcommunity.com/profiles/76561198000000000</code>. {t('steam.connectText2')}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 260 }} placeholder={t('steam.connectPlaceholder')} value={steamId} onChange={(e) => setSteamId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && link()} disabled={busy} />
            <button className="btn btn-primary" onClick={link} disabled={busy || !steamId.trim()}>{busy ? t('steam.connecting') : t('steam.connectSteam')}</button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <CardHead title={<>👤 {t('steam.connectedProfile')}</>}>
              <Badge tone={status.profile.isPublic ? 'ok' : 'warn'}>{status.profile.isPublic ? t('steam.publicProfile') : t('steam.privateProfile')}</Badge>
            </CardHead>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {avatar && <img src={avatar} alt="Steam avatar" width={56} height={56} style={{ borderRadius: 12, border: '1px solid var(--border)' }} />}
              <div>
                <div style={{ fontWeight: 700 }}>{status.profile.profileName || t('steam.steamUser')}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{status.profile.steamId}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 4 }}>
                  {status.libraryCount} {t('steam.gamesImported')} · {t('steam.lastSync')} {status.profile.lastSyncAt ? new Date(status.profile.lastSyncAt).toLocaleString() : '—'}
                </div>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn btn-primary" onClick={sync} disabled={busy}>{busy ? t('steam.syncing') : t('steam.syncLibrary')}</button>
              </div>
            </div>
            {!status.profile.isPublic && (
              <div className="steam-warn" style={{ marginTop: 12 }}>
                {t('steam.privateWarn')}
              </div>
            )}
          </Card>

          <Card style={{ marginTop: 18 }}>
            <CardHead title={<>🎮 {t('steam.importedLibrary')}</>}>
              {library?.total > 0 && <Badge tone="primary">{library.total} {t('steam.gamesImported')} · {library.matched} {t('steam.gamesInCatalog')}</Badge>}
            </CardHead>
            {library?.total === 0 ? (
              <EmptyState icon="🎮" title={t('steam.noGamesImported')} text={t('steam.noGamesText')} />
            ) : (
              <div className="steam-grid">
                {library.items.map((g) => (
                  <div key={g.appid} className="steam-game">
                    {g.iconUrl ? <img src={g.iconUrl} alt="" width={40} height={40} style={{ borderRadius: 8 }} /> : <div className="steam-ic" />}
                    <div className="steam-game-info">
                      <div className="steam-game-name">{g.name}</div>
                      <div className="steam-game-meta">{fmtHours(g.playtimeForeverMinutes)}{g.playtime2WeeksMinutes > 0 ? ` · ${fmtHours(g.playtime2WeeksMinutes)} ${t('steam.in2Weeks')}` : ''}</div>
                    </div>
                    <div className="steam-game-badges">
                      {g.matchedCatalog && <Badge tone="ok">{t('steam.verified')}</Badge>}
                      {g.inUserGames && <Badge tone="primary">{t('steam.inYourGames')}</Badge>}
                      {!g.matchedCatalog && <Badge tone="">{t('steam.notInCatalog')}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {linked && (
        <p className="steam-note">
          {t('steam.note')}
        </p>
      )}
    </div>
  );
}
