import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import AliasAvatar from './AliasAvatar';
import type { HubTask } from './api';
import { BOARD_COLUMN_LABEL, groupTasksByBucket, statusBucket, type StatusBucket } from './tasks-filter';
import { colors, radius, spacing } from './theme';
import { formatTime } from './time';

const DOT: Record<StatusBucket, string> = {
  running: colors.running,
  failed: colors.failed,
  replied: colors.accent,
  pending: colors.blocked,
  unknown: colors.rest,
};

export default function TaskBoard({
  tasks,
  onOpenTask,
}: {
  tasks: HubTask[];
  onOpenTask: (taskId: string) => void;
}) {
  const columns = useMemo(() => groupTasksByBucket(tasks), [tasks]);
  const styles = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md, gap: spacing.md },
    col: { width: 280, maxHeight: '100%', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm },
    head: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
    headText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    count: { color: colors.textMuted, fontSize: 12 },
    card: { padding: spacing.sm, borderRadius: radius.sm, marginBottom: spacing.sm, backgroundColor: colors.bg },
    line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    status: { color: colors.textSecondary, fontSize: 11, flex: 1 },
    high: { color: colors.failed, fontSize: 11, fontWeight: '700' },
    time: { color: colors.textMuted, fontSize: 11 },
    who: { color: colors.text, fontSize: 12, flexShrink: 1 },
    arrow: { color: colors.textMuted, fontSize: 12 },
    body: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    empty: { color: colors.textMuted, fontSize: 12, padding: spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
  }), []);

  return (
    <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.row} testID="task-board">
      {columns.map(col => (
        <View key={col.bucket} style={styles.col} testID={`task-board-col-${col.bucket}`}>
          <View style={styles.head}>
            <Text style={styles.headText}>{BOARD_COLUMN_LABEL[col.bucket]}</Text>
            <Text style={styles.count}>{col.tasks.length}</Text>
          </View>
          <ScrollView>
            {col.tasks.length === 0 ? <Text style={styles.empty}>没有</Text> : null}
            {col.tasks.map(item => {
              const tid = item.task_id;
              return (
                <Pressable
                  key={tid || `${item.from_name}-${item.created_at}`}
                  style={styles.card}
                  onPress={() => tid && onOpenTask(tid)}
                  disabled={!tid}
                  testID={`task-board-card-${tid || 'noid'}`}
                >
                  <View style={styles.line}>
                    <View style={[styles.dot, { backgroundColor: DOT[statusBucket(item.status)] }]} />
                    <Text style={styles.status} numberOfLines={1}>{item.status || 'pending'}</Text>
                    {item.priority === 'high' ? <Text style={styles.high}>HIGH</Text> : null}
                    <Text style={styles.time}>{formatTime(item.created_at)}</Text>
                  </View>
                  <View style={styles.line}>
                    <AliasAvatar alias={item.from_name || '?'} size={18} />
                    <Text style={styles.who} numberOfLines={1}>{item.from_name || '?'}</Text>
                    <Text style={styles.arrow}>→</Text>
                    <AliasAvatar alias={item.to_name || '?'} size={18} />
                    <Text style={styles.who} numberOfLines={1}>{item.to_name || '?'}</Text>
                  </View>
                  <Text style={styles.body} numberOfLines={3}>{item.content || '（无内容）'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}
