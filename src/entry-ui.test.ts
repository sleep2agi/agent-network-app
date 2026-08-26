import fs from 'node:fs';

const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const checks: Array<[string, boolean]> = [
  ['first run and login share the polished entry surface', (app.match(/makeEntryStyles/g) || []).length >= 3 && app.includes('entryStyles.glowTop')],
  ['first run explains local benefits before the primary action', app.includes('开箱即用') && app.includes('本地优先') && app.indexOf('开箱即用') < app.indexOf('创建本地工作区')],
  ['remote login remains a distinct secondary action', app.includes('使用已有服务器登录') && app.includes('globe-outline')],
  ['login uses visible labels instead of placeholder-only fields', app.includes('<Text style={loginStyles.label}>服务器地址</Text>') && app.includes('<Text style={loginStyles.label}>用户名</Text>') && app.includes('<Text style={loginStyles.label}>密码</Text>')],
  ['password visibility control is accessible', app.includes("accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'}") && app.includes('secureTextEntry={!passwordVisible}')],
  ['login remains keyboard-safe and scrollable on compact screens', app.includes('<KeyboardAvoidingView') && app.includes('keyboardShouldPersistTaps="handled"')],
  ['login failures remain announced and structurally classified', app.includes('testID={`login-error-${failKind}`}') && app.includes('accessibilityRole="alert"')],
  ['busy and disabled states remain explicit', app.includes('testID="login-busy"') && app.includes('disabled={busy || !serverUrl || !username || !password}')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

console.log(`RESULT: ${checks.length}/${checks.length}`);
