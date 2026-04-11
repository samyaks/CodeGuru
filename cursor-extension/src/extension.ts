import * as vscode from 'vscode';

interface GitRepository {
  onDidCommit: (callback: () => void) => vscode.Disposable;
  log: (options: { maxEntries: number }) => Promise<Array<{
    hash: string;
    message: string;
    authorName?: string;
    authorDate?: Date;
  }>>;
  state: {
    HEAD?: { name?: string };
  };
}

interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: (callback: (repo: GitRepository) => void) => vscode.Disposable;
}

export function activate(context: vscode.ExtensionContext) {
  const gitExt = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>('vscode.git');
  if (!gitExt) return;

  const git = gitExt.exports.getAPI(1);

  function watchRepo(repo: GitRepository) {
    const disposable = repo.onDidCommit(async () => {
      const config = vscode.workspace.getConfiguration('takeoff');
      if (!config.get<boolean>('enabled')) return;
      const projectId = config.get<string>('projectId');
      if (!projectId) return;

      try {
        const log = await repo.log({ maxEntries: 1 });
        const commit = log[0];
        if (!commit) return;

        const prompt = await vscode.window.showInputBox({
          prompt: 'What did you just build? (optional — adds to BuildStory)',
          placeHolder: 'e.g. Added Google auth using Supabase SSR helpers',
          ignoreFocusOut: false,
        });

        await sendEntry(projectId, {
          entry_type: 'prompt',
          content: prompt || commit.message,
          metadata: {
            commitHash: commit.hash,
            commitMessage: commit.message,
            branch: repo.state.HEAD?.name || 'unknown',
            hadUserPrompt: !!prompt,
          },
        });

        if (prompt) {
          vscode.window.setStatusBarMessage('$(check) BuildStory updated', 3000);
        }
      } catch {
        // Silently fail — never interrupt the developer
      }
    });
    context.subscriptions.push(disposable);
  }

  git.repositories.forEach(watchRepo);
  context.subscriptions.push(git.onDidOpenRepository(watchRepo));

  context.subscriptions.push(
    vscode.commands.registerCommand('takeoff.addNote', async () => {
      const config = vscode.workspace.getConfiguration('takeoff');
      const projectId = config.get<string>('projectId');
      if (!projectId) {
        vscode.window.showWarningMessage('Set your Takeoff project ID first (Takeoff: Set Project ID)');
        return;
      }

      const note = await vscode.window.showInputBox({
        prompt: 'Add a note to your BuildStory',
        placeHolder: 'e.g. Decided to use Supabase instead of Firebase for auth',
      });

      if (note) {
        await sendEntry(projectId, {
          entry_type: 'note',
          content: note,
          metadata: {},
        });
        vscode.window.setStatusBarMessage('$(check) Note added to BuildStory', 3000);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('takeoff.setProject', async () => {
      const projectId = await vscode.window.showInputBox({
        prompt: 'Enter your Takeoff project ID',
        placeHolder: 'paste-your-project-id-here',
      });

      if (projectId) {
        await vscode.workspace.getConfiguration('takeoff').update('projectId', projectId, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Takeoff project set: ${projectId}`);
      }
    })
  );
}

async function sendEntry(projectId: string, entry: { entry_type: string; content: string; metadata: Record<string, unknown> }) {
  const config = vscode.workspace.getConfiguration('takeoff');
  const apiUrl = config.get<string>('apiUrl') || 'https://takeoff.app';
  const apiKey = config.get<string>('apiKey');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(`${apiUrl}/api/projects/${projectId}/build-story`, {
    method: 'POST',
    headers,
    body: JSON.stringify(entry),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
}

export function deactivate() {}
