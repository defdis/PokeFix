import {describe, it, expect} from 'vitest';
import {parseAcpLine, mapSessionUpdate, parsePermissionRequest, permissionResponse} from './acp';

describe('parseAcpLine', () => {
  it('parses a notification', () => {
    const msg = parseAcpLine('{"jsonrpc":"2.0","method":"session/update","params":{}}');
    expect(msg && 'method' in msg && msg.method).toBe('session/update');
  });

  it('parses a response', () => {
    const msg = parseAcpLine('{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}');
    expect(msg && 'id' in msg && msg.id).toBe(3);
  });

  it('rejects garbage', () => {
    expect(parseAcpLine('not json')).toBeNull();
    expect(parseAcpLine('{"jsonrpc":"1.0"}')).toBeNull();
    expect(parseAcpLine('')).toBeNull();
  });
});

describe('mapSessionUpdate', () => {
  it('maps agent_message_chunk with flat content', () => {
    expect(
      mapSessionUpdate({sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'hi'}})
    ).toEqual({type: 'agent-message', text: 'hi'});
  });

  it('maps agent_message_chunk with nested content blocks', () => {
    expect(
      mapSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: [
          {type: 'text', text: 'a'},
          {type: 'text', text: 'b'},
        ],
      })
    ).toEqual({type: 'agent-message', text: 'ab'});
  });

  it('maps tool_call and tool_call_update', () => {
    expect(
      mapSessionUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'read src/app.tsx',
        kind: 'read',
        status: 'pending',
      })
    ).toEqual({
      type: 'tool-call',
      id: 't1',
      title: 'read src/app.tsx',
      kind: 'read',
      status: 'pending',
    });
    expect(
      mapSessionUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [{type: 'content', content: {type: 'text', text: 'file body'}}],
      })
    ).toEqual({type: 'tool-update', id: 't1', status: 'completed', text: 'file body'});
  });

  it('maps usage_update', () => {
    expect(mapSessionUpdate({sessionUpdate: 'usage_update', used: 20259, size: 1048576})).toEqual({
      type: 'usage',
      used: 20259,
      size: 1048576,
    });
  });

  it('returns null for unknown updates', () => {
    expect(mapSessionUpdate({sessionUpdate: 'config_option_update'})).toBeNull();
    expect(mapSessionUpdate(null)).toBeNull();
  });
});

describe('permission helpers', () => {
  it('parses and round-trips a permission request', () => {
    const parsed = parsePermissionRequest({
      sessionId: 's1',
      toolCall: {title: 'Run `rm -rf dist`', kind: 'execute'},
      options: [
        {optionId: 'a', name: 'Allow once', kind: 'allow_once'},
        {optionId: 'd', name: 'Deny', kind: 'reject_once'},
      ],
    });
    expect(parsed?.title).toBe('Run `rm -rf dist`');
    expect(parsed?.options).toHaveLength(2);
    expect(permissionResponse('a')).toEqual({outcome: {outcome: 'selected', optionId: 'a'}});
    expect(permissionResponse(null)).toEqual({outcome: {outcome: 'cancelled'}});
  });

  it('rejects malformed requests', () => {
    expect(parsePermissionRequest({})).toBeNull();
    expect(parsePermissionRequest({options: []})).toBeNull();
  });
});
