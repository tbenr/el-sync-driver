const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../logger');

function capture(level) {
    const lines = [];
    const log = createLogger('scope', { level, write: line => lines.push(line), color: false });
    return { log, lines };
}

test('logger formats a line with ISO timestamp, level, scope and message', () => {
    const { log, lines } = capture('info');
    log.info('hello', 'world');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO  \[scope\] hello world$/);
});

test('logger drops messages below the configured level', () => {
    const { log, lines } = capture('info');
    log.debug('hidden');
    log.warn('shown');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /WARN  \[scope\] shown$/);
});

test('logger serializes object arguments as JSON', () => {
    const { log, lines } = capture('debug');
    log.debug('payload', { a: 1 });
    assert.match(lines[0], /DEBUG \[scope\] payload {"a":1}$/);
});

test('logger reports whether debug is enabled', () => {
    assert.equal(capture('debug').log.isDebug(), true);
    assert.equal(capture('info').log.isDebug(), false);
});

test('logger includes the underlying cause of an Error argument', () => {
    const { log, lines } = capture('info');
    log.error('poll failed:', new Error('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:5051') }));
    assert.match(lines[0], /poll failed: fetch failed \(connect ECONNREFUSED 127\.0\.0\.1:5051\)$/);
});
