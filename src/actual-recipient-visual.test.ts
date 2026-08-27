import fs from 'node:fs';

const source = fs.readFileSync(new URL('./ActualRecipientNotice.tsx', import.meta.url), 'utf8');
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
};

check('notice palette is selected from the live theme', source.includes("themeMode() === 'light'"));
check('light sent notice uses a pale semantic surface', source.includes("'#effaf3'") && source.includes("'#bfe5cc'"));
check('queued notice has a distinct restrained palette', source.includes("'#fff8eb'") && source.includes("'#f0d7a6'"));
check('notice no longer uses the static dark card surface', !source.includes('backgroundColor: colors.card'));
check('legacy Hub copy is concise', source.includes('接收方由旧版 Hub 处理'));
check('identity stays on one compact line', source.includes('numberOfLines={1}'));

console.log('actual recipient visual contract: 6/6 checks passed');
