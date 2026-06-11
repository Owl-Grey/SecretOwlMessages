import { useState } from 'react';

export default function MessageInput({ disabled, onSend, onAttach, attachmentStatus }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const value = text.trim();
    if (!value || sending || disabled) return;
    setText('');
    setSending(true);
    try {
      await onSend(value);
    } finally {
      setSending(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    await handleSend();
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <form className="message-input" onSubmit={submit}>
      <label className="attach-button">
        Attach
        <input
          type="file"
          hidden
          disabled={disabled || sending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onAttach?.(file);
          }}
        />
      </label>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type a message"
      />
      <button disabled={disabled || sending || !text.trim()}>Send</button>
      {attachmentStatus && <small className="attachment-status">{attachmentStatus}</small>}
    </form>
  );
}
