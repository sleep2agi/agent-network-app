// #3665 App 侧：管理员角色的「范围」（全部 / 仅某部门）——纯逻辑层。
//
// 负责人 2026-11-21 定的落点：`MemberEditor.tsx` 的「成员·xxx」弹窗里，选「管理员」时
// 把写死的提示换成范围选择；owner 不出现这条（owner 本来就是最高权限）。
//
// 接口（通信欧在接）：GET/PUT /api/users/:user_id/grants。
//   · 「全部」= 不调用 / 清空该用户的 department scope 授权；
//   · 「仅某部门」= PUT { capability:'manage_nodes', scope_kind:'department', scope_id:<部门>, level:'edit' }。
// 在接口形状落地前，这里只做**纯函数**：选项、校验、要发的载荷，以及从 grants 反推当前范围。

export type DepartmentScopeMode = 'all' | 'department';

export type DepartmentNode = { id: string; name: string; depth?: number };

/** 把一个部门 id + 模式变成要 PUT 的那一条 grant；「全部」返回 null（= 不发 scope 授权）。 */
export function departmentGrantPayload(input: {
  mode: DepartmentScopeMode;
  departmentId?: string | null;
}): { capability: 'manage_nodes'; scope_kind: 'department'; scope_id: string; level: 'edit' } | null {
  if (input.mode === 'all') return null;
  const id = String(input.departmentId ?? '').trim();
  if (!id) return null;
  return { capability: 'manage_nodes', scope_kind: 'department', scope_id: id, level: 'edit' };
}

/** 提交前校验：选了「仅某部门」但没挑部门 → 拒绝（不要默默按「全部」发出去）。 */
export function validateDepartmentScope(input: {
  mode: DepartmentScopeMode;
  departmentId?: string | null;
}): { ok: true } | { ok: false; error: 'department_required' } {
  if (input.mode === 'all') return { ok: true };
  return String(input.departmentId ?? '').trim() ? { ok: true } : { ok: false, error: 'department_required' };
}

/** 从该用户的 grants 里反推当前范围（用于打开弹窗时回显）。 */
export function scopeFromGrants(
  grants: ReadonlyArray<{ capability?: string; scope_kind?: string; scope_id?: string | null; level?: string }> | null | undefined,
): { mode: DepartmentScopeMode; departmentId: string | null } {
  const hit = (grants ?? []).find(g => g
    && g.capability === 'manage_nodes'
    && g.scope_kind === 'department'
    && typeof g.scope_id === 'string'
    && g.scope_id.trim()
    && (g.level === undefined || g.level === 'edit'));
  return hit ? { mode: 'department', departmentId: String(hit.scope_id).trim() } : { mode: 'all', departmentId: null };
}

/** 部门下拉的选项：按树顺序，名称带缩进（深度由调用方给，或按 parent 关系算）。 */
export function departmentOptions(nodes: ReadonlyArray<DepartmentNode> | null | undefined): DepartmentNode[] {
  const out: DepartmentNode[] = [];
  const seen = new Set<string>();
  for (const n of nodes ?? []) {
    const id = String(n?.id ?? '').trim();
    const name = String(n?.name ?? '').trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, ...(typeof n.depth === 'number' ? { depth: n.depth } : {}) });
  }
  return out;
}

export function departmentScopeErrorText(code: string): string {
  if (code === 'department_required') return '选了「仅某部门」就要挑一个部门。';
  return code;
}

/** 整份替换时的合并：保留其它 capability 的授权，只替换 manage_nodes 那一组。
 *  mode='all' → 去掉 manage_nodes（默认管理员本来就有全网权限）；mode='department' → 换成一条 department/edit。 */
export function mergeUserGrants(
  existing: ReadonlyArray<{ capability?: string; scope_kind?: string; scope_id?: string | null; level?: string }> | null | undefined,
  input: { mode: DepartmentScopeMode; departmentId?: string | null },
): Array<{ capability: string; scope_kind: string; scope_id: string; level: string }> {
  const kept: Array<{ capability: string; scope_kind: string; scope_id: string; level: string }> = [];
  for (const g of existing ?? []) {
    const capability = String(g?.capability ?? '').trim();
    if (!capability || capability === 'manage_nodes') continue;
    kept.push({
      capability,
      scope_kind: String(g?.scope_kind ?? '').trim(),
      scope_id: String(g?.scope_id ?? '').trim(),
      level: String(g?.level ?? '').trim(),
    });
  }
  const payload = departmentGrantPayload(input);
  return payload ? [...kept, payload] : kept;
}

/** 把候选部门按负责范围过滤：不是部门负责人（allowed 为空且不是 network 级）就不过滤。
 *  负责人只能授自己子树内的部门；接口层会 403，UI 上先不给选。 */
export function filterGrantableDepartments(
  nodes: ReadonlyArray<DepartmentNode> | null | undefined,
  allowedIds: ReadonlyArray<string> | null | undefined,
): DepartmentNode[] {
  const all = departmentOptions(nodes);
  const allowed = (allowedIds ?? []).map(id => String(id ?? '').trim()).filter(Boolean);
  if (!allowed.length) return all;
  const set = new Set(allowed);
  return all.filter(n => set.has(n.id));
}

/** Hub 的范围授权错误码 → 用户能看懂的一句话（实测生产 .288 契约）。
 *  未列出的码原样返回，方便报障时对得上日志。 */
export function grantErrorText(code: string | null | undefined): string {
  switch (code) {
    case 'permission_denied':
      return '你没有权限授这个部门（部门负责人只能授自己负责的部门）。';
    case 'department_not_found':
      return '这个部门不存在（可能已被删除）。';
    case 'invalid_scope':
    case 'invalid_scope_kind':
      return 'Hub 不认识这个范围类型（客户端与 Hub 版本可能不一致）。';
    case 'scope_id_required':
      return '选了「仅某部门」但没有选部门。';
    case 'invalid_grants':
      return '请求格式不对（客户端的范围授权数据没通过 Hub 校验）。';
    case 'user_not_found':
      return '这个成员已经不在网络里了。';
    case 'network_id_required':
      return 'Hub 没认出当前网络，请切换网络后重试。';
    case 'unsupported':
      return '当前 Hub 还不支持范围授权。';
    default:
      return String(code ?? '').trim() || '保存失败，请重试。';
  }
}
