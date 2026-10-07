// npm run dist [-- --platform=linux|win32|darwin] [--arch=x64|arm64] [--out=release]
// Builds the page and packages the desktop app for this machine, or for the platform and
// architecture named. The result is a folder under release/ holding the app and its launcher.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const project = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : fallback; };
const platform = arg('platform', process.platform), arch = arg('arch', process.arch), out = arg('out', 'release');

const build = spawnSync(process.execPath, [path.join(project, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: project, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);

const made = await packager({
  dir: project, name: 'Sunrise Scenes', platform, arch, out: path.join(project, out), overwrite: true,
  // On Linux the launcher is a plain command name; elsewhere it keeps the product name.
  executableName: platform === 'linux' ? 'sunrise-scenes' : undefined,
  // Only the built page, the desktop shell and the runtime dependencies go in.
  ignore: [/^\/(src|tests|docs|scripts|release[^/]*|\.claude|\.git|\.github)(\/|$)/, /^\/(vite\.config\.js|CLAUDE\.md|README\.md|index\.html|\.gitignore|\.gitattributes)$/],
});
for (const dir of made) console.log('Packaged: ' + path.relative(project, dir));
if (platform === 'linux') console.log('Run it with: "' + path.join(path.relative(project, made[0]), 'sunrise-scenes') + '"  (see README.md, "Linux", if it stops with a sandbox message)');
