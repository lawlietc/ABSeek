// 给 sources.json 的源补 priority 字段，验证后删除
import * as fs from 'fs';
const p = './data/config/sources.json';
const sf = JSON.parse(fs.readFileSync(p, 'utf8'));

// priority 建议：官方源=1，权威综合=2，中文源=3，聚合=4
const priorityMap = {
  // B 平台官方 (1)
  psblog: 1, xboxwire: 1, nintendolife: 1, pushsquare: 1, purexbox: 1, steamnews: 1,
  // A 权威综合 (2)
  ign: 2, eurogamer: 2, polygon: 2, pcgamer: 2, gamespot: 2, kotaku: 2, rps: 2,
  vg247: 2, gameinformer: 2, pcgamesn: 2, destructoid: 2,
  // C 日系 (2)
  gematsu: 2, siliconera: 2,
  // D 中文 (3)
  gcores: 3, gamersky: 3, '3dmgame': 3, ali213: 3, yystv: 3, a9vg: 3,
};

let count = 0;
for (const s of sf.sources) {
  if (priorityMap[s.id] !== undefined) {
    s.priority = priorityMap[s.id];
    count++;
  } else {
    s.priority = 99;
  }
}

fs.writeFileSync(p + '.new', JSON.stringify(sf, null, 2), 'utf8');
fs.copyFileSync(p + '.new', p);
fs.unlinkSync(p + '.new');

// 验证
const v = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log(`已给 ${count} 个源补 priority`);
for (const s of v.sources) {
  console.log(`  ${s.id.padEnd(16)} priority=${s.priority}`);
}
