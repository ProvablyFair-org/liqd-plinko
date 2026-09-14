// Bundled modules receive their original directory paths for evidence-file lookup.
const __path = require('node:path');
const __createRequire = require('node:module').createRequire;
const __cache = new Map();
function __load(id) {
  if (__cache.has(id)) return __cache.get(id).exports;
  if (!Object.hasOwn(__modules, id)) throw new Error(`Missing bundled module: ${id}`);
  const filename = __path.join(__dirname, id);
  const diskRequire = __createRequire(filename);
  const module = { exports: {} };
  __cache.set(id, module);
  const localRequire = spec => {
    if (!spec.startsWith('.')) return diskRequire(spec);
    const joined = __path.posix.normalize(__path.posix.join(__path.posix.dirname(id), spec));
    const target = [joined, joined + '.js', joined + '/index.js']
      .find(candidate => Object.hasOwn(__modules, candidate));
    return target ? __load(target) : diskRequire(spec);
  };
  __modules[id](module, module.exports, localRequire, filename, __path.dirname(filename));
  return module.exports;
}

// The unit sources use Mocha's describe/it interface and synchronous timeout settings.
// Node's built-in runner supplies assertion reporting and a nonzero failure exit status.
function __installTestGlobals() {
  const test = require('node:test');
  const context = () => ({ timeout() {}, slow() {}, retries() {} });
  const wrap = fn => typeof fn === 'function' ? function () { return fn.call(context()); } : fn;
  for (const name of ['describe', 'it']) {
    const bind = fn => (title, callback) => fn(title, wrap(callback));
    const bound = bind(test[name]);
    for (const modifier of ['skip', 'only', 'todo']) bound[modifier] = bind(test[name][modifier]);
    globalThis[name] = bound;
  }
  for (const name of ['before', 'after', 'beforeEach', 'afterEach']) {
    globalThis[name] = callback => test[name](wrap(callback));
  }
}
