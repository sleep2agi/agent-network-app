import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { adoptKnownNode, fetchHostSupervisors, fetchNodeLifecycleRequest, runNodeLifecycleAction, type HostSupervisorDaemon, type HubConfig, type HubNode, type NodeLifecycleRequest } from './api';
import { adoptionError, adoptionOutcome, adoptionSupported, isAdopted } from './node-adoption';
import { useTranslation } from './i18n-react';
import { colors } from './theme';

/** Parent keys this component by Hub/account/network/node, isolating late results. */
export default function NodeAdoptionControls({ cfg, node, online, onRefresh }: { cfg: HubConfig; node: HubNode; online: boolean; onRefresh: () => void }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'adopt' | 'start' | 'stop' | null>(null);
  const [daemons, setDaemons] = useState<HostSupervisorDaemon[]>([]);
  const [daemon, setDaemon] = useState(''), [path, setPath] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ kind: NodeLifecycleRequest['kind']; id: string } | null>(node.adoption?.status === 'pending' ? { kind: 'adopt', id: node.adoption.request_id } : null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), alive = useRef(true), refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (dialog !== 'adopt') return;
    let cancelled = false;
    void fetchHostSupervisors(cfg).then(r => {
      if (!cancelled) setDaemons(r.ok ? r.daemons.filter(d => d.adopt_capable === true) : []);
    }).catch(() => { if (!cancelled) setMessage(t('adopt.failed')); });
    return () => { cancelled = true; };
  }, [dialog, cfg.serverUrl, cfg.token, cfg.networkId]);
  useEffect(() => {
    if (!pending) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 120000;
    const poll = async () => {
      try {
        const r = await fetchNodeLifecycleRequest(cfg, pending.kind, pending.id);
        if (cancelled) return;
        if (!r || r.node_id !== node.node_id) throw new Error('unconfirmed');
        const outcome = adoptionOutcome(pending.kind, r.status);
        if (outcome !== 'pending') {
          setMessage(outcome === 'success' ? t('adopt.success') : adoptionError(r.error));
          setPending(null); lock.current = false; refresh.current(); return;
        }
        if (Date.now() >= deadline) throw new Error('timeout');
        timer = setTimeout(poll, 1500);
      } catch {
        if (!cancelled) { setMessage(t('adopt.uncertain')); setPending(null); lock.current = false; }
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pending, cfg.serverUrl, cfg.token, cfg.networkId, node.node_id]);
  if (!adoptionSupported(node) || node.managed === 'created' || !cfg.networkId) return null;
  const adopted = isAdopted(node), disabled = busy || !!pending;
  const down = !online || node.lifecycle_state === 'stopped';
  const button = (id: string, label: string, press: () => void, off = false) => <Pressable testID={id} accessibilityRole="button" accessibilityState={{ disabled: off }} disabled={off} onPress={press} style={{ minHeight: 44, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: '#1b65db', borderRadius: 8, opacity: off ? 0.45 : 1 }}><Text style={{ color: colors.text, fontSize: 14 }}>{label}</Text></Pressable>;
  const submit = async () => {
    if (!dialog || lock.current || pending) return;
    lock.current = true; setBusy(true); setMessage('');
    const kind = dialog;
    try {
      const r = kind === 'adopt' ? await adoptKnownNode(cfg, node.node_id, daemon, path) : await runNodeLifecycleAction(cfg, kind === 'start' ? 'start_node' : 'stop_node', node);
      if (!alive.current) return;
      if (!r.ok) { setMessage(adoptionError(r.error)); lock.current = false; return; }
      setDialog(null);
      if (!r.request_id) { setMessage(t('adopt.uncertain')); lock.current = false; return; }
      setPending({ kind, id: r.request_id });
    } catch { if (alive.current) { setMessage(t('adopt.uncertain')); lock.current = false; } }
    finally { if (alive.current) setBusy(false); }
  };
  return <View testID="node-adoption-controls" style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: '#1b65db', borderRadius: 12, backgroundColor: colors.card }}>
    <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{t('adopt.title')}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {adopted ? <>{button('adopt-start', t('adopt.start'), () => setDialog('start'), disabled || !down)}{button('adopt-stop', t('adopt.stop'), () => setDialog('stop'), disabled || down)}{button('adopt-restart', t('adopt.restart'), () => {}, true)}</> : button('adopt-open', t('adopt.entry'), () => setDialog('adopt'), disabled)}
    </View>
    {adopted && <Text style={{ color: colors.textMuted }}>{t('adopt.restartHint')}</Text>}
    {dialog && <View testID="adopt-confirm-panel" accessibilityRole="alert" style={{ gap: 10 }}>
      <Text style={{ color: colors.text }}>{t(dialog === 'adopt' ? 'adopt.explain' : dialog === 'stop' ? 'adopt.confirmStop' : 'adopt.confirmStart')}</Text>
      {dialog === 'adopt' && <>
        {daemons.length ? daemons.map(d => button(`adopt-daemon-${d.daemon_node_id}`, `${daemon === d.daemon_node_id ? '✓ ' : ''}${d.alias}`, () => setDaemon(d.daemon_node_id), busy)) : <Text style={{ color: colors.textMuted }}>{t('adopt.empty')}</Text>}
        <TextInput testID="adopt-workdir" accessibilityLabel={t('adopt.path')} placeholder={t('adopt.path')} value={path} onChangeText={setPath} editable={!busy} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 10 }} />
      </>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{button('adopt-confirm', t(dialog === 'adopt' ? 'adopt.confirm' : `adopt.${dialog}`), () => void submit(), busy || (dialog === 'adopt' && (!daemon || !path.trim())))}{button('adopt-cancel', t('adopt.cancel'), () => setDialog(null), busy)}</View>
    </View>}
    {(pending || message) && <Text testID="adopt-message" accessibilityLiveRegion="polite" style={{ color: colors.text }}>{pending ? t('adopt.pending') : message}</Text>}
  </View>;
}
