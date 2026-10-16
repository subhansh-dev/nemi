import * as vscode from 'vscode';
import type { BrainMemory, MemoryKind } from '@nemi/shared';
import type { BrainClient } from '../brainClient';

const KINDS: { kind: MemoryKind; label: string }[] = [
  { kind: 'decision', label: 'Decisions' },
  { kind: 'gotcha', label: 'Gotchas' },
  { kind: 'convention', label: 'Conventions' },
];

type Node =
  | { type: 'group'; kind: MemoryKind; label: string; count: number }
  | { type: 'memory'; memory: BrainMemory };

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
    } else {
      this.description = new Date(node.memory.createdAt).toLocaleDateString();
      this.tooltip = node.memory.text;
      this.contextValue = 'nemiMemory';
      this.iconPath = new vscode.ThemeIcon(
        node.memory.kind === 'decision' ? 'git-pull-request'
          : node.memory.kind === 'gotcha' ? 'warning'
          : 'list-tree',
        new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
      );
    }
  }
}

function truncate(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class BrainView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private disposables: vscode.Disposable[];

  constructor(private readonly client: BrainClient) {
    this.disposables = [
      this.client.sub('state', () => this.emitter.fire()),
    ];
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

  getChildren(node?: Node): Node[] {
    if (!node) {
      return KINDS.map(({ kind, label }) => ({
        type: 'group' as const,
        kind,
        label,
        count: this.client.state.memories.filter((m) => m.kind === kind).length,
      })).filter((g) => g.count > 0);
    }
    if (node.type === 'group') {
      return this.client.state.memories
        .filter((m) => m.kind === node.kind)
        .map((memory) => ({ type: 'memory' as const, memory }));
    }
    return [];
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
    this.client.send({ type: 'brain.add', kind: kindPick.memoryKind, text: text.trim() });
  }

  removeMemory(item?: Node): void {
    if (item?.type === 'memory') {
      this.client.send({ type: 'brain.remove', id: item.memory.id });
    }
  }
}
