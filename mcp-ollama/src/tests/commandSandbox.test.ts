import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommandSandbox } from '../tools/CommandSandbox.js';

describe('CommandSandbox.buildArgv', () => {
  const opts = { cwd: '/work', writableRoots: ['/work'], allowNetwork: false };

  it('wraps with bwrap and disables network by default', () => {
    const built = CommandSandbox.buildArgv('bwrap', 'node', ['build.js'], opts);
    assert.equal(built.command, 'bwrap');
    assert.ok(built.args.includes('--unshare-net'), 'network should be unshared');
    assert.ok(built.args.includes('--ro-bind'));
    // workspace bound read-write
    const bindIdx = built.args.indexOf('--bind');
    assert.equal(built.args[bindIdx + 1], '/work');
    assert.equal(built.args[bindIdx + 2], '/work');
    // command after the -- separator
    const sep = built.args.indexOf('--', bindIdx);
    assert.deepEqual(built.args.slice(sep + 1), ['node', 'build.js']);
  });

  it('keeps network when explicitly allowed (bwrap)', () => {
    const built = CommandSandbox.buildArgv('bwrap', 'node', [], { ...opts, allowNetwork: true });
    assert.ok(!built.args.includes('--unshare-net'));
  });

  it('wraps with firejail and disables network by default', () => {
    const built = CommandSandbox.buildArgv('firejail', 'npm', ['test'], opts);
    assert.equal(built.command, 'firejail');
    assert.ok(built.args.includes('--net=none'));
    assert.ok(built.args.includes('--read-only=/'));
    assert.ok(built.args.includes('--read-write=/work'));
    assert.deepEqual(built.args.slice(-2), ['npm', 'test']);
  });

  it('wraps with sandbox-exec and emits a deny-network profile', () => {
    const built = CommandSandbox.buildArgv('sandbox-exec', 'go', ['build'], opts);
    assert.equal(built.command, 'sandbox-exec');
    assert.equal(built.args[0], '-p');
    assert.match(built.args[1], /\(deny network\*\)/);
    assert.match(built.args[1], /subpath "\/work"/);
    assert.deepEqual(built.args.slice(2), ['go', 'build']);
  });

  it('emits an allow-network profile for sandbox-exec when permitted', () => {
    const built = CommandSandbox.buildArgv('sandbox-exec', 'go', [], { ...opts, allowNetwork: true });
    assert.match(built.args[1], /\(allow network\*\)/);
  });

  it('returns the command unchanged when no launcher is available', () => {
    const built = CommandSandbox.buildArgv('none', 'node', ['x'], opts);
    assert.equal(built.command, 'node');
    assert.deepEqual(built.args, ['x']);
  });
});

describe('CommandSandbox env toggles', () => {
  it('isEnabled reflects MCP_OLLAMA_OS_SANDBOX', () => {
    const prev = process.env.MCP_OLLAMA_OS_SANDBOX;
    process.env.MCP_OLLAMA_OS_SANDBOX = '1';
    assert.equal(CommandSandbox.isEnabled(), true);
    process.env.MCP_OLLAMA_OS_SANDBOX = '';
    assert.equal(CommandSandbox.isEnabled(), false);
    if (prev === undefined) delete process.env.MCP_OLLAMA_OS_SANDBOX;
    else process.env.MCP_OLLAMA_OS_SANDBOX = prev;
  });
});
