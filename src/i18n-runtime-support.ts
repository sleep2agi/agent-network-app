import { registerTranslations } from './i18n';

registerTranslations({
  'runtimeSupport.hint': [
    '每个 Runtime 对 ANet 功能的支持程度。功能表对照公开支持矩阵；没有验证过的格子保持「未验证」。',
    'How far each runtime supports ANet features. The table follows the public support matrix. Cells that have not been verified stay Unverified.',
  ],
  'runtimeSupport.section.features': ['ANet 功能支持', 'ANet feature support'],
  'runtimeSupport.section.host': ['本机探测', 'This machine'],
  'runtimeSupport.section.providers': ['这台机器上的 Provider 与模型', 'Providers and models on this machine'],
  'runtimeSupport.select': ['点一个 Runtime，查看它对 ANet 功能的支持。', 'Select a runtime to see which ANet features it supports.'],
  'runtimeSupport.docs': ['公开支持矩阵', 'Public support matrix'],
  'runtimeSupport.matrixCaption': [
    '功能表是客户端整理的演示数据，不是 Hub 的实时接口。',
    'This feature table is demo data prepared in the client, not a live Hub API.',
  ],
  'runtimeSupport.host.liveCaption': [
    '下面来自这台 daemon 上报的 host_supervisor，不是功能表里的演示格。',
    'The lines below come from this daemon\'s host_supervisor report, not from the demo feature table.',
  ],
  'runtimeSupport.host.pending': [
    '正在读取这台主机的 daemon。',
    'Reading this host\'s daemon.',
  ],
  'runtimeSupport.host.missing': [
    '这台主机还没有 daemon 上报，所以没有本机探测。',
    'This host has not reported a daemon, so there is no machine check.',
  ],
  'runtimeSupport.host.unlisted': [
    '这台 Hub 的 host_supervisor 列表里没有这台 daemon，所以没有本机探测。',
    'This Hub\'s host_supervisor list does not include this daemon, so there is no machine check.',
  ],
  'runtimeSupport.host.several': [
    '这台 Hub 上报了不止一台 daemon。当前按一台主机一台 daemon 使用，这里不提供选择。',
    'This Hub reported more than one daemon. This page assumes one daemon per host and does not offer a choice.',
  ],
  'runtimeSupport.host.error': [
    '没能读到 host_supervisor，本机探测先空着。',
    'host_supervisor could not be read. The machine check is empty for now.',
  ],
  'runtimeSupport.host.createReady': ['这台 daemon 上报可以建节点。', 'This daemon reports it can create nodes.'],
  'runtimeSupport.host.createBlocked': [
    '这台 daemon 上报建不了节点（{reason}）。',
    'This daemon reports it cannot create nodes ({reason}).',
  ],
  'runtimeSupport.host.createUnknown': [
    '这台 daemon 没报过能不能建节点。',
    'This daemon has not reported whether it can create nodes.',
  ],
  'runtimeSupport.host.doctor': [
    '原因代码的修法在那台机器上。运行 anet doctor 或 anet daemon list 会打印出来。',
    'The fix for that reason code is on that machine. Run anet doctor or anet daemon list.',
  ],
  'runtimeSupport.host.adoptYes': [
    '这台 daemon 上报可以收编。收编是否覆盖这个 runtime，公开矩阵没有按 runtime 验证。',
    'This daemon reports adoption is available. The public matrix does not verify adoption per runtime.',
  ],
  'runtimeSupport.host.adoptNo': ['这台 daemon 上报不能收编。', 'This daemon reports adoption is not available.'],
  'runtimeSupport.host.adoptUnknown': ['这台 daemon 没有上报收编能力。', 'This daemon did not report adoption capability.'],
  'runtimeSupport.host.version': ['探测到的版本 {version}。', 'Reported version {version}.'],
  'runtimeSupport.host.ready': ['本机探测：这个 runtime 可以创建。', 'This machine: this runtime can be created.'],
  'runtimeSupport.host.blocked': ['本机探测：这个 runtime 现在创建不了。', 'This machine: this runtime cannot be created right now.'],
  'runtimeSupport.host.unknown': ['本机探测：这个 runtime 还没检测。', 'This machine: this runtime has not been checked.'],
  'runtimeSupport.host.undeclared': [
    '这台 daemon 的 runtimes_supported 没有声明这个 runtime。',
    'This daemon\'s runtimes_supported list does not declare this runtime.',
  ],
  'runtimeSupport.badge.ready': ['本机可创建', 'Ready here'],
  'runtimeSupport.badge.blocked': ['本机不可用', 'Unavailable here'],
  'runtimeSupport.badge.unknown': ['本机未检测', 'Not checked'],
  'runtimeSupport.badge.undeclared': ['未声明', 'Not declared'],
  'runtimeSupport.upgrade.npm': [
    '这台 daemon 还没有上报完整的 runtime 探测或建节点能力。在那台机器上执行 npm install -g @sleep2agi/agent-node@preview，然后重启 daemon。',
    'This daemon has not reported runtime readiness or node-creation capability. On that machine run npm install -g @sleep2agi/agent-node@preview, then restart the daemon.',
  ],
  'runtimeSupport.upgrade.hub': [
    '当前 Hub 没有 host_supervisor 列表，看不到这台机器的探测。升级 Hub 到 commhub-server@0.9.0-preview.8 以上后再看。',
    'This Hub has no host_supervisor list, so this machine cannot be checked. Upgrade the Hub to commhub-server@0.9.0-preview.8 or newer, then look again.',
  ],
  'runtimeSupport.maturity.stable': ['稳定', 'Stable'],
  'runtimeSupport.maturity.preview': ['预览', 'Preview'],
  'runtimeSupport.maturity.experimental': ['实验性', 'Experimental'],
  'runtimeSupport.level.supported': ['支持', 'Supported'],
  'runtimeSupport.level.partial': ['部分', 'Partial'],
  'runtimeSupport.level.unsupported': ['不支持', 'Unsupported'],
  'runtimeSupport.level.unverified': ['未验证', 'Unverified'],
  'runtimeSupport.level.na': ['不适用', 'Not applicable'],
  'runtimeSupport.feature.hub_chat': ['Hub 对话', 'Hub chat'],
  'runtimeSupport.feature.tui_copresence': ['TUI 共存', 'TUI co-presence'],
  'runtimeSupport.feature.daemon_lifecycle': ['Daemon 建节点/生命周期', 'Daemon create and lifecycle'],
  'runtimeSupport.feature.adopt': ['收编', 'Adoption'],
  'runtimeSupport.feature.provider_config': ['Provider 配置', 'Provider setup'],
  'runtimeSupport.feature.skills': ['Skills', 'Skills'],
  'runtimeSupport.feature.tokens': ['令牌', 'Tokens'],
  'runtimeSupport.feature.steer': ['Steer', 'Steer'],
  'runtimeSupport.feature.long_task': ['长时间任务', 'Long-running tasks'],
  'runtimeSupport.runtime.claudeAgentSdk': ['Claude Agent SDK', 'Claude Agent SDK'],
  'runtimeSupport.runtime.claudeCodeCli': ['Claude Code（TUI 共存）', 'Claude Code (TUI co-presence)'],
  'runtimeSupport.runtime.codexSdk': ['Codex SDK', 'Codex SDK'],
  'runtimeSupport.runtime.codexAppServer': ['Codex（TUI 共存）', 'Codex (TUI co-presence)'],
  'runtimeSupport.runtime.grokAcp': ['Grok', 'Grok'],
  'runtimeSupport.runtime.grokCli': ['Grok 共存（实验性）', 'Grok co-presence (experimental)'],
  'runtimeSupport.runtime.opencodeCli': ['OpenCode（TUI 共存）', 'OpenCode (TUI co-presence)'],
  'runtimeSupport.note.hubChat': [
    '公开支持矩阵没有「Hub 对话」这一格。客户端不把它画成已支持。',
    'The public support matrix has no Hub chat cell. The client does not mark it supported.',
  ],
  'runtimeSupport.note.tokens': [
    '令牌仍是演示入口，没有按 runtime 的后端。',
    'Tokens are still a demo entry. There is no per-runtime backend.',
  ],
  'runtimeSupport.note.skills': [
    '节点技能列表是只读的。公开矩阵没有按 runtime 验证。',
    'The node skill list is read-only. The public matrix does not verify it per runtime.',
  ],
  'runtimeSupport.note.skills.grok': [
    '实验性 Grok 共存不加载 .agents/skills。',
    'Experimental Grok co-presence does not load .agents/skills.',
  ],
  'runtimeSupport.note.longTask': [
    '公开矩阵没有「长时间任务」这一格。',
    'The public support matrix has no long-running-task cell.',
  ],
  'runtimeSupport.note.longTask.grok': [
    '人在 TUI 里打字时，网络任务会排队直到超时。',
    'While a person types in the TUI, network tasks queue until they time out.',
  ],
  'runtimeSupport.note.longTask.opencode': [
    '支持矩阵：未执行的 tool_call 可能被记成任务成功，完成状态不可靠。',
    'Support matrix: an unexecuted tool_call can be recorded as success, so completion status is unreliable.',
  ],
  'runtimeSupport.note.adopt': [
    '收编在文档里按操作系统验证（目前 Linux），不是按 runtime。',
    'The docs verify adoption by operating system (Linux for now), not by runtime.',
  ],
  'runtimeSupport.note.adopt.codex': [
    '客户端有 Codex 重新收编的路径。公开矩阵仍没有按 runtime 的验证。',
    'The client has a Codex re-adoption path. The public matrix still does not verify it per runtime.',
  ],
  'runtimeSupport.note.provider.na': [
    '创建向导不给这个 runtime 出供应商表，沿用它自己的登录。',
    'The create wizard has no provider form for this runtime. It keeps the runtime\'s own login.',
  ],
  'runtimeSupport.note.provider.codex': [
    '可以填写 Codex model_providers。保存密钥仍要升级 Hub，这一版不会把密钥发出去。',
    'Codex model_providers can be filled in. Saving a key still requires a Hub upgrade. This version does not send the key.',
  ],
  'runtimeSupport.note.provider.opencode': [
    '使用 OpenCode 自己的 provider/model。这里不收集密钥。',
    'Uses OpenCode\'s own provider/model. This screen does not collect a key.',
  ],
  'runtimeSupport.note.steer.na': [
    '桌面 Hub 对话的 steer 只面向正在进行的 Codex TUI 回合，不用于这个 runtime。',
    'Dashboard steer is for an in-progress Codex TUI turn. It does not apply to this runtime.',
  ],
  'runtimeSupport.note.steer.codex': [
    '桌面 Hub 对话可以 steer 正在进行的 Codex TUI 回合。',
    'Dashboard Hub chat can steer an in-progress Codex TUI turn.',
  ],
  'runtimeSupport.note.daemon.supported': [
    '支持矩阵：经 daemon 的 create_node 已验证。启停删随操作系统，不在这一格重算。',
    'Support matrix: create_node through the daemon is verified. Start, stop, and delete follow the OS and are not re-scored here.',
  ],
  'runtimeSupport.note.daemon.unverified': [
    '支持矩阵：经 daemon 创建尚未端到端复验。需要时在目标机器上用 anet node create 更稳妥。',
    'Support matrix: creating through the daemon has not been re-verified end to end. When you need it, anet node create on the target machine is the safer path.',
  ],
  'runtimeSupport.note.tui.na': [
    '支持矩阵：不是「人和 agent 共用一个 TUI 会话」。',
    'Support matrix: this is not a shared human-and-agent TUI session.',
  ],
  'runtimeSupport.note.tui.naClaude': [
    '支持矩阵把人机共用会话标为不适用。Claude Code CLI 走订阅登录，不是 Codex / OpenCode 那种共存会话。',
    'The support matrix marks a shared TUI session as not applicable. Claude Code CLI uses subscription login, not Codex or OpenCode co-presence.',
  ],
  'runtimeSupport.note.tui.supported': [
    '支持矩阵：人和 agent 可以共用一个 TUI 会话。',
    'Support matrix: a person and an agent can share one TUI session.',
  ],
  'runtimeSupport.note.tui.grok': [
    '支持矩阵标为已验证。共存模式仍是实验性的：人在 TUI 输入时网络任务会排队，grok 需要钉在已验证版本。',
    'The support matrix marks it verified. Co-presence is still experimental: network tasks queue while a person types in the TUI, and grok must stay on a verified version.',
  ],
  'runtimeSupport.note.unknownFeature': [
    '客户端的功能表里没有这个 runtime。格子保持未验证，不猜。',
    'This runtime is not in the client\'s feature table. Cells stay unverified. Nothing is guessed.',
  ],
});
