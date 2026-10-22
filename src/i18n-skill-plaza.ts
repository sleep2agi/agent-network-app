import { registerTranslations } from './i18n';

registerTranslations({
  'skillPlaza.note': ['公开目录，仅供浏览和搜索。节点页的「技能」是节点已安装的技能，不是这里。这里不会安装或执行技能。', 'Public catalogue for browsing and search only, separate from installed skills on a node. Skills are not installed or executed here.'],
  'skillPlaza.back': ['返回目录', 'Back to catalogue'],
  'skillPlaza.search': ['搜索技能', 'Search skills'],
  'skillPlaza.loading': ['正在读取公开目录', 'Loading public catalogue'],
  'skillPlaza.loadingBody': ['正在读取并校验正文', 'Loading and verifying content'],
  'skillPlaza.retry': ['重试', 'Retry'],
  'skillPlaza.empty': ['目录是空的', 'The catalogue is empty'],
  'skillPlaza.noMatch': ['没有匹配的技能', 'No matching skills'],
  'skillPlaza.timeout': ['读取超时，请重试。', 'Request timed out. Try again.'],
  'skillPlaza.catalog': ['目录打不开，请检查网络后重试。', 'Could not load the catalogue. Check the connection and retry.'],
  'skillPlaza.body': ['正文打不开，请检查网络后重试。', 'Could not load the content. Check the connection and retry.'],
  'skillPlaza.json': ['目录格式不正确，请稍后重试。', 'Invalid catalogue format. Try again later.'],
  'skillPlaza.tooLarge': ['正文超过 256 KB，这里不展开。', 'Content exceeds 256 KB and cannot be displayed here.'],
  'skillPlaza.mismatch': ['内容和目录里的校验对不上，已拒绝打开。', 'Content does not match the catalogue checksum. Opening was refused.'],
  'skillPlaza.digest': ['当前环境无法校验内容，已拒绝打开。', 'Content verification is unavailable. Opening was refused.'],
  'skillPlaza.clear': ['清除搜索', 'Clear search'],
});
