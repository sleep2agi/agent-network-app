// 所见即所得的唯一一个按需加载入口(rich-support.web.tsx import() 它)。编辑器和往返判据必须从同一个 import() 进来:
// 两个 import() 都用到 TipTap 时,Metro 会把共用的部分提到启动就加载的 __common 包里(实测 618KB 进了首屏)。
export { richSafety } from './rich-markdown';
export { default as RichDescriptionEditor } from './RichDescriptionEditor';
