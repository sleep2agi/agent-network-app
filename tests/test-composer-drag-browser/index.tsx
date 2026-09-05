import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text, PanResponder } from 'react-native-web/dist/cjs/index.js';
import { composerDragHandlers, lockDocumentSelection, composerHeightFromDrag, clampComposerHeight } from '../../src/composer-resize';

const ROOT = 800;
const lines = Array.from({ length: 6 }, (_, i) => `message line ${i + 1} — some selectable chat text that a stray drag would highlight`);

function Panel({ id, h, pan, divStyle }: { id: string; h: number; pan: any; divStyle: any }) {
  return (
    <View testID={`${id}-panel`} style={{ width: 420, borderWidth: 1, borderColor: '#999', margin: 12 }}>
      <View testID={`${id}-list`} style={{ padding: 8 }}>
        {lines.map((l, i) => <Text key={i} style={{ fontSize: 13, lineHeight: 20 }}>{l}</Text>)}
      </View>
      <View {...pan.panHandlers} testID={`${id}-divider`} style={[{ height: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eee', cursor: 'ns-resize' }, divStyle]}>
        <View style={{ width: 36, height: 3, borderRadius: 2, backgroundColor: '#888' }} />
      </View>
      <View testID={`${id}-composer`} style={{ height: h, backgroundColor: '#dfe' }}>
        <Text testID={`${id}-h`}>{String(h)}</Text>
      </View>
    </View>
  );
}

// 0.2.46 shape, verbatim: PanResponder rebuilt on every height change, no preventDefault, no userSelect.
function Old() {
  const [h, setH] = useState(200);
  const start = useRef(h);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = clampComposerHeight(h, ROOT); },
    onPanResponderMove: (_e: any, g: any) => { setH(composerHeightFromDrag(start.current, g.dy, ROOT)); },
    onPanResponderRelease: (_e: any, g: any) => { setH(composerHeightFromDrag(start.current, g.dy, ROOT)); },
    onPanResponderTerminate: () => {},
  }), [h]);
  return <Panel id="old" h={h} pan={pan} divStyle={null} />;
}

// Fixed shape: same as ChatScreen after the fix.
function Fixed() {
  const [h, setH] = useState(200);
  const ref = useRef(h); ref.current = h;
  const pan = useMemo(() => PanResponder.create(composerDragHandlers({
    getHeight: () => ref.current, getRootHeight: () => ROOT, setHeight: setH, save: () => {}, lockSelection: lockDocumentSelection,
  })), []);
  return <Panel id="fixed" h={h} pan={pan} divStyle={{ userSelect: 'none' }} />;
}

createRoot(document.getElementById('root')!).render(<View style={{ flexDirection: 'row' }}><Old /><Fixed /></View>);
