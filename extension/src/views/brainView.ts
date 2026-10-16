import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { BrainMemory, MemoryKind } from '@nemi/shared';
import type { BrainClient } from '../brainClient';
import { fileChangedSince, headCommit } from '../git';

const KINDS: { kind: MemoryKind; label: string }[] = [
  { kind: 'decision', label: 'Decisions' },
  { kind: 'gotcha', label: 'Gotchas' },
  { kind: 'convention', label: 'Conventions' },
];

type Node =
  | { type: 'group'; kind: MemoryKind; label: string; count: number }
  | { type: 'memory'; memory: BrainMemory; stale: boolean };

function kindIcon(kind: MemoryKind): string {
  if (kind === 'decision') {
    return 'git-pull-request';
  }
  return kind === 'gotcha' ? 'warning' : 'list-tree';
}

/** `auth.ts · a1b2c3d` for a pinned memory, or null when it floats free. */
function pinLabel(memory: BrainMemory): string | null {
  if (!memory.file) {
    return null;
  }
  const short = memory.commit?.slice(0, 7);
  return short ? `${basename(memory.file)} · ${short}` : basename(memory.file);
}

function memoryTooltip(memory: BrainMemory, stale: boolean): string {
  const lines = [memory.text];
  if (memory.file) {
    lines.push('', `pinned to ${memory.file}`);
    if (stale) {
      lines.push('the file has changed since this was written — worth re-reading');
    }
  }
  return lines.join('\n');
}

class Item extends vscode.TreeItem {
  constructor(public readonly node: Node) {
    super(
      node.type === 'group' ? `${node.label} (${node.count})` : truncate(node.memory.text),
      node.type === 'group'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    if (node.type === 'group') {
      this.description = 'group';
      return;
    }
    const memory = node.memory;
    const pin = pinLabel(memory);
    this.description = pin
      ? `${pin}${node.stale ? ' · changed' : ''}`
      : new Date(memory.createdAt).toLocaleDateString();
    this.tooltip = memoryTooltip(memory, node.stale);
    this.contextValue = 'nemiMemory';
    this.iconPath = new vscode.ThemeIcon(
      kindIcon(memory.kind),
      new vscode.ThemeColor(
        node.stale
          ? 'gitDecoration.modifiedResourceForeground'
          : 'gitDecoration.addedResourceForeground',
      ),
    );
  }
}

function truncate(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class BrainView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private disposables: vscode.Disposable[];
  /** Staleness per `id:commit`, so a refresh does not re-run git every time. */
  private readonly stale = new Map<string, boolean>();

  constructor(
    private readonly client: BrainClient,
    /** Repo the pinned paths are relative to; empty disables staleness checks. */
    private readonly workspaceDir: string,
  ) {
    this.disposables = [this.client.sub('state', () => this.emitter.fire())];
  }

  dispose(): void {
    this.emitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return new Item(node);
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return KINDS.map(({ kind, label }) => ({
        type: 'group' as const,
        kind,
        label,
        count: this.client.state.memories.filter((m) => m.kind === kind).length,
      })).filter((group) => group.count > 0);
    }
    if (node.type === 'group') {
      const memories = this.client.state.memories.filter((m) => m.kind === node.kind);
      await Promise.all(memories.map((memory) => this.checkStale(memory)));
      return memories.map((memory) => ({
        type: 'memory' as const,
        memory,
        stale: this.isStale(memory),
      }));
    }
    return [];
  }

  private key(memory: BrainMemory): string {
    return `${memory.id}:${memory.commit ?? ''}`;
  }

  private async checkStale(memory: BrainMemory): Promise<void> {
    if (!memory.file || !memory.commit || !this.workspaceDir) {
      return;
    }
    const key = this.key(memory);
    if (this.stale.has(key)) {
      return;
    }
    this.stale.set(key, await fileChangedSince(this.workspaceDir, memory.commit, memory.file));
  }

  private isStale(memory: BrainMemory): boolean {
    return this.stale.get(this.key(memory)) ?? false;
  }

  async addMemory(): Promise<void> {
    const kindPick = await vscode.window.showQuickPick(
      // `memoryKind` avoids clashing with QuickPickItem's own `kind` enum.
      KINDS.map((k) => ({ label: k.label, memoryKind: k.kind })),
      { placeHolder: 'What kind of memory?' },
    );
    if (!kindPick) {
      return;
    }
    const text = await vscode.window.showInputBox({
      prompt: `New ${kindPick.label.toLowerCase().replace(/s$/, '')} for the team`,
      placeHolder: 'e.g. Deploys go through the render.yaml pipeline',
    });
    if (!text?.trim()) {
      return;
    }

    // Offer to pin the note to the file you have open, so the team gets told
    // when that code moves on without it.
    let file: string | undefined;
    let commit: string | undefined;
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file' && this.workspaceDir) {
      const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
      const choices: (vscode.QuickPickItem & { pinned: boolean })[] = [
        {
          label: `$(pin) Pin to ${relative}`,
          detail: 'Flag this note in the sidebar once the file changes.',
          pinned: true,
        },
        {
          label: '$(circle-slash) Free-floating',
          detail: 'Not tied to any file.',
          pinned: false,
        },
      ];
      const pick = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Pin this memory to the file you have open?',
      });
      if (!pick) {
        return;
      }
      if (pick.pinned) {
        file = relative;
        commit = (await headCommit(this.workspaceDir)) ?? undefined;
      }
    }

    this.client.send({
      type: 'brain.add',
      kind: kindPick.memoryKind,
      text: text.trim(),
      file,
      commit,
    });
  }

  removeMemory(item?: Node): void {
    if (item?.type === 'memory') {
      this.client.send({ type: 'brain.remove', id: item.memory.id });
    }
  }
}
