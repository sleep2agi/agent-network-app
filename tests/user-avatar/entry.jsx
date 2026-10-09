import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import UserAvatarEditor from '../../src/UserAvatarEditor';
import { setLanguagePreference } from '../../src/i18n';
import { setThemePreference } from '../../src/theme';
setLanguagePreference('zh'); setThemePreference('light');
function Fixture() {
 const [account,setAccount] = useState('a');
 return <div style={{maxWidth:600,margin:'auto'}}><button id="switch" onClick={()=>setAccount(account==='a'?'b':'a')}>Switch account</button><UserAvatarEditor cfg={{serverUrl:location.origin,token:`dummy-${account}`,username:'same-name'}} /></div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
