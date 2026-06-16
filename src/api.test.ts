import { describe, expect, it } from 'vitest';
import { messageText } from './api';

describe('messageText', () => {
  it('returns plain string text', () => {
    expect(messageText({ text: 'hello' })).toBe('hello');
  });

  it('extracts the production encrypted text value shape', () => {
    expect(messageText({ text: { value: '[模板] *716386* 是你的验证码。', redacted_value: '[模********' } })).toBe('[模板] *716386* 是你的验证码。');
  });

  it('extracts common nested text fields', () => {
    expect(messageText({ text: { extendedTextMessage: { text: 'nested body' } } })).toBe('nested body');
    expect(messageText({ text: { conversation: 'conversation body' } })).toBe('conversation body');
  });

  it('does not stringify unknown objects', () => {
    expect(messageText({ text: { unknown: { value: {} } } })).toBe('');
  });
});
