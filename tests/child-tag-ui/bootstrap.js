// The shared desktop bridge targets only this fixture's loopback origin.
(() => {
  localStorage.setItem('anet.language.v1', new URLSearchParams(location.search).get('language') || 'zh-CN');
})();
