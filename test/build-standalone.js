/* 构建单文件版：内联 css 与全部 js 到一个 HTML */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');

// 内联样式
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf-8');
html = html.replace(
  /<link rel="stylesheet" href="css\/style.css">/,
  () => '<style>\n' + css + '\n</style>'
);

// 按顺序内联脚本
const scriptRe = /<script src="js\/([\w-]+)\.js"><\/script>/g;
const scripts = [];
html = html.replace(scriptRe, (_m, name) => {
  const code = fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf-8');
  scripts.push(name);
  return '<script>\n' + code + '\n</script>';
});

if (/<script src=|<link rel="stylesheet"/.test(html)) {
  console.error('✗ 仍有未内联的外部引用'); process.exit(1);
}
if (scripts.length !== 12) { console.error('✗ 脚本数量异常:', scripts.length); process.exit(1); }

const out = path.join(root, 'dist', '王朝模拟器-单文件版.html');
fs.writeFileSync(out, html);
console.log(`✓ 单文件版已生成: ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB, 内联 ${scripts.length} 个脚本)`);
