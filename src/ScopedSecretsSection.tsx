import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { fetchNodeSecretRequests, runNodeLifecycleAction, type HubConfig } from './api';
import { scopedSecrets } from './scoped-secrets-api';
import { mergeNodeSecretKeys, nodeSecretsNeedsUpgrade, validSecretInput, type SecretSnapshot, type SecretWrite } from './scoped-secrets';
import {
  manualRestartCommand, restartChoiceAfterAttempt, restartChoiceAfterSecret, restartChoiceText,
  type RestartChoice,
} from './node-restart-after-secret';
import SecretRequestCard from './SecretRequestCard';
import { useTranslation } from './i18n-react';
import './i18n-scoped-secrets';
import './i18n-provider-management';
import { providerHttpWarning } from './daemon-provider-management-api';
import { colors, spacing, radius, type } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
type Props={cfg:HubConfig;daemonId?:string|null;nodeId?:string|null;nodeRuntimeVersion?:string|null;nodeSecretsCapable?:boolean;alias?:string;configUpdateCapable?:boolean|null|undefined;online?:boolean};
export default function ScopedSecretsSection(props:Props) {
  return <Page key={JSON.stringify([props.cfg.serverUrl,props.cfg.networkId,props.cfg.token,props.daemonId,props.nodeId,props.nodeRuntimeVersion])} {...props}/>;
}
function Page({cfg,daemonId,nodeId,nodeRuntimeVersion,nodeSecretsCapable,alias,configUpdateCapable,online}:Props) {
  const {t}=useTranslation();const [snapshot,setSnapshot]=useState<SecretSnapshot|null>(null),[independentSnap,setIndependentSnap]=useState<SecretSnapshot|null>(null),[key,setKey]=useState(''),[value,setValue]=useState('');
  const [busy,setBusy]=useState(false),[writing,setWriting]=useState(false),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState<string|null>(null);
  // #4827 —— agent 举手要的 key：卡片级 saving/saved 状态（写完整份刷新后由 pending 消失体现）。
  const [requestSaving,setRequestSaving]=useState<string|null>(null);
  // #4827 —— REST GET /secrets 只回 pending（字段缺省 = 无）；MCP 轮询端点不带它。
  const [pendingRest,setPendingRest]=useState<{key:string;label?:string}[]>([]);
  // #1511 / #5505 —— 保存/删除后统一在密钥页给重启闭环（倒计时自动重启或可照抄命令）。
  const [restartChoice,setRestartChoice]=useState<RestartChoice|null>(null);
  const [countdown,setCountdown]=useState<number|null>(null);
  const restartTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const active=useRef<AbortController|null>(null), mounted=useRef(true);
  const supported=!!(daemonId||nodeId) && !!cfg.networkId;
  const independent=!!nodeId && !daemonId;
  // 能力优先：节点自报 node_secrets_capable 就必须给表单，哪怕它不报版本号
  // （claude-code channel-server 现在正是 version=null + 有能力）。只有“没能力、且版本
  // 缺失或低于门槛”才显示升级提示；自定义版本交给 nodeSecretsNeedsUpgrade，不误伤 fixture。
  const upgradeRequired=independent && nodeSecretsCapable!==true
    && (nodeRuntimeVersion==null || nodeSecretsNeedsUpgrade(nodeRuntimeVersion));
  const clearRestartTimer=useCallback(()=>{
    if(restartTimer.current){clearInterval(restartTimer.current);restartTimer.current=null;}
  },[]);
  const dispatchRestartNow=useCallback(async(planned:RestartChoice)=>{
    if(!nodeId)return;
    clearRestartTimer();
    if(mounted.current)setCountdown(null);
    const r=await runNodeLifecycleAction(cfg,'restart_node',{node_id:nodeId,alias:alias??''});
    if(!mounted.current)return;
    setRestartChoice(prev=>restartChoiceAfterAttempt(prev??planned,r.ok?{ok:true}:r,alias));
  },[alias,cfg,clearRestartTimer,nodeId]);
  const offerRestartAfterSave=useCallback(()=>{
    if(!nodeId)return;
    const planned=restartChoiceAfterSecret({configUpdateCapable,online:online??false,alias});
    setRestartChoice(planned);
    if(planned.kind!=='scheduled'){setCountdown(null);return;}
    clearRestartTimer();
    setCountdown(planned.countdownSeconds);
    let left=planned.countdownSeconds;
    restartTimer.current=setInterval(()=>{
      left-=1;
      if(left>0){if(mounted.current)setCountdown(left);return;}
      void dispatchRestartNow(planned);
    },1000);
  },[alias,clearRestartTimer,configUpdateCapable,dispatchRestartNow,nodeId,online]);
  const cancelScheduledRestart=useCallback(()=>{
    clearRestartTimer();
    if(mounted.current)setCountdown(null);
    setRestartChoice({kind:'manual',command:manualRestartCommand(alias)});
  },[alias,clearRestartTimer]);
  const run=async(write?:SecretWrite, targetIndependent = false)=>{
    if(!supported||upgradeRequired||active.current)return;
    const ctrl=new AbortController();active.current=ctrl;setBusy(true);setWriting(!!write);setNotice('');setDeleting(null);
    if(write){setValue('');if(!targetIndependent)setSnapshot(null);}
    const pendingRead = nodeId ? fetchNodeSecretRequests(cfg, nodeId) : Promise.resolve([]);
    const primaryScope={networkId:cfg.networkId!,daemonId:daemonId??null,nodeId:nodeId??null};
    const independentScope={networkId:cfg.networkId!,daemonId:null,nodeId:nodeId??null};
    const result=await scopedSecrets(cfg,targetIndependent?independentScope:primaryScope,ctrl.signal,write);
    const extraRead = daemonId && nodeId && nodeSecretsCapable && !targetIndependent
      ? scopedSecrets(cfg,independentScope,ctrl.signal).catch(()=>null)
      : Promise.resolve(null);
    const extraResult = await extraRead;
    void pendingRead.then(rows=>{if(mounted.current)setPendingRest(rows);});
    if(!mounted.current||ctrl.signal.aborted)return;
    if(targetIndependent){
      if(result.kind==='ready'){
        setIndependentSnap(result.snapshot);
        if(write){
          setNotice(t(write.action==='put'?'scopedSecrets.nodeSaved':'scopedSecrets.nodeDeleted'));
          offerRestartAfterSave();
        }
      } else {
        setNotice(t(`scopedSecrets.${result.kind==='cancelled'?'unconfirmed':result.kind}`));
      }
    } else {
      if(extraResult && extraResult.kind==='ready')setIndependentSnap(extraResult.snapshot);
      else if(!daemonId)setIndependentSnap(null);
      if(result.kind==='ready') {
        setSnapshot(result.snapshot);
        if(write){
          setNotice(t(independent
            ? write.action==='put'?'scopedSecrets.nodeSaved':'scopedSecrets.nodeDeleted'
            : write.action==='put'?'scopedSecrets.saved':'scopedSecrets.deleted'));
          offerRestartAfterSave();
        }
      }
      else {setSnapshot(null);setNotice(t(result.kind==='unsupported'&&independent?'scopedSecrets.nodeUnsupported':`scopedSecrets.${result.kind==='cancelled'?'unconfirmed':result.kind}`));}
    }
    active.current=null;setBusy(false);
  };
  useEffect(()=>{mounted.current=true;void run();return()=>{mounted.current=false;clearRestartTimer();active.current?.abort();};},[]);
  const displayedKeys=snapshot?mergeNodeSecretKeys(snapshot.keys,independentSnap?.keys??[]):[];
  const field={borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,padding:spacing.sm,color:colors.text,fontSize:type.body,backgroundColor:colors.bg};
  const Button=({title,press,disabled=false,testID}:{title:string;press:()=>void;disabled?:boolean;testID?:string})=><Pressable testID={testID} accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={press} style={[buttonStyle('secondary'),{opacity:disabled?0.45:1}]}><Text style={buttonTextStyle('secondary')}>{title}</Text></Pressable>;
  return <View testID="scoped-secrets" style={{gap:spacing.md}}>
    <Text style={{fontSize:type.title,fontWeight:'600',color:colors.text}}>{t('scopedSecrets.title')}</Text>
    <Text style={{color:colors.textMuted}}>{t(independent?'scopedSecrets.nodeIndependent':nodeId?'scopedSecrets.node':'scopedSecrets.daemon')}</Text>
    <Text style={{color:colors.textMuted,fontSize:type.small}}>{t(independent?'scopedSecrets.nodeBoundary':'scopedSecrets.boundary')}</Text>
    {providerHttpWarning(cfg.serverUrl)?<Text style={{color:colors.textMuted}}>{t('providerManagement.httpWarning')}</Text>:null}
    {!supported?<Text>{t('scopedSecrets.unbound')}</Text>:upgradeRequired?<View testID="scoped-secret-upgrade" style={{gap:spacing.sm}}>
      <Text style={{color:colors.text}}>{t('scopedSecrets.nodeRuntimeVersion',{version:nodeRuntimeVersion!})}</Text>
      <Text style={{color:colors.textMuted}}>{t('scopedSecrets.nodeUnsupported')}</Text>
    </View>:<>
      <Button title={t('scopedSecrets.refresh')} testID="scoped-secret-refresh" disabled={busy} press={()=>void run()}/>
      {busy?<View style={{flexDirection:'row',gap:spacing.sm,alignItems:'center'}}><ActivityIndicator color={colors.textMuted}/><Text style={{color:colors.textMuted}}>{t(independent
        ? writing?'scopedSecrets.nodeSaving':'scopedSecrets.nodeLoading'
        : writing?'scopedSecrets.saving':'scopedSecrets.loading')}</Text></View>:null}
      {restartChoice?<View testID="node-secrets-restart-choice" style={{borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:spacing.sm,gap:spacing.xs}}>
        <Text testID={`node-secrets-restart-${restartChoice.kind}`} style={{color:restartChoice.kind==='busy'?colors.blocked:colors.textSecondary,fontSize:type.small}}>
          {restartChoiceText(restartChoice)}{countdown!==null?`（剩余 ${countdown} 秒）`:''}
        </Text>
        {countdown!==null?<View style={{flexDirection:'row',gap:spacing.md}}>
          <Pressable testID="node-secrets-restart-now" disabled={busy} onPress={()=>void dispatchRestartNow(restartChoice)}>
            <Text style={{color:colors.accent,fontSize:type.small}}>立即重启</Text>
          </Pressable>
          <Pressable testID="node-secrets-restart-cancel" disabled={busy} onPress={cancelScheduledRestart}>
            <Text style={{color:colors.textMuted,fontSize:type.small}}>取消重启</Text>
          </Pressable>
        </View>:null}
      </View>:null}
      {[...pendingRest,...(snapshot?.pending??[])].filter((p,i,all)=>all.findIndex(x=>x.key===p.key)===i)
        .filter(p=>!displayedKeys.some(k=>k.key===p.key&&k.source===(nodeId?'node':'daemon'))).map(p=><SecretRequestCard
        key={p.key}
        testID={`secret-request-${p.key}`}
        request={{key:p.key,...(p.label?{label:p.label}:{})}}
        phase={requestSaving===p.key?'saving':'idle'}
        onSave={v=>{setRequestSaving(p.key);void run({action:'put',key:p.key,value:v,revision:snapshot!.revision}).finally(()=>setRequestSaving(null));}}
      />)}
      {snapshot?<View style={{borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:spacing.md,gap:spacing.sm}}>
        {!displayedKeys.length?<Text style={{color:colors.textMuted}}>{t('scopedSecrets.empty')}</Text>:displayedKeys.map(item=><View key={item.key} style={{gap:spacing.xs}}>
          <Text style={{color:colors.text}}>{item.key}</Text><Text style={{color:colors.textMuted,fontSize:type.small}}>{t(item.source==='node'?'scopedSecrets.sourceNode':nodeId?'scopedSecrets.sourceDaemon':'scopedSecrets.sourceOwnDaemon')}</Text>
          {item.source===(nodeId?'node':'daemon')?<Button title={t(deleting===item.key?'scopedSecrets.confirmDelete':'scopedSecrets.delete')} press={()=>{
            if(deleting===item.key){
              if(item.independentOnly && independentSnap){
                void run({action:'delete',key:item.key,revision:independentSnap.revision},true);
              } else {
                void run({action:'delete',key:item.key,revision:snapshot.revision});
              }
            } else setDeleting(item.key);
          }}/>:null}
        </View>)}
      </View>:null}
      <Text>{t('scopedSecrets.name')}</Text><TextInput testID="scoped-secret-name" accessibilityLabel={t('scopedSecrets.name')} value={key} onChangeText={setKey} editable={!busy} autoCapitalize="characters" autoCorrect={false} style={field}/>
      <Text>{t('scopedSecrets.value')}</Text><TextInput testID="scoped-secret-value" accessibilityLabel={t('scopedSecrets.value')} value={value} onChangeText={setValue} editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false} style={field}/>
      <Button title={t('scopedSecrets.save')} testID="scoped-secret-save" disabled={busy||!snapshot} press={()=>{
        if(!validSecretInput(key.trim(),value)){setNotice(t('scopedSecrets.invalid'));return;}
        void run({action:'put',key:key.trim(),value,revision:snapshot!.revision});
      }}/>
      {notice?<Text testID="scoped-secret-notice" style={{color:colors.textMuted}}>{notice}</Text>:null}
    </>}
  </View>;
}
