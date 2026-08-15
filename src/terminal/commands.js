import { cloneNode } from './vfs';

// ── Helpers ──────────────────────────────────────────────

function parseFlags(args) {
  const flags = [];
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (const c of arg.slice(1)) flags.push(c);
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function parseTokens(input) {
  const tokens = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === quoteChar) inQuotes = false;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
    } else if (char === ' ' || char === '\t') {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function globToRegex(glob) {
  const regex = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + regex + '$');
}

function formatDate() {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Commands ─────────────────────────────────────────────

export const commands = {
  ls: {
    desc: 'List directory contents',
    usage: 'ls [-l] [-a] [path]',
    fn: (vfs, args) => {
      const { flags, positional } = parseFlags(args);
      const showAll = flags.includes('a');
      const longFormat = flags.includes('l');
      const target = positional[0] || '.';
      const parts = vfs.resolvePath(target);
      const node = vfs.getNode(parts);

      if (!node) return `\x1b[31mls: cannot access '${target}': No such file or directory\x1b[0m`;
      if (node.type === 'file') return vfs.pathToString(parts);

      let entries = Object.entries(node.children);
      if (!showAll) entries = entries.filter(([name]) => !name.startsWith('.'));
      entries.sort(([a], [b]) => a.localeCompare(b));

      if (entries.length === 0) return '';

      if (longFormat) {
        return entries
          .map(([name, child]) => {
            const perms = child.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
            const size = child.type === 'file' ? child.content.length : 4096;
            const colored = child.type === 'dir'
              ? `\x1b[34m${name}\x1b[0m`
              : name.endsWith('.sh')
                ? `\x1b[32m${name}\x1b[0m`
                : name;
            return `${perms} 1 ${vfs.user} ${vfs.user} ${String(size).padStart(8)} ${formatDate()} ${colored}`;
          })
          .join('\n');
      }

      return entries
        .map(([name, child]) => {
          if (child.type === 'dir') return `\x1b[34m${name}\x1b[0m/`;
          if (name.endsWith('.sh')) return `\x1b[32m${name}\x1b[0m`;
          if (name.endsWith('.md')) return `\x1b[36m${name}\x1b[0m`;
          return name;
        })
        .join('  ');
    },
  },

  cd: {
    desc: 'Change directory',
    usage: 'cd [path]',
    fn: (vfs, args) => {
      const target = args[0] || '~';
      if (target === '-') {
        if (vfs.prevCwd) { const tmp = vfs.cwd; vfs.cwd = vfs.prevCwd; vfs.prevCwd = tmp; return ''; }
        return `\x1b[31mbash: cd: OLDPWD not set\x1b[0m`;
      }
      const parts = vfs.resolvePath(target);
      const node = vfs.getNode(parts);
      if (!node) return `\x1b[31mbash: cd: ${target}: No such file or directory\x1b[0m`;
      if (node.type !== 'dir') return `\x1b[31mbash: cd: ${target}: Not a directory\x1b[0m`;
      vfs.prevCwd = [...vfs.cwd];
      vfs.cwd = parts;
      return '';
    },
  },

  pwd: {
    desc: 'Print working directory',
    usage: 'pwd',
    fn: (vfs) => vfs.getFullPath(),
  },

  cat: {
    desc: 'Display file contents',
    usage: 'cat <file> [file...]',
    fn: (vfs, args) => {
      if (args.length === 0) return '\x1b[31mcat: missing file operand\x1b[0m';
      const outputs = [];
      for (const arg of args) {
        const parts = vfs.resolvePath(arg);
        const node = vfs.getNode(parts);
        if (!node) { outputs.push(`\x1b[31mcat: ${arg}: No such file or directory\x1b[0m`); continue; }
        if (node.type === 'dir') { outputs.push(`\x1b[31mcat: ${arg}: Is a directory\x1b[0m`); continue; }
        outputs.push(node.content);
      }
      return outputs.join('\n');
    },
  },

  echo: {
    desc: 'Print text',
    usage: 'echo <text> [> file]',
    fn: (vfs, args) => {
      let text = args.join(' ');
      text = text
        .replace(/\$USER/g, vfs.user)
        .replace(/\$HOME/g, '/home/' + vfs.user)
        .replace(/\$PWD/g, vfs.getFullPath())
        .replace(/\$HOSTNAME/g, vfs.host)
        .replace(/\$SHELL/g, '/bin/bash')
        .replace(/\$PATH/g, '/usr/local/bin:/usr/bin:/bin');
      return text;
    },
  },

  mkdir: {
    desc: 'Create directory',
    usage: 'mkdir [-p] <dir> [dir...]',
    fn: (vfs, args) => {
      const { flags, positional } = parseFlags(args);
      const parents = flags.includes('p');
      if (positional.length === 0) return '\x1b[31mmkdir: missing operand\x1b[0m';
      const errors = [];
      for (const dir of positional) {
        const parts = vfs.resolvePath(dir);
        if (parents) {
          let current = [];
          for (const part of parts) {
            current.push(part);
            const node = vfs.getNode(current);
            if (!node) vfs.createNode(current, 'dir');
            else if (node.type !== 'dir') { errors.push(`\x1b[31mmkdir: cannot create directory '${dir}': File exists\x1b[0m`); break; }
          }
        } else {
          if (vfs.getNode(parts)) errors.push(`\x1b[31mmkdir: cannot create directory '${dir}': File exists\x1b[0m`);
          else if (!vfs.createNode(parts, 'dir')) errors.push(`\x1b[31mmkdir: cannot create directory '${dir}': No such file or directory\x1b[0m`);
        }
      }
      return errors.join('\n');
    },
  },

  touch: {
    desc: 'Create empty file or update timestamp',
    usage: 'touch <file> [file...]',
    fn: (vfs, args) => {
      if (args.length === 0) return '\x1b[31mtouch: missing file operand\x1b[0m';
      const errors = [];
      for (const file of args) {
        const parts = vfs.resolvePath(file);
        const node = vfs.getNode(parts);
        if (node) continue; // update timestamp (no-op)
        if (!vfs.createNode(parts, 'file')) errors.push(`\x1b[31mtouch: cannot touch '${file}': No such file or directory\x1b[0m`);
      }
      return errors.join('\n');
    },
  },

  rm: {
    desc: 'Remove files or directories',
    usage: 'rm [-r] [-f] <path> [path...]',
    fn: (vfs, args) => {
      const { flags, positional } = parseFlags(args);
      const recursive = flags.includes('r') || flags.includes('R');
      const force = flags.includes('f');
      if (positional.length === 0) return '\x1b[31mrm: missing operand\x1b[0m';
      const errors = [];
      for (const path of positional) {
        const parts = vfs.resolvePath(path);
        const node = vfs.getNode(parts);
        if (!node) { if (!force) errors.push(`\x1b[31mrm: cannot remove '${path}': No such file or directory\x1b[0m`); continue; }
        if (node.type === 'dir' && !recursive) { errors.push(`\x1b[31mrm: cannot remove '${path}': Is a directory\x1b[0m`); continue; }
        vfs.removeNode(parts);
      }
      return errors.join('\n');
    },
  },

  rmdir: {
    desc: 'Remove empty directory',
    usage: 'rmdir <dir> [dir...]',
    fn: (vfs, args) => {
      if (args.length === 0) return '\x1b[31mrmdir: missing operand\x1b[0m';
      const errors = [];
      for (const dir of args) {
        const parts = vfs.resolvePath(dir);
        const node = vfs.getNode(parts);
        if (!node) { errors.push(`\x1b[31mrmdir: failed to remove '${dir}': No such file or directory\x1b[0m`); continue; }
        if (node.type !== 'dir') { errors.push(`\x1b[31mrmdir: failed to remove '${dir}': Not a directory\x1b[0m`); continue; }
        if (Object.keys(node.children).length > 0) { errors.push(`\x1b[31mrmdir: failed to remove '${dir}': Directory not empty\x1b[0m`); continue; }
        vfs.removeNode(parts);
      }
      return errors.join('\n');
    },
  },

  mv: {
    desc: 'Move or rename files',
    usage: 'mv <source> <destination>',
    fn: (vfs, args) => {
      if (args.length < 2) return '\x1b[31mmv: missing destination file operand\x1b[0m';
      const srcParts = vfs.resolvePath(args[0]);
      const srcNode = vfs.getNode(srcParts);
      if (!srcNode) return `\x1b[31mmv: cannot stat '${args[0]}': No such file or directory\x1b[0m`;
      const destParts = vfs.resolvePath(args[1]);
      const destNode = vfs.getNode(destParts);
      let targetParts;
      if (destNode && destNode.type === 'dir') {
        targetParts = [...destParts, srcParts[srcParts.length - 1]];
      } else if (!destNode) {
        targetParts = destParts;
      } else {
        vfs.removeNode(destParts);
        targetParts = destParts;
      }
      const targetParent = vfs.getParent(targetParts);
      if (!targetParent || targetParent.type !== 'dir')
        return `\x1b[31mmv: cannot move to '${args[1]}': No such file or directory\x1b[0m`;
      targetParent.children[targetParts[targetParts.length - 1]] = srcNode;
      vfs.removeNode(srcParts);
      return '';
    },
  },

  cp: {
    desc: 'Copy files or directories',
    usage: 'cp [-r] <source> <destination>',
    fn: (vfs, args) => {
      const { flags, positional } = parseFlags(args);
      const recursive = flags.includes('r') || flags.includes('R');
      if (positional.length < 2) return '\x1b[31mcp: missing destination file operand\x1b[0m';
      const srcParts = vfs.resolvePath(positional[0]);
      const srcNode = vfs.getNode(srcParts);
      if (!srcNode) return `\x1b[31mcp: cannot stat '${positional[0]}': No such file or directory\x1b[0m`;
      if (srcNode.type === 'dir' && !recursive)
        return `\x1b[31mcp: -r not specified; omitting directory '${positional[0]}'\x1b[0m`;
      const destParts = vfs.resolvePath(positional[1]);
      const destNode = vfs.getNode(destParts);
      let targetParts;
      if (destNode && destNode.type === 'dir') {
        targetParts = [...destParts, srcParts[srcParts.length - 1]];
      } else {
        targetParts = destParts;
      }
      const targetParent = vfs.getParent(targetParts);
      if (!targetParent) return `\x1b[31mcp: cannot copy to '${positional[1]}': No such file or directory\x1b[0m`;
      targetParent.children[targetParts[targetParts.length - 1]] = cloneNode(srcNode);
      return '';
    },
  },

  clear: {
    desc: 'Clear the terminal screen',
    usage: 'clear',
    fn: () => '__CLEAR__',
  },

  whoami: {
    desc: 'Print current user',
    usage: 'whoami',
    fn: (vfs) => vfs.user,
  },

  date: {
    desc: 'Print current date and time',
    usage: 'date',
    fn: () => new Date().toString(),
  },

  cal: {
    desc: 'Display a calendar',
    usage: 'cal',
    fn: () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const today = now.getDate();
      let output = `${monthNames[month]} ${year}\nSu Mo Tu We Th Fr Sa\n`;
      let week = '';
      for (let i = 0; i < firstDay; i++) week += '   ';
      for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = String(d).padStart(2, ' ');
        week += (d === today ? `\x1b[7m${dayStr}\x1b[0m` : dayStr) + ' ';
        if ((firstDay + d) % 7 === 0) { output += week.trimEnd() + '\n'; week = ''; }
      }
      if (week.trim()) output += week.trimEnd();
      return output;
    },
  },

  uname: {
    desc: 'Print system information',
    usage: 'uname [-a]',
    fn: (vfs, args) => {
      if (args.includes('-a')) return `Linux ${vfs.host} 6.1.0-web #1 SMP PREEMPT_DYNAMIC ${new Date().toISOString()} x86_64 GNU/Linux`;
      return 'Linux';
    },
  },

  uptime: {
    desc: 'Show system uptime',
    usage: 'uptime',
    fn: () => {
      const seconds = Math.floor(performance.now() / 1000);
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const time = new Date().toLocaleTimeString();
      return ` ${time} up ${hours}:${String(mins).padStart(2, '0')}, 1 user, load average: 0.00, 0.00, 0.00`;
    },
  },

  head: {
    desc: 'Display first lines of a file',
    usage: 'head [-n N] <file>',
    fn: (vfs, args) => {
      let n = 10;
      const nIdx = args.indexOf('-n');
      if (nIdx >= 0) { n = parseInt(args[nIdx + 1]) || 10; args = args.filter((_, i) => i !== nIdx && i !== nIdx + 1); }
      const file = args.find((a) => !a.startsWith('-'));
      if (!file) return '\x1b[31mhead: missing file operand\x1b[0m';
      const parts = vfs.resolvePath(file);
      const node = vfs.getNode(parts);
      if (!node || node.type !== 'file') return `\x1b[31mhead: ${file}: No such file or directory\x1b[0m`;
      return node.content.split('\n').slice(0, n).join('\n');
    },
  },

  tail: {
    desc: 'Display last lines of a file',
    usage: 'tail [-n N] <file>',
    fn: (vfs, args) => {
      let n = 10;
      const nIdx = args.indexOf('-n');
      if (nIdx >= 0) { n = parseInt(args[nIdx + 1]) || 10; args = args.filter((_, i) => i !== nIdx && i !== nIdx + 1); }
      const file = args.find((a) => !a.startsWith('-'));
      if (!file) return '\x1b[31mtail: missing file operand\x1b[0m';
      const parts = vfs.resolvePath(file);
      const node = vfs.getNode(parts);
      if (!node || node.type !== 'file') return `\x1b[31mtail: ${file}: No such file or directory\x1b[0m`;
      const lines = node.content.split('\n');
      return lines.slice(Math.max(0, lines.length - n)).join('\n');
    },
  },

  wc: {
    desc: 'Count lines, words, and characters',
    usage: 'wc <file>',
    fn: (vfs, args) => {
      if (!args[0]) return '\x1b[31mwc: missing file operand\x1b[0m';
      const parts = vfs.resolvePath(args[0]);
      const node = vfs.getNode(parts);
      if (!node || node.type !== 'file') return `\x1b[31mwc: ${args[0]}: No such file or directory\x1b[0m`;
      const content = node.content;
      const lines = content.split('\n').length;
      const words = content.split(/\s+/).filter(Boolean).length;
      const chars = content.length;
      return `${String(lines).padStart(8)} ${String(words).padStart(7)} ${String(chars).padStart(8)} ${args[0]}`;
    },
  },

  grep: {
    desc: 'Search for text in files',
    usage: 'grep <pattern> <file> [file...]',
    fn: (vfs, args) => {
      if (args.length < 2) return '\x1b[31mgrep: usage: grep PATTERN FILE\x1b[0m';
      const pattern = args[0];
      const files = args.slice(1);
      const outputs = [];
      for (const file of files) {
        const parts = vfs.resolvePath(file);
        const node = vfs.getNode(parts);
        if (!node || node.type !== 'file') { outputs.push(`\x1b[31mgrep: ${file}: No such file or directory\x1b[0m`); continue; }
        const lines = node.content.split('\n');
        const matches = lines.filter((l) => l.includes(pattern));
        if (matches.length > 0) {
          const prefix = files.length > 1 ? file + ':' : '';
          outputs.push(matches.map((l) => prefix + l).join('\n'));
        }
      }
      return outputs.join('\n');
    },
  },

  find: {
    desc: 'Find files in a directory tree',
    usage: 'find <path> [-name pattern]',
    fn: (vfs, args) => {
      const nameIdx = args.indexOf('-name');
      const pattern = nameIdx >= 0 ? args[nameIdx + 1] : null;
      const startPath = args.find((a) => !a.startsWith('-') && a !== pattern) || '.';
      const parts = vfs.resolvePath(startPath);
      const node = vfs.getNode(parts);
      if (!node) return `\x1b[31mfind: '${startPath}': No such file or directory\x1b[0m`;
      const results = [];
      function traverse(node, path) {
        const name = path.split('/').pop() || path;
        if (!pattern || name.match(globToRegex(pattern))) results.push(path || '/');
        if (node.type === 'dir') {
          for (const [childName, child] of Object.entries(node.children)) {
            traverse(child, path + '/' + childName);
          }
        }
      }
      const startFull = vfs.pathToString(parts);
      traverse(node, startFull);
      return results.join('\n');
    },
  },

  tree: {
    desc: 'Display directory tree',
    usage: 'tree [path]',
    fn: (vfs, args) => {
      const target = args[0] || '.';
      const parts = vfs.resolvePath(target);
      const node = vfs.getNode(parts);
      if (!node) return `\x1b[31mtree: ${target}: No such file or directory\x1b[0m`;
      if (node.type === 'file') return vfs.pathToString(parts);
      const lines = [vfs.pathToString(parts)];
      let dirCount = 0, fileCount = 0;
      function traverse(node, prefix) {
        const entries = Object.entries(node.children)
          .filter(([name]) => true)
          .sort(([a], [b]) => a.localeCompare(b));
        entries.forEach(([name, child], i) => {
          const isLast = i === entries.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const colored = child.type === 'dir' ? `\x1b[34m${name}\x1b[0m` : name;
          lines.push(prefix + connector + colored);
          if (child.type === 'dir') { dirCount++; traverse(child, prefix + (isLast ? '    ' : '│   ')); }
          else fileCount++;
        });
      }
      traverse(node, '');
      dirCount++;
      lines.push(`\n${dirCount} directories, ${fileCount} files`);
      return lines.join('\n');
    },
  },

  history: {
    desc: 'Show command history',
    usage: 'history',
    fn: (vfs, args, history) => {
      if (!history || history.length === 0) return '';
      return history.map((cmd, i) => `${String(i + 1).padStart(5)}  ${cmd}`).join('\n');
    },
  },

  help: {
    desc: 'Show available commands',
    usage: 'help',
    fn: () => {
      const list = Object.entries(commands)
        .map(([name, cmd]) => `  \x1b[32m${name.padEnd(12)}\x1b[0m ${cmd.desc}`)
        .join('\n');
      return `Available commands:\n\n${list}\n\nType 'man <command>' for detailed help.\nUse Tab for autocomplete, Up/Down for history.`;
    },
  },

  man: {
    desc: 'Display manual for a command',
    usage: 'man <command>',
    fn: (vfs, args) => {
      if (!args[0]) return 'What manual page do you want?';
      if (!commands[args[0]]) return `\x1b[31mNo manual entry for ${args[0]}\x1b[0m`;
      const cmd = commands[args[0]];
      return `${args[0].toUpperCase()}(1)          User Commands          ${args[0].toUpperCase()}(1)

NAME
    ${args[0]} - ${cmd.desc}

SYNOPSIS
    ${cmd.usage}

DESCRIPTION
    ${cmd.desc}`;
    },
  },

  which: {
    desc: 'Locate a command',
    usage: 'which <command>',
    fn: (vfs, args) => {
      if (!args[0]) return '\x1b[31mwhich: no command specified\x1b[0m';
      if (commands[args[0]]) return `/usr/bin/${args[0]}`;
      return `\x1b[31mwhich: no ${args[0]} in (/usr/local/bin:/usr/bin:/bin)\x1b[0m`;
    },
  },

  ps: {
    desc: 'List running processes',
    usage: 'ps',
    fn: (vfs) => {
      return `  PID TTY          TIME CMD\n    1 ?        00:00:01 init\n   42 pts/0    00:00:00 bash\n  ${Math.floor(Math.random() * 900 + 100)} pts/0    00:00:00 ps`;
    },
  },

  neofetch: {
    desc: 'Display system info with ASCII art',
    usage: 'neofetch',
    fn: (vfs) => {
      const seconds = Math.floor(performance.now() / 1000);
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const art = [
        '       _____       ',
        '      /     \\      ',
        '     | () () |     ',
        '      \\  ^  /      ',
        '       |||||       ',
        '       |||||       ',
      ];
      const info = [
        `\x1b[32m${vfs.user}\x1b[0m@\x1b[32m${vfs.host}\x1b[0m`,
        '-----------------',
        `\x1b[36mOS\x1b[0m: Linux Terminal 1.0`,
        `\x1b[36mHost\x1b[0m: Web Browser`,
        `\x1b[36mKernel\x1b[0m: 6.1.0-web`,
        `\x1b[36mUptime\x1b[0m: ${hours}h ${mins}m`,
        `\x1b[36mPackages\x1b[0m: ${Object.keys(commands).length} (builtin)`,
        `\x1b[36mShell\x1b[0m: websh 1.0`,
        `\x1b[36mTerminal\x1b[0m: Browser`,
        `\x1b[36mCPU\x1b[0m: JavaScript Engine`,
        `\x1b[36mMemory\x1b[0m: ${(performance.memory ? Math.floor(performance.memory.usedJSHeapSize / 1048576) : Math.floor(Math.random() * 200 + 100))}MiB`,
      ];
      const maxLines = Math.max(art.length, info.length);
      let output = '';
      for (let i = 0; i < maxLines; i++) {
        const artLine = art[i] || ' '.repeat(20);
        const infoLine = info[i] || '';
        output += artLine + '  ' + infoLine + '\n';
      }
      return output.trimEnd();
    },
  },

  cowsay: {
    desc: 'A cow says your message',
    usage: 'cowsay <message>',
    fn: (vfs, args) => {
      const text = args.join(' ') || 'Moo!';
      const len = Math.max(text.length, 1);
      const top = ' ' + '_'.repeat(len + 2);
      const bottom = ' ' + '-'.repeat(len + 2);
      return `${top}\n< ${text} >\n${bottom}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||`;
    },
  },

  fortune: {
    desc: 'Print a random fortune',
    usage: 'fortune',
    fn: () => {
      const fortunes = [
        'The early bird gets the worm, but the second mouse gets the cheese.',
        "If at first you don't succeed, call it version 1.0.",
        'There are 10 types of people: those who understand binary and those who don\'t.',
        "A SQL query goes into a bar, walks up to two tables and asks: 'Can I join you?'",
        'Why do programmers prefer dark mode? Because light attracts bugs.',
        "There's no place like 127.0.0.1.",
        'To err is human. To debug is superhuman.',
        'Software is like sex: it\'s better when it\'s free. — Linus Torvalds',
        'The best thing about UNIX is its many standards. — Tanenbaum',
        'Talk is cheap. Show me the code. — Linus Torvalds',
        'There are two hard things in computer science: cache invalidation, naming things, and off-by-one errors.',
        'Code is like humor. When you have to explain it, it\'s bad. — Cory House',
      ];
      return fortunes[Math.floor(Math.random() * fortunes.length)];
    },
  },

  seq: {
    desc: 'Print a sequence of numbers',
    usage: 'seq [start] [stop] or seq [start] [step] [stop]',
    fn: (vfs, args) => {
      const nums = args.map(Number);
      let start = 1, step = 1, end = 1;
      if (nums.length === 1) { end = nums[0]; }
      else if (nums.length === 2) { [start, end] = nums; }
      else if (nums.length === 3) { [start, step, end] = nums; }
      if (nums.some(isNaN)) return '\x1b[31mseq: invalid argument\x1b[0m';
      const results = [];
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) results.push(i);
      return results.join('\n');
    },
  },

  tac: {
    desc: 'Reverse lines of a file',
    usage: 'tac <file>',
    fn: (vfs, args) => {
      if (!args[0]) return '\x1b[31mtac: missing file operand\x1b[0m';
      const parts = vfs.resolvePath(args[0]);
      const node = vfs.getNode(parts);
      if (!node || node.type !== 'file') return `\x1b[31mtac: ${args[0]}: No such file or directory\x1b[0m`;
      return node.content.split('\n').reverse().join('\n');
    },
  },

  sort: {
    desc: 'Sort lines of a file',
    usage: 'sort <file>',
    fn: (vfs, args) => {
      if (!args[0]) return '\x1b[31msort: missing file operand\x1b[0m';
      const parts = vfs.resolvePath(args[0]);
      const node = vfs.getNode(parts);
      if (!node || node.type !== 'file') return `\x1b[31msort: ${args[0]}: No such file or directory\x1b[0m`;
      return node.content.split('\n').sort().join('\n');
    },
  },

  rev: {
    desc: 'Reverse characters of each line',
    usage: 'rev <file>',
    fn: (vfs, args) => {
      if (!args[0]) return '\x1b[31mrev: missing file operand\x1b[0m';
      const parts = vfs.resolvePath(args[0]);
      const node = vfs.getNode(parts);
      if (!node || node.type !== 'file') return `\x1b[31mrev: ${args[0]}: No such file or directory\x1b[0m`;
      return node.content.split('\n').map((l) => l.split('').reverse().join('')).join('\n');
    },
  },

  basename: {
    desc: 'Strip directory and suffix from path',
    usage: 'basename <path>',
    fn: (vfs, args) => {
      if (!args[0]) return '';
      const parts = vfs.resolvePath(args[0]);
      return parts[parts.length - 1] || '/';
    },
  },

  dirname: {
    desc: 'Strip last component from path',
    usage: 'dirname <path>',
    fn: (vfs, args) => {
      if (!args[0]) return '.';
      const parts = vfs.resolvePath(args[0]);
      parts.pop();
      return parts.length === 0 ? '/' : '/' + parts.join('/');
    },
  },

  realpath: {
    desc: 'Resolve absolute path',
    usage: 'realpath <path>',
    fn: (vfs, args) => {
      if (!args[0]) return '';
      return vfs.pathToString(vfs.resolvePath(args[0]));
    },
  },

  sudo: {
    desc: 'Execute a command as superuser',
    usage: 'sudo <command>',
    fn: (vfs) => `\x1b[31m${vfs.user} is not in the sudoers file. This incident will be reported.\x1b[0m`,
  },

  apt: {
    desc: 'Package manager (simulated)',
    usage: 'apt [install|update|upgrade] [package]',
    fn: (vfs, args) => {
      const sub = args[0];
      if (sub === 'install') {
        const pkg = args.slice(1).join(' ') || '<package>';
        return `Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nE: Unable to locate package ${pkg}`;
      }
      if (sub === 'update') return 'Hit:1 https://web.terminal/repos stable InRelease\nReading package lists... Done';
      if (sub === 'upgrade') return 'Reading package lists... Done\nBuilding dependency tree... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.';
      return 'apt 1.0 (web)\nUsage: apt [install|update|upgrade] [package]';
    },
  },

  exit: {
    desc: 'Exit the shell',
    usage: 'exit',
    fn: () => 'logout\n\n(Just kidding — you can\'t close a web terminal with a command!)',
  },
};

// ── Executor ─────────────────────────────────────────────

export function executeCommand(vfs, input, history) {
  // Handle multiple commands separated by ;
  const cmds = input.split(';').map((c) => c.trim()).filter(Boolean);
  const outputs = [];
  for (const cmd of cmds) {
    const result = executeSingle(vfs, cmd, history);
    if (result !== '' && result !== undefined) outputs.push(result);
  }
  return outputs.join('\n');
}

function executeSingle(vfs, input, history) {
  // Detect output redirection (> or >>)
  let redirectFile = null;
  let append = false;
  const redirectMatch = input.match(/^(.*?)\s*(>>?)\s*(\S+)\s*$/);
  if (redirectMatch) {
    input = redirectMatch[1].trim();
    append = redirectMatch[2] === '>>';
    redirectFile = redirectMatch[3];
  }

  const tokens = parseTokens(input);
  if (tokens.length === 0) return '';

  const cmdName = tokens[0];
  const args = tokens.slice(1);

  const entry = commands[cmdName];
  if (!entry) {
    return `\x1b[31m${cmdName}: command not found\x1b[0m. Type 'help' for available commands.`;
  }

  let output = entry.fn(vfs, args, history);

  // Handle clear
  if (output === '__CLEAR__') return '__CLEAR__';

  // Handle redirect
  if (redirectFile) {
    const parts = vfs.resolvePath(redirectFile);
    const node = vfs.getNode(parts);
    if (node && node.type === 'file') {
      node.content = append ? node.content + output : output;
    } else if (!node) {
      vfs.createNode(parts, 'file', output);
    } else {
      return `\x1b[31m${redirectFile}: Is a directory\x1b[0m`;
    }
    return '';
  }

  return output;
}