// POST /api/upload 的地址(纯函数,ck 测试直接跑 —— attach.ts 本身带 expo 依赖)。
// network_id:文件归到这个网络(Hub 的 /api/files 按网络成员放行,查看任务的同网成员都能看到)。
//   多网络账号不带会 400 network_id_required。uploadImage 不带时自动取 cfg.networkId(或 /api/auth/me 选的网络)。
// purpose=dm:人与人私信的附件。新 Hub 只让私信里的人(和上传者、管理员)下载它;旧 Hub 忽略这个参数,行为不变。
export type UploadOptions = { networkId?: string; purpose?: 'dm' };

export const uploadUrlFor = (serverUrl: string, opts: UploadOptions = {}): string => {
  const params = [
    ...(opts.networkId ? [`network_id=${encodeURIComponent(opts.networkId)}`] : []),
    ...(opts.purpose ? [`purpose=${opts.purpose}`] : []),
  ];
  return `${serverUrl}/api/upload${params.length ? `?${params.join('&')}` : ''}`;
};

/**
 * Which network an upload is filed under. Explicit opts win, then the app's current network, then a lookup
 * (/api/auth/me → pickDefaultNetworkId). A lookup failure uploads without it, exactly as before.
 * 10-04: fiona (member of two networks) got 400 network_id_required on every chat image because agent-chat
 * uploads never sent one.
 */
export const resolveUploadNetworkId = async (
  opts: UploadOptions,
  cfgNetworkId: string | undefined,
  lookup: () => Promise<string | undefined>,
): Promise<string | undefined> => {
  if (opts.networkId) return opts.networkId;
  if (cfgNetworkId) return cfgNetworkId;
  try { return await lookup(); } catch { return undefined; }
};
