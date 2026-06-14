import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitService } from "../src/index.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("GitService", () => {
  it("creates an isolated detached worktree and reports its diff", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-codex-git-"));
    cleanup.push(root);
    const repository = join(root, "repository");
    const managed = join(root, "managed");
    await execFileAsync("git", ["init", "-b", "main", repository]);
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repository,
    });
    await execFileAsync("git", ["config", "user.name", "Open Codex Test"], {
      cwd: repository,
    });
    await writeFile(join(repository, "README.md"), "hello\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: repository });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: repository,
    });

    const service = new GitService(managed);
    const info = await service.inspectRepository(repository);
    expect(info.defaultBranch).toBe("main");
    expect(info.dirty).toBe(false);

    const worktree = await service.createManagedWorktree({
      repositoryRoot: info.repositoryRoot,
      taskId: "task-1",
      baseRef: "HEAD",
    });
    await writeFile(join(worktree.path, "README.md"), "changed\n");
    const diff = await service.diff(worktree.path);
    expect(diff.status).toContain("M README.md");
    expect(diff.unstaged).toContain("-hello");
    expect(diff.unstaged).toContain("+changed");
    expect(await service.listWorktrees(repository)).toContain(worktree.path);

    await service.removeManagedWorktree(repository, worktree.path);
    expect(await service.listWorktrees(repository)).not.toContain(
      worktree.path,
    );
  });
});
