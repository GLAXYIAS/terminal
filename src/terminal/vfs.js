// Virtual File System — simulates a real Linux filesystem in memory

export class VFS {
  constructor() {
    this.root = {
      type: 'dir',
      children: {
        home: {
          type: 'dir',
          children: {
            user: {
              type: 'dir',
              children: {
                'welcome.txt': { type: 'file', content: 'Welcome to your Linux terminal!\nThis is a fully functional virtual filesystem.\nType "help" to see all available commands.\nTry "ls", "cd documents", "cat notes.txt", "tree", "neofetch"\n' },
                'about.txt': { type: 'file', content: 'Linux Terminal v1.0\nA browser-based terminal emulator with a virtual filesystem.\nAll commands run locally in your browser.\n' },
                '.bashrc': { type: 'file', content: '# ~/.bashrc\nexport PS1="user@linux-terminal:\\w$ "\nalias ll="ls -l"\nalias la="ls -la"\n' },
                documents: {
                  type: 'dir',
                  children: {
                    'notes.txt': { type: 'file', content: 'My Notes:\n========\n1. Buy groceries\n2. Call mom\n3. Finish the project\n4. Schedule dentist appointment\n' },
                    'ideas.md': { type: 'file', content: '# Project Ideas\n\n1. Build a terminal app in the browser\n2. Learn Rust\n3. Contribute to open source\n4. Write a blog post about Linux\n' },
                    'todo.txt': { type: 'file', content: '[ ] Learn Linux commands\n[ ] Practice with the terminal\n[x] Install the terminal app\n[ ] Master shell scripting\n' },
                  },
                },
                projects: {
                  type: 'dir',
                  children: {
                    'hello.sh': { type: 'file', content: '#!/bin/bash\necho "Hello, World!"\necho "Welcome to shell scripting."\n' },
                    'fibonacci.py': { type: 'file', content: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)\n\nfor i in range(10):\n    print(fib(i))\n' },
                    'README.md': { type: 'file', content: '# My Projects\n\nThis directory contains my coding projects.\n\n## Languages\n- Python\n- Bash\n- JavaScript\n' },
                  },
                },
                downloads: { type: 'dir', children: {} },
                pictures: { type: 'dir', children: {} },
              },
            },
          },
        },
        etc: {
          type: 'dir',
          children: {
            hostname: { type: 'file', content: 'linux-terminal\n' },
            'os-release': { type: 'file', content: 'NAME="Linux Terminal"\nVERSION="1.0"\nID=linuxterminal\nPRETTY_NAME="Linux Terminal 1.0"\n' },
            passwd: { type: 'file', content: 'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:user:/home/user:/bin/bash\n' },
          },
        },
        var: {
          type: 'dir',
          children: {
            log: { type: 'dir', children: {
              'syslog': { type: 'file', content: '[boot] System started\n[init] Loading virtual filesystem\n[ok] Terminal ready\n' },
            }},
          },
        },
        usr: { type: 'dir', children: {
          bin: { type: 'dir', children: {} },
          lib: { type: 'dir', children: {} },
          share: { type: 'dir', children: {} },
        }},
        bin: { type: 'dir', children: {} },
        tmp: { type: 'dir', children: {} },
        root: { type: 'dir', children: {} },
      },
    };
    this.cwd = ['home', 'user'];
    this.user = 'user';
    this.host = 'linux-terminal';
    this.prevCwd = null;
  }

  resolvePath(path) {
    if (!path || path === '') return [...this.cwd];
    if (path === '~') return ['home', 'user'];
    if (path.startsWith('~/')) path = '/home/user' + path.slice(1);

    let parts;
    if (path.startsWith('/')) {
      parts = path.split('/').filter((p) => p);
    } else {
      parts = [...this.cwd, ...path.split('/').filter((p) => p)];
    }

    const resolved = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') resolved.pop();
      else resolved.push(part);
    }
    return resolved;
  }

  getNode(parts) {
    let node = this.root;
    for (const part of parts) {
      if (!node || node.type !== 'dir' || !node.children[part]) return null;
      node = node.children[part];
    }
    return node;
  }

  getParent(parts) {
    if (parts.length === 0) return null;
    return this.getNode(parts.slice(0, -1));
  }

  createNode(parts, type, content = '') {
    const name = parts[parts.length - 1];
    const parent = this.getParent(parts);
    if (!parent || parent.type !== 'dir') return false;
    if (parent.children[name]) return false;
    parent.children[name] =
      type === 'dir' ? { type: 'dir', children: {} } : { type: 'file', content };
    return true;
  }

  removeNode(parts) {
    const name = parts[parts.length - 1];
    const parent = this.getParent(parts);
    if (!parent || !parent.children[name]) return false;
    delete parent.children[name];
    return true;
  }

  getFullPath() {
    return '/' + this.cwd.join('/');
  }

  pathToString(parts) {
    return '/' + parts.join('/');
  }

  getDisplayPath() {
    const full = this.getFullPath();
    const home = '/home/user';
    if (full === home) return '~';
    if (full.startsWith(home + '/')) return '~' + full.slice(home.length);
    return full;
  }
}

export function cloneNode(node) {
  if (node.type === 'file') return { type: 'file', content: node.content };
  return {
    type: 'dir',
    children: Object.fromEntries(
      Object.entries(node.children).map(([k, v]) => [k, cloneNode(v)])
    ),
  };
}