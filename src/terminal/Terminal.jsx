import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VFS } from './vfs';
import { executeCommand, commands } from './commands';

const ANSI_COLORS = {
  '31': '#f7768e',
  '32': '#9ece6a',
  '33': '#e0af68',
  '34': '#7aa2f7',
  '35': '#bb9af7',
  '36': '#7dcfff',
  '37': '#c0caf5',
  '7': null,
};

function renderAnsi(text) {
  if (typeof text !== 'string') return text;
  const parts = [];
  const regex = /\x1b\[(\d+)m/g;
  let lastIndex = 0;
  let currentColor = null;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), color: currentColor });
    }
    const code = match[1];
    if (code === '0' || code === '7') currentColor = null;
    else if (ANSI_COLORS[code]) currentColor = ANSI_COLORS[code];
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), color: currentColor });
  }

  if (parts.length === 0) return text;
  return parts.map((part, i) =>
    part.color
      ? <span key={i} style={{ color: part.color }}>{part.text}</span>
      : <span key={i}>{part.text}</span>
  );
}

function Prompt({ path }) {
  return (
    <span className="whitespace-nowrap mr-2 shrink-0 select-none">
      <span className="text-[#9ece6a]">user@linux-terminal</span>
      <span className="text-[#c0caf5]">:</span>
      <span className="text-[#7aa2f7]">{path}</span>
      <span className="text-[#c0caf5]">$&nbsp;</span>
    </span>
  );
}

export default function Terminal() {
  const [lines, setLines] = useState([
    { type: 'output', content: 'Linux Terminal 1.0\nType "help" to see all available commands.\n' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const vfsRef = useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  if (!vfsRef.current) vfsRef.current = new VFS();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, input]);

  const getPromptPath = useCallback(() => {
    return vfsRef.current.getDisplayPath();
  }, []);

  const runCommand = useCallback(
    (cmd) => {
      const trimmed = cmd.trim();
      const promptPath = getPromptPath();

      if (trimmed.toLowerCase() === 'clear' || trimmed === '__CLEAR__') {
        setLines([]);
        if (trimmed) setHistory((prev) => [...prev, trimmed]);
        setHistoryIndex(-1);
        return;
      }

      const newLines = [{ type: 'input', content: trimmed, path: promptPath }];

      if (trimmed) {
        const newHistory = [...history, trimmed];
        const output = executeCommand(vfsRef.current, trimmed, newHistory);
        if (output === '__CLEAR__') {
          setLines([]);
          setHistory(newHistory);
          setHistoryIndex(-1);
          return;
        }
        if (output) {
          newLines.push({ type: 'output', content: output });
        }
        setHistory(newHistory);
      }

      setLines((prev) => [...prev, ...newLines]);
    },
    [history, getPromptPath]
  );

  const handleTabComplete = useCallback(() => {
    const parts = input.split(' ');
    const last = parts[parts.length - 1];

    // Command completion
    if (parts.length === 1) {
      const matches = Object.keys(commands).filter((c) => c.startsWith(last));
      if (matches.length === 1) {
        setInput(matches[0] + ' ');
      } else if (matches.length > 1) {
        const promptPath = getPromptPath();
        setLines((prev) => [
          ...prev,
          { type: 'input', content: input, path: promptPath },
          { type: 'output', content: matches.join('  ') },
        ]);
      }
      return;
    }

    // Path completion
    const slashIdx = last.lastIndexOf('/');
    const dirPart = slashIdx >= 0 ? last.substring(0, slashIdx + 1) : '';
    const filePart = slashIdx >= 0 ? last.substring(slashIdx + 1) : last;
    const basePath = dirPart ? vfsRef.current.resolvePath(dirPart) : vfsRef.current.cwd;
    const node = vfsRef.current.getNode(basePath);

    if (node && node.type === 'dir') {
      const matches = Object.keys(node.children).filter((c) => c.startsWith(filePart));
      if (matches.length === 1) {
        const child = node.children[matches[0]];
        parts[parts.length - 1] = dirPart + matches[0] + (child.type === 'dir' ? '/' : '');
        setInput(parts.join(' '));
      } else if (matches.length > 1) {
        const promptPath = getPromptPath();
        setLines((prev) => [
          ...prev,
          { type: 'input', content: input, path: promptPath },
          { type: 'output', content: matches.join('  ') },
        ]);
      }
    }
  }, [input, getPromptPath]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runCommand(input);
        setInput('');
        setHistoryIndex(-1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (history.length > 0) {
          const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
          setHistoryIndex(newIdx);
          setInput(history[newIdx]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex !== -1) {
          const newIdx = historyIndex + 1;
          if (newIdx >= history.length) {
            setHistoryIndex(-1);
            setInput('');
          } else {
            setHistoryIndex(newIdx);
            setInput(history[newIdx]);
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleTabComplete();
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        setLines([]);
      } else if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        const promptPath = getPromptPath();
        setLines((prev) => [...prev, { type: 'input', content: input + '^C', path: promptPath }]);
        setInput('');
        setHistoryIndex(-1);
      }
    },
    [input, history, historyIndex, runCommand, handleTabComplete, getPromptPath]
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] md:flex md:items-center md:justify-center md:p-8">
      <div className="w-full h-screen md:h-[85vh] md:max-w-5xl md:rounded-xl overflow-hidden bg-[#1a1b26] md:shadow-2xl md:border md:border-[#2a2b3d] flex flex-col">
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-4 py-3 bg-[#16171f] border-b border-[#2a2b3d] shrink-0">
          <div className="w-3 h-3 rounded-full bg-[#f7768e]"></div>
          <div className="w-3 h-3 rounded-full bg-[#e0af68]"></div>
          <div className="w-3 h-3 rounded-full bg-[#9ece6a]"></div>
          <div className="flex-1 text-center text-[#565f89] text-xs font-mono">user@linux-terminal: ~</div>
        </div>

        {/* Terminal body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((line, i) =>
            line.type === 'input' ? (
              <div key={i} className="flex items-baseline flex-wrap">
                <Prompt path={line.path} />
                <span className="text-[#c0caf5] whitespace-pre-wrap break-all">{line.content}</span>
              </div>
            ) : (
              <div key={i} className="text-[#a9b1d6] whitespace-pre-wrap break-all mb-1">
                {renderAnsi(line.content)}
              </div>
            )
          )}

          {/* Active input line */}
          <div className="flex items-baseline">
            <Prompt path={getPromptPath()} />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-[#c0caf5] font-mono text-sm caret-[#c0caf5]"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
              aria-label="Terminal input"
            />
          </div>
        </div>
      </div>
    </div>
  );
}