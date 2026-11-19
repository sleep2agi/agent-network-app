// #296 —— 主动消息(send_desktop_message / user_inbox)带 meta.attachments 时,桌面和手机都不画附件卡片。
// 两处断点:① proactiveItemsForAgent 没把 meta_json 带进 ChatItem(回复气泡只认 reply_attachments);
//          ② 只有附件的行正文为空,被 `if (!body) continue` 整条丢掉。
import { readFileSync } from 'node:fs';
import { parseMetaAttachmentRefs, stripAttachmentPlaceholder } from './attachment-display';
import { proactiveAttachmentPreview, proactiveItemsForAgent } from './proactive-messages';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

// 真实形状:本机 hub user_inbox 里一条真实主动消息的 meta_json(只保留形状与字段,file_id 已换值)。
const REAL_SHAPE = JSON.stringify({
  attachments: [
    { type: 'file', file_id: '11e48fa3deee4f05a607596456cef3aa', name: '方案.html', mime: 'text/html', size: 90497 },
    { type: 'file', file_id: 'e41e98e505994408a2bb0463e07de52e', name: '首页.png', mime: 'image/png', size: 216720 },
  ],
});

const withText = proactiveItemsForAgent([
  { message_id: 'dm_a', from_session: 'demo', kind: 'agent_message', title: '原型已出', content: '见附件', meta_json: REAL_SHAPE },
] as any, 'demo', 'tester');
check('① 带附件的主动消息把 meta_json 带进 ChatItem', withText.length === 1 && withText[0].meta_json === REAL_SHAPE);
check('① meta_json 能解析出 2 个附件(渲染端据此画卡片)', parseMetaAttachmentRefs(withText[0]?.meta_json).length === 2);

const onlyImage = proactiveItemsForAgent([
  { message_id: 'dm_b', from_session: 'demo', title: null, content: '', meta_json: JSON.stringify({ attachments: [{ type: 'file', file_id: 'e41e98e505994408a2bb0463e07de52e', name: 'a.png', mime: 'image/png' }] }) },
] as any, 'demo', 'tester');
check('② 只有图片的主动消息不再丢失,正文占位「[图片]」', onlyImage.length === 1 && onlyImage[0].result === '[图片]');

const onlyFile = proactiveItemsForAgent([
  { message_id: 'dm_c', from_session: 'demo', content: '   ', meta_json: JSON.stringify({ attachments: [{ type: 'file', file_id: '11e48fa3deee4f05a607596456cef3aa', name: 'a.pdf', mime: 'application/pdf' }] }) },
] as any, 'demo', 'tester');
check('② 只有非图片附件 → 占位「[文件]」', onlyFile.length === 1 && onlyFile[0].result === '[文件]');

const empty = proactiveItemsForAgent([
  { message_id: 'dm_d', from_session: 'demo', content: '', title: null },
  { message_id: 'dm_e', from_session: 'demo', content: '', meta_json: '{"attachments":[]}' },
  { message_id: 'dm_f', from_session: 'demo', content: '', meta_json: '{oops' },
] as any, 'demo', 'tester');
check('② 没正文也没附件(或 meta 坏)仍丢弃 —— 不制造空气泡', empty.length === 0);
check('proactiveAttachmentPreview: 坏 JSON / 空 → null', proactiveAttachmentPreview('{oops') === null && proactiveAttachmentPreview('') === null && proactiveAttachmentPreview(null) === null);

// 渲染契约:附件卡片必须画在回复侧,且只对主动消息读 meta.attachments(普通任务里那是提问者的附件,#1823)。
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const replyFn = chat.slice(chat.indexOf('const replyAttachmentViews = ('), chat.indexOf('/** Replace markdown file links with just the file name'));
check('③ replyAttachmentViews 里,主动项把 meta.attachments 当回复侧附件', /_proactive[\s\S]{0,200}parseMetaAttachmentRefs/.test(replyFn));
check('③ 普通任务仍只认 reply_attachments(#1823 不回退)', replyFn.includes('parseMetaReplyAttachmentRefs'));
check('③ 回复气泡先算附件再压占位正文', chat.includes('const replyViews = replyAttachmentViews(item, cfg.serverUrl);') && chat.includes('stripAttachmentPlaceholder(cleanAttachmentDebugText(replyQuoted.body), replyViews.length > 0)'));

check('占位只在真有卡片时消失,别的内容原样', stripAttachmentPlaceholder('[图片]', true) === ''
  && stripAttachmentPlaceholder('[文件]', true) === ''
  && stripAttachmentPlaceholder('[图片]', false) === '[图片]'
  && stripAttachmentPlaceholder('看这个 [图片]', true) === '看这个 [图片]');

console.log(`proactive attachments: ${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
