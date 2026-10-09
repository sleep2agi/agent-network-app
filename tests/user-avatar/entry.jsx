import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import UserAvatarEditor from '../../src/UserAvatarEditor';
import HumanAvatar from '../../src/HumanAvatar';
import { setLocalAvatarEcho } from '../../src/lib/avatars';
import { setLanguagePreference } from '../../src/i18n';
import { setThemePreference } from '../../src/theme';
setLanguagePreference('zh'); setThemePreference('light');
function Fixture() {
 const [account,setAccount] = useState('a');
 const [human,setHuman] = useState({user_id:'a',username:'same-name',avatar_url:'/avatars/avatar-03.webp'});
 const [hub,setHub] = useState('https://hub-a.test');
 window.showHuman=(person,hubUrl)=>{setHuman(person);setHub(hubUrl);};
 window.changeNodeAvatar=()=>setLocalAvatarEcho('same-name','https://node-only.test/avatar.png');
 return <div style={{maxWidth:600,margin:'auto'}}><button id="switch" onClick={()=>setAccount(account==='a'?'b':'a')}>Switch account</button><UserAvatarEditor cfg={{serverUrl:location.origin,token:`dummy-${account}`,username:'same-name'}} /><HumanAvatar hubUrl={hub} person={human} fixedSize size={34} testID="human-display" /></div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
