// 任务详情的「描述」:markdown 编辑 / 预览,可以放图片。
//   桌面:Ctrl/⌘+V 粘贴截图、把图片拖进编辑框、🖼 按钮选文件;手机:🖼 按钮打开相册(没有拖放)。
//   图片走聊天同一条上传路(/api/upload,12MB),带 network_id 归到当前网络;在光标处插入
//   `![名字](/api/files/<id>)`(独占一行)。
//   预览用 MarkdownMessage(和聊天同一个渲染器),Hub 图片带 Authorization 头下载 —— 地址里不放 token;
//   点图:桌面开 #464 的独立图片窗口,手机 / 纯网页用 App 内的 ImageViewer。
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import MarkdownMessage from './MarkdownMessage';
import AuthedThumb from './AuthedThumb';
import AuthedWebThumb from './AuthedWebThumb';
import ImageViewer from './ImageViewer';
import { colors, spacing } from './theme';
import type { HubConfig } from './api';
import { pickImages, uploadImage, type PickedImage } from './attach';
import { attachmentFromFile, filesFromTransfer, transferHasFiles } from './desktop-file-intake';
import { openGallery, type ViewerImage, type ViewerState } from './image-viewer-model';
import { imagePreviewSurface, imageWindowPayload } from './image-window-model';
import { openImageWindow } from './image-window';
import { DESCRIPTION_MAX } from './task-board-model';
import { checkDescriptionImage, descriptionImages, hubImageMarkdown, insertAtCaret } from './task-description-images';
import { Segmented, useTaskStyles } from './TaskBoardParts';
import { fieldStyles } from './TaskCreateDialog';

type Upload = { id: string; name: string; state: 'uploading' | 'error'; message?: string };

export default function TaskDescriptionEditor({ cfg, value, onChange, pointer, title }: {
  cfg: HubConfig;
  value: string;
  onChange: (v: string) => void;
  /** 鼠标界面:可粘贴 / 拖放图片,点图开独立窗口。 */
  pointer: boolean;
  /** 图片窗口的标题(任务名)。 */
  title: string;
}) {
  const s = useTaskStyles();
  const f = fieldStyles();
  const [mode, setMode] = useState<'edit' | 'preview'>(value.trim() ? 'preview' : 'edit');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const inputRef = useRef<any>(null);
  const boxRef = useRef<any>(null);
  const tauri = Platform.OS === 'web' && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

  // 上传一张:先检查类型 / 大小(错误就地显示),再上传,成功后在「当时的光标处」插入。
  const addImages = async (images: PickedImage[]) => {
    for (const img of images) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const problem = checkDescriptionImage({ name: img.fileName, type: img.mimeType, size: img.fileSize });
      if (problem) { setUploads(u => [...u, { id: key, name: img.fileName, state: 'error', message: problem }]); continue; }
      setUploads(u => [...u, { id: key, name: img.fileName, state: 'uploading' }]);
      try {
        const up = await uploadImage(cfg, img, { networkId: cfg.networkId });
        const next = insertAtCaret(latest.current, selection.current, hubImageMarkdown(img.fileName, up.file_id));
        selection.current = { start: next.caret, end: next.caret };
        onChange(next.text);
        setUploads(u => u.filter(x => x.id !== key));
      } catch (e) {
        setUploads(u => u.map(x => (x.id === key ? { ...x, state: 'error', message: `「${img.fileName}」没有上传:${e instanceof Error ? e.message : String(e)}` } : x)));
      }
    }
  };
  const addRef = useRef(addImages);
  addRef.current = addImages;

  // 桌面:编辑框里粘贴截图 / 拖入图片。纯文字粘贴不拦(照常进输入框)。
  useEffect(() => {
    if (!pointer || mode !== 'edit' || Platform.OS !== 'web') return;
    const input = inputRef.current as any;
    const box = boxRef.current as any;
    if (!input?.addEventListener || !box?.addEventListener) return;
    const onPaste = (e: any) => {
      const files = filesFromTransfer(e.clipboardData);
      if (!files.length) return;
      e.preventDefault?.();
      void addRef.current(files.map(file => attachmentFromFile(file)));
    };
    const onDragOver = (e: any) => { if (transferHasFiles(e.dataTransfer)) { e.preventDefault?.(); setDragOver(true); } };
    const onDragLeave = () => setDragOver(false);
    const onDrop = (e: any) => {
      const files = filesFromTransfer(e.dataTransfer);
      setDragOver(false);
      if (!files.length) return;
      e.preventDefault?.();
      void addRef.current(files.map(file => attachmentFromFile(file)));
    };
    input.addEventListener('paste', onPaste);
    box.addEventListener('dragover', onDragOver);
    box.addEventListener('dragleave', onDragLeave);
    box.addEventListener('drop', onDrop);
    return () => {
      input.removeEventListener('paste', onPaste);
      box.removeEventListener('dragover', onDragOver);
      box.removeEventListener('dragleave', onDragLeave);
      box.removeEventListener('drop', onDrop);
    };
  }, [pointer, mode]);

  // 看大图:描述里所有图都在图库里,←/→ 走这些图。
  const gallery = (): ViewerImage[] => descriptionImages(value).map(img => {
    const url = `${cfg.serverUrl}/api/files/${img.fileId}`;
    return Platform.OS === 'web'
      ? { key: img.fileId, name: img.alt || '图片', authUri: url, save: true }
      : { key: img.fileId, name: img.alt || '图片', fileId: img.fileId, save: true };
  });
  const openViewer = (fileId: string, resolvedUri?: string) => {
    const images = gallery();
    const env = { os: Platform.OS, tauri };
    if (imagePreviewSurface(env) === 'window') {
      const payload = imageWindowPayload({ conversation: images, message: images, tappedKey: fileId, profileId: cfg.profileId, serverUrl: cfg.serverUrl, title, now: Date.now() });
      if (payload) { void openImageWindow(payload, { measureUri: resolvedUri }).then(ok => { if (!ok) setViewer(openGallery(images, fileId, resolvedUri)); }); return; }
    }
    setViewer(openGallery(images, fileId, resolvedUri));
  };

  const renderImage = (img: { alt: string; fileId: string }, key: number) => {
    const url = `${cfg.serverUrl}/api/files/${img.fileId}`;
    return (
      <View key={key} testID={`req-description-image-${img.fileId}`}>
        {tauri ? (
          <AuthedWebThumb uri={url} name={img.alt || '图片'} token={cfg.token} onPress={objectUrl => openViewer(img.fileId, objectUrl)} />
        ) : Platform.OS !== 'web' ? (
          <AuthedThumb fileId={img.fileId} name={img.alt || '图片'} serverUrl={cfg.serverUrl} token={cfg.token} onPress={localUri => openViewer(img.fileId, localUri)} />
        ) : (
          // 纯网页没有带鉴权下载图片的通道:只显示名字,不把 token 放进地址。
          <Text style={s.muted}>[图片] {img.alt}</Text>
        )}
      </View>
    );
  };

  const pick = async () => {
    const images = await pickImages(9).catch(() => []);
    if (images.length) await addImages(images);
  };

  return (
    <View style={{ gap: spacing.sm }} testID="req-description">
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Text style={f.label}>描述</Text>
        <View style={[f.row, { gap: spacing.sm }]}>
          {mode === 'edit' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="插入图片" onPress={() => { void pick(); }} style={s.iconButton} testID="req-description-image-button">
              <Ionicons name="image-outline" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Segmented s={s} items={[{ key: 'edit', label: '编辑' }, { key: 'preview', label: '预览' }]} value={mode} onChange={setMode} testID="req-description-mode" />
        </View>
      </View>
      {mode === 'edit' ? (
        <View ref={boxRef} collapsable={false} style={{ gap: spacing.xs }}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChange}
            onSelectionChange={e => { selection.current = e.nativeEvent.selection; }}
            multiline
            maxLength={DESCRIPTION_MAX}
            placeholder={pointer ? '支持 Markdown;可粘贴或拖入图片' : '支持 Markdown;点右上角图标插入图片'}
            placeholderTextColor={colors.textMuted}
            style={[f.input, { minHeight: 140, textAlignVertical: 'top' }, dragOver && { borderColor: colors.accent, backgroundColor: colors.accent + '10' }]}
            testID="req-description-input"
            accessibilityLabel="描述(Markdown)"
          />
          {value.length > DESCRIPTION_MAX * 0.9 ? <Text style={s.muted}>{value.length} / {DESCRIPTION_MAX}</Text> : null}
        </View>
      ) : (
        <Pressable onPress={() => setMode('edit')} accessibilityRole="button" accessibilityLabel="编辑描述" style={[f.input, { minHeight: 60, backgroundColor: 'transparent' }]} testID="req-description-preview">
          {value.trim() ? <MarkdownMessage renderImage={renderImage}>{value}</MarkdownMessage> : <Text style={s.muted}>还没有描述,点这里编辑</Text>}
        </Pressable>
      )}
      {uploads.map(u => (
        <View key={u.id} style={[f.row, { gap: 6 }]} testID={`req-description-upload-${u.state}`}>
          <Ionicons name={u.state === 'error' ? 'alert-circle-outline' : 'cloud-upload-outline'} size={14} color={u.state === 'error' ? colors.failed : colors.textMuted} />
          <Text style={[u.state === 'error' ? s.err : s.muted, { flex: 1 }]} numberOfLines={2}>{u.state === 'error' ? u.message : `正在上传「${u.name}」…`}</Text>
          {u.state === 'error' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="关闭提示" onPress={() => setUploads(list => list.filter(x => x.id !== u.id))} hitSlop={8}>
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ))}
      <ImageViewer state={viewer} onClose={() => setViewer(null)} serverUrl={cfg.serverUrl} token={cfg.token} />
    </View>
  );
}
