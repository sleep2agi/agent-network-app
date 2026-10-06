import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text } from 'react-native';
import NodeAdoptionControls from '../../src/NodeAdoptionControls';
import { setLanguagePreference } from '../../src/i18n';
import { setThemeMode } from '../../src/theme';
setLanguagePreference('zh');
setThemeMode('light');
const q=new URLSearchParams(location.search), mode=q.get('mode');
const node={node_id:'fixture-node',alias:'演示节点',lifecycle_state:mode==='stopped'?'stopped':mode==='starting'?'starting':'active',...(mode==='old'?{}:{managed:mode==='manual'?'none':'adopted',adoption:null})};
function Fixture(){
 const [target,setTarget]=useState(node);
 window.switchFixtureNode=()=>setTarget({...node,node_id:'another-node'});
 return <View style={{padding:24,gap:20,width:'100%',maxWidth:850,alignSelf:'center'}}><Text style={{fontSize:24}}>演示节点 · 节点详情</Text><NodeAdoptionControls key={target.node_id} cfg={{serverUrl:location.origin,token:'fixture-token',networkId:'fixture-network'}} node={target} online={mode!=='stopped'} onRefresh={()=>{}}/></View>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
