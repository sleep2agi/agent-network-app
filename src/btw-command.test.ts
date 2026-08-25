import { parseBtwFirstToken, shouldSubmitBtwOnEnter } from './btw-command';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) {
    passed += 1;
    console.log('✅', name);
  } else {
    console.error('❌', name);
  }
};

check('首 token /btw 被识别', JSON.stringify(parseBtwFirstToken('/btw 如何看日志？')) === JSON.stringify({ kind: 'btw', prompt: '如何看日志？' }));
check('允许命令前空白与换行分隔问题', parseBtwFirstToken('  /btw\n问题').kind === 'btw');
check('只识别完整 token', parseBtwFirstToken('/btwfoo 不是命令').kind === 'ordinary');
check('非首 token 不触发', parseBtwFirstToken('请执行 /btw 问题').kind === 'ordinary');
check('转义命令走普通消息并移除反斜杠', JSON.stringify(parseBtwFirstToken('  \\/btw 原样发送')) === JSON.stringify({ kind: 'ordinary', content: '  /btw 原样发送', escaped: true }));
check('空问题明确报错', parseBtwFirstToken('/btw').kind === 'invalid');
check('纯空白问题明确报错', parseBtwFirstToken('/btw \n\t').kind === 'invalid');
check('普通 slash 命令不受影响', parseBtwFirstToken('/goal ship it').kind === 'ordinary');
check('BTW composer 裸 Enter 提交', shouldSubmitBtwOnEnter({ key: 'Enter' }));
check('BTW composer Shift+Enter 换行', !shouldSubmitBtwOnEnter({ key: 'Enter', shiftKey: true }));
check('BTW composer IME composition 不误触发', !shouldSubmitBtwOnEnter({ key: 'Enter', isComposing: true }));
check('BTW composer 旧 WebView 229 不误触发', !shouldSubmitBtwOnEnter({ key: 'Enter', keyCode: 229 }));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
