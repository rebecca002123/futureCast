// Metro resolves relative imports without file extensions; plain Node does
// not. This loader adds the '.js' back so the pure modules in src/ can be
// unit-tested with `npm test`, no bundler and no simulator involved.
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { register } from 'node:module';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
    const url = new URL(`${specifier}.js`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
}

// `node --import ./tools/test-loader.mjs` runs this file in the main thread
// first, where it registers itself as a module loader hook.
if (!process.env.SHIFT_PAY_LOADER) {
  process.env.SHIFT_PAY_LOADER = '1';
  register('./test-loader.mjs', import.meta.url);
}
