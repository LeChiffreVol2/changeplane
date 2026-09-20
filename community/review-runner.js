import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { OCR_SOURCE, REVIEW_BYTES } from './pipeline.js';
import { normalizeRepoPath } from '../src/lib/changeplane.js';
import { CollectionError } from './transport.js';

const fail = () => { throw new CollectionError('REVIEW_RUNNER_UNAVAILABLE'); };
const sha = /^[a-f0-9]{40}$/u;
const cleanEnv = home => ({ PATH: process.env.PATH, HOME: home, USERPROFILE: home,
  ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'no-config'), GIT_TERMINAL_PROMPT: '0' });

/** Copy exact Git objects for the diff and permitted source only; never mount the operator checkout. */
export function prepareReviewSource(source, destination, request) {
  if (!isAbsolute(source) || !request?.binding || !Array.isArray(request.binding.files)) fail();
  const { headSha, mergeBase, policyRevision } = request.binding;
  if (![headSha, mergeBase, policyRevision].every(value => sha.test(value))) fail();
  const paths = new Set(request.binding.files.flatMap(file => [file.path, file.previousPath].filter(Boolean)));
  if (!paths.size || paths.size > 3000) fail();
  for (const path of paths) if (normalizeRepoPath(path) !== path || path.split('/').some(part => /^\.git$/iu.test(part))) fail();
  mkdirSync(destination, { mode: 0o700 });
  const env = cleanEnv(destination);
  const run = (cwd, args, input) => execFileSync('git', ['--no-replace-objects', '-c', 'core.hooksPath=' + destination,
    '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { env, input, timeout: 10_000, maxBuffer: 8_000_000, stdio: ['pipe', 'pipe', 'pipe'] });
  const from = (...args) => run(source, args).toString('utf8').trim();
  run(destination, ['init', '--quiet', '--template=', '.']);
  const commits = new Set([mergeBase, policyRevision, ...from('rev-list', '--max-count=501', headSha, '^' + mergeBase).split('\n').filter(Boolean)]);
  if (commits.size > 502 || !commits.has(headSha)) fail();
  let bytes = 0;
  const copy = (type, id) => {
    const value = run(source, ['cat-file', type, id]); bytes += value.length;
    if (bytes > 16_000_000 || type === 'blob' && value.length > 512_000) fail();
    if (run(destination, ['hash-object', '-w', '-t', type, '--stdin'], value).toString().trim() !== id) fail();
    return value;
  };
  const shallow = [];
  for (const id of commits) {
    const commit = copy('commit', id).toString('utf8');
    if ([...commit.matchAll(/^parent ([a-f0-9]{40})$/gmu)].some(match => !commits.has(match[1]))) shallow.push(id);
  }
  if (shallow.length) writeFileSync(join(destination, '.git', 'shallow'), shallow.join('\n') + '\n');
  const copied = new Set();
  for (const revision of new Set([mergeBase, headSha, policyRevision])) {
    const tree = from('rev-parse', revision + '^{tree}');
    if (!copied.has(tree)) { copy('tree', tree); copied.add(tree); }
    const entries = run(source, ['ls-tree', '-r', '-t', '-z', revision]).toString('utf8').split('\0').filter(Boolean);
    if (entries.length > 50_000) fail();
    for (const entry of entries) {
      const match = /^(\d+) (blob|tree|commit) ([a-f0-9]{40})\t([\s\S]+)$/u.exec(entry);
      if (!match) fail();
      const [, mode, type, id, path] = match;
      if (type !== 'tree' && !paths.has(path)) continue;
      if (type === 'commit') continue; // Submodule contents stay outside review scope.
      let value;
      if (!copied.has(id)) { value = copy(type, id); copied.add(id); }
      if (revision === policyRevision && type === 'blob' && /^100(?:644|755)$/u.test(mode)
        && !path.startsWith('.opencodereview/')) {
        // Rules/tools always come from the operator image, never a selected PR file.
        const target = join(destination, path); mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, value ?? run(source, ['cat-file', 'blob', id]), { mode: 0o600 });
      }
    }
  }
  run(destination, ['update-ref', 'HEAD', policyRevision]);
  if (run(destination, ['merge-base', mergeBase, headSha]).toString().trim() !== mergeBase) fail();
  return { paths: [...paths], sourceBytes: bytes };
}

/** Explicit opt-in. The engine has no network, key, host checkout or GitHub credentials. */
export function configuredReviewRunner(configuration = process.env, { worker = fileURLToPath(new URL('./review-sandbox.js', import.meta.url)) } = {}) {
  return async (request, { signal } = {}) => {
    if (signal?.aborted) throw new CollectionError('COLLECTION_CANCELLED');
    const image = configuration.CHANGEPLANE_REVIEW_IMAGE, source = configuration.CHANGEPLANE_REVIEW_REPOSITORY;
    const model = configuration.CHANGEPLANE_REVIEW_MODEL || 'gpt-5.6-luna';
    const key = configuration.OPENAI_API_KEY;
    if (!/^sha256:[a-f0-9]{64}$/u.test(image ?? '') || !isAbsolute(source ?? '')
      || !['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'].includes(model)
      || configuration.DOCKER_HOST && !/^unix:\/\/\//u.test(configuration.DOCKER_HOST)
      || typeof key !== 'string' || key.length < 10 || key.length > 4096 || /[\r\n]/u.test(key)) fail();
    const scratch = mkdtempSync(join(tmpdir(), 'changeplane-review-'));
    const name = 'changeplane-' + randomUUID(), volume = name + '-bridge';
    const env = { ...cleanEnv(scratch),
      // Docker configuration belongs to the operator client, never a mounted job.
      ...(configuration.DOCKER_HOST ? { DOCKER_HOST: configuration.DOCKER_HOST } : {}),
      ...(configuration.DOCKER_CONFIG ? { DOCKER_CONFIG: configuration.DOCKER_CONFIG } : {}) };
    const docker = (args, options = {}) => execFileSync('docker', args, { env, encoding: 'utf8', timeout: 15_000,
      maxBuffer: 1_000_000, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let proxy, stage = 'REVIEW_DOCKER_UNAVAILABLE';
    try {
      docker(['info', '--format', '{{.ServerVersion}}']);
      stage = 'REVIEW_IMAGE_UNAVAILABLE';
      const info = JSON.parse(docker(['image', 'inspect', image]))[0];
      if (info.Id !== image || info.Config?.Labels?.['org.changeplane.ocr-source'] !== OCR_SOURCE) fail();
      stage = 'REVIEW_SOURCE_UNAVAILABLE';
      const repository = join(scratch, 'repo'); prepareReviewSource(source, repository, request);
      stage = 'REVIEW_EXECUTION_UNAVAILABLE';
      const output = join(scratch, 'output'); mkdirSync(output, { mode: 0o700 });
      docker(['volume', 'create', volume]);
      const common = ['--rm', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
        '--label', `org.changeplane.review-request=${request.id}`,
        '--memory=512m', '--cpus=1', '--log-driver=none', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
        '--mount', `type=bind,src=${worker},dst=/worker.mjs,readonly`, '--mount', `type=volume,src=${volume},dst=/bridge`,
        '--entrypoint', 'node'];
      // The proxy accepts a key on stdin, never argv, container environment or a file.
      proxy = spawn('docker', ['run', '-i', '--name', name + '-proxy', ...common, image, '/worker.mjs', 'proxy', model],
        { env, signal, stdio: ['pipe', 'pipe', 'pipe'] });
      proxy.stdin.on('error', () => {}); proxy.stdin.end(key + '\n');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('proxy unavailable')), 15_000);
        const done = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
        proxy.once('error', done); proxy.once('exit', () => done(new Error('proxy exited')));
        proxy.stdout.once('data', chunk => done(chunk.toString().trim() === 'ready' ? null : new Error('proxy invalid')));
      });
      const child = spawn('docker', ['run', '--name', name + '-engine', ...common, '--network=none',
        '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        '--mount', `type=bind,src=${repository},dst=/repo,readonly`, '--mount', `type=bind,src=${output},dst=/output`,
        image, '/worker.mjs', 'review', model, request.binding.mergeBase, request.binding.headSha],
      { env, signal, stdio: 'ignore' });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('review timeout')); }, 330_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      const path = join(output, 'review.json'), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > REVIEW_BYTES) fail();
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch { if (signal?.aborted) throw new CollectionError('COLLECTION_CANCELLED'); throw new CollectionError(stage); }
    finally {
      for (const container of [name + '-engine', name + '-proxy']) { try { docker(['rm', '-f', container]); } catch {} }
      proxy?.kill();
      try { docker(['volume', 'rm', '-f', volume]); } catch {}
      rmSync(scratch, { recursive: true, force: true });
    }
  };
}
