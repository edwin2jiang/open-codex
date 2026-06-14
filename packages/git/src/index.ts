import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { DiffSnapshot } from "@open-codex/protocol";

const execFileAsync = promisify(execFile);

export type RepositoryInfo = {
  name: string;
  inputPath: string;
  repositoryRoot: string;
  defaultBranch: string;
  head: string;
  dirty: boolean;
};

export class GitService {
  readonly managedRoot: string;

  constructor(managedRoot: string) {
    this.managedRoot = resolve(managedRoot);
  }

  async inspectRepository(path: string): Promise<RepositoryInfo> {
    const canonicalInput = await realpath(resolve(path));
    const metadata = await stat(canonicalInput);
    if (!metadata.isDirectory()) {
      throw new Error(`Project path is not a directory: ${path}`);
    }
    const repositoryRoot = (
      await git(canonicalInput, ["rev-parse", "--show-toplevel"])
    ).trim();
    const canonicalRoot = await realpath(repositoryRoot);
    const head = (await git(canonicalRoot, ["rev-parse", "HEAD"])).trim();
    const branch = (
      await git(canonicalRoot, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]).catch(() => "")
    ).trim();
    const dirty =
      (await git(canonicalRoot, ["status", "--porcelain"])).length > 0;
    return {
      name: basename(canonicalRoot),
      inputPath: canonicalInput,
      repositoryRoot: canonicalRoot,
      defaultBranch: branch || "HEAD",
      head,
      dirty,
    };
  }

  async createManagedWorktree(input: {
    repositoryRoot: string;
    taskId: string;
    baseRef?: string;
  }): Promise<{ path: string; baseRef: string }> {
    const baseRef = input.baseRef || "HEAD";
    const projectDirectory = resolve(
      this.managedRoot,
      safeSegment(basename(input.repositoryRoot)),
    );
    const worktreePath = resolve(projectDirectory, safeSegment(input.taskId));
    this.#assertManagedPath(worktreePath);
    await mkdir(projectDirectory, { recursive: true });
    await git(input.repositoryRoot, [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      baseRef,
    ]);
    return { path: worktreePath, baseRef };
  }

  async removeManagedWorktree(
    repositoryRoot: string,
    worktreePath: string,
  ): Promise<void> {
    this.#assertManagedPath(worktreePath);
    await git(repositoryRoot, [
      "worktree",
      "remove",
      "--force",
      resolve(worktreePath),
    ]);
    await git(repositoryRoot, ["worktree", "prune"]);
  }

  async diff(workspacePath: string): Promise<DiffSnapshot> {
    const [status, unstaged, staged] = await Promise.all([
      git(workspacePath, ["status", "--short"]),
      git(workspacePath, ["diff", "--no-ext-diff", "--"]),
      git(workspacePath, ["diff", "--cached", "--no-ext-diff", "--"]),
    ]);
    return { status, unstaged, staged };
  }

  async listWorktrees(repositoryRoot: string): Promise<string> {
    return git(repositoryRoot, ["worktree", "list", "--porcelain"]);
  }

  #assertManagedPath(path: string): void {
    const candidate = resolve(path);
    const fromRoot = relative(this.managedRoot, candidate);
    if (
      fromRoot === "" ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      resolve(this.managedRoot, fromRoot) !== candidate
    ) {
      throw new Error(`Refusing unmanaged worktree path: ${path}`);
    }
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${detail.stderr || detail.message}`,
    );
  }
}

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "workspace";
}
